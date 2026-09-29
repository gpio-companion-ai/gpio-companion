import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

import {
	ADDRESS_REQUIRED,
	CONFIRM_REQUIRED,
	handleJlcpcbOrder,
	handleJlcpcbQuote,
	handleJlcpcbSearch,
	JLCPCB_CREDENTIALS_REQUIRED,
	JLCPCB_REQUEST_FAILED,
	type JlcpcbEnv,
	type JlcpcbOrderClient,
	type JlcpcbPartsClient,
	jlcpcbCredentialStatus,
	jlcpcbResponse,
	loadJlcpcbCredentials,
	ORDER_KIND_INVALID,
	searchJlcpcbParts,
} from "./jlcpcb.ts";

const SECRET = "jlc-secret-do-not-leak";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
}

function kv() {
	return new MemoryKv() as unknown as KVNamespace & {
		store: Map<string, string>;
	};
}

const credentials = {
	appId: "app-1",
	accessKey: "access-1",
	secretKey: SECRET,
};

function appEnv(partial: Partial<JlcpcbEnv> = {}): JlcpcbEnv {
	return {
		JLCPCB_APP_ID: " app-1 ",
		JLCPCB_ACCESS_KEY: "access-1",
		JLCPCB_SECRET_KEY: SECRET,
		...partial,
	};
}

describe("jlcpcb credentials", () => {
	test("reads Pages secrets and does not echo them", () => {
		const status = jlcpcbCredentialStatus(appEnv());
		expect(status).toEqual({ configured: true });
		expect(JSON.stringify(status)).not.toContain(SECRET);
		expect(loadJlcpcbCredentials(appEnv())).toEqual(credentials);
	});

	test("missing env and leftover KV keys fail closed", async () => {
		const store = kv();
		await store.put(
			"jlcpcb:user-1",
			JSON.stringify({
				appId: "app-1",
				accessKey: "access-1",
				secretKey: SECRET,
			}),
		);
		expect(loadJlcpcbCredentials({})).toBeNull();
		expect(
			loadJlcpcbCredentials({
				JLCPCB_APP_ID: "app-1",
				JLCPCB_ACCESS_KEY: "access-1",
			}),
		).toBeNull();
		expect(jlcpcbCredentialStatus({})).toEqual({ configured: false });
		expect(JSON.stringify(store.store.get("jlcpcb:user-1"))).toContain(SECRET);
		await expect(
			handleJlcpcbSearch({
				env: {},
				userId: "user-1",
				body: {
					componentCodes: ["C2040"],
					appId: "app-1",
					accessKey: "access-1",
					secretKey: SECRET,
				},
			}),
		).rejects.toThrow(JLCPCB_CREDENTIALS_REQUIRED);
	});
});

describe("jlcpcb search", () => {
	test("returns 400 and does not build a client without credentials", async () => {
		let constructed = 0;
		const fetchCalls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			fetchCalls.push(String(input));
			throw new Error("live fetch");
		}) as unknown as typeof fetch;
		try {
			const response = await jlcpcbResponse(() =>
				handleJlcpcbSearch({
					env: {},
					userId: "user-1",
					body: {
						componentCodes: ["C2040"],
						appId: "app-1",
						accessKey: "access-1",
						secretKey: SECRET,
					},
					clientFor: () => {
						constructed += 1;
						throw new Error("constructed");
					},
				}),
			);
			expect(response.status).toBe(400);
			const body = (await response.json()) as {
				ok: boolean;
				error: string;
			};
			expect(body).toEqual({
				ok: false,
				error: JLCPCB_CREDENTIALS_REQUIRED,
			});
			expect(constructed).toBe(0);
			expect(fetchCalls).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});

	test("searches by component code with a mocked client", async () => {
		const calls: string[] = [];
		let orders = 0;
		const client: JlcpcbPartsClient & {
			pcb: { createOrder(): Promise<never> };
		} = {
			components: {
				async getDetailsByCode(body) {
					calls.push(...body.componentCodes);
					return {
						raiseForStatus() {},
						data: [
							{
								componentCode: "C2040",
								componentName: "10k",
								componentSpecification: "0603",
								stockCount: 12,
								componentPrices: [{ productPrice: 0.01 }],
								secretKey: SECRET,
							},
							{ name: "missing code" },
						],
					};
				},
			},
			pcb: {
				async createOrder() {
					orders += 1;
					throw new Error("order");
				},
			},
		};
		const result = await searchJlcpcbParts(
			appEnv(),
			["C2040", "C2040"],
			() => client,
		);
		expect(calls).toEqual(["C2040"]);
		expect(orders).toBe(0);
		expect(result).toEqual([
			{
				componentCode: "C2040",
				name: "10k",
				package: "0603",
				stock: 12,
				price: 0.01,
			},
		]);
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	test("keyword search uses the client helper and does not build a signed client", async () => {
		let constructed = 0;
		const keywords: string[] = [];
		const result = await handleJlcpcbSearch({
			env: {},
			userId: "user-1",
			body: { query: "10k 0603" },
			clientFor: () => {
				constructed += 1;
				throw new Error("constructed");
			},
			searchParts: async (body) => {
				keywords.push(body.keyword);
				return {
					raiseForStatus() {},
					data: [
						{
							componentCode: "C2040",
							name: "10k",
							package: "0603",
							stock: 4,
						},
					],
				};
			},
		});
		expect(constructed).toBe(0);
		expect(keywords).toEqual(["10k 0603"]);
		expect(result.parts).toEqual([
			{ componentCode: "C2040", name: "10k", package: "0603", stock: 4 },
		]);
	});

	test("does not return a client error that contains the secret", async () => {
		await expect(
			searchJlcpcbParts(appEnv(), ["C2040"], () => ({
				components: {
					async getDetailsByCode() {
						throw new Error(`denied ${SECRET}`);
					},
				},
			})),
		).rejects.toThrow(JLCPCB_REQUEST_FAILED);
	});
});

describe("jlcpcb order", () => {
	const address = {
		name: "Ada Lovelace",
		line1: "1 Analytical",
		line2: null,
		city: "London",
		region: "Greater London",
		postalCode: "SW1",
		country: "GB",
	};

	function orderClient() {
		const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
		let constructed = 0;
		const client: JlcpcbOrderClient = {
			pcb: {
				async quote(body) {
					calls.push({ method: "pcb.quote", body });
					return { raiseForStatus() {}, data: { total: 12 } };
				},
				async createOrder(body) {
					calls.push({ method: "pcb.createOrder", body });
					return { raiseForStatus() {}, data: { batchNum: "pcb-1" } };
				},
			},
			tdp: {
				async quote(body) {
					calls.push({ method: "tdp.quote", body });
					return { raiseForStatus() {}, data: { total: 4 } };
				},
				async createOrder(body) {
					calls.push({ method: "tdp.createOrder", body });
					return { raiseForStatus() {}, data: { batchNum: "tdp-1" } };
				},
			},
		};
		return {
			calls,
			clientFor: () => {
				constructed += 1;
				return client;
			},
			constructed: () => constructed,
		};
	}

	test("does not create an order without confirm, address, or credentials", async () => {
		const missingCreds = orderClient();
		await expect(
			handleJlcpcbOrder({
				env: {},
				userId: "user-1",
				address,
				body: { confirm: true, kind: "pcb", address },
				clientFor: missingCreds.clientFor,
			}),
		).rejects.toThrow(JLCPCB_CREDENTIALS_REQUIRED);
		expect(missingCreds.constructed()).toBe(0);

		const noAddress = orderClient();
		await expect(
			handleJlcpcbOrder({
				env: appEnv(),
				userId: "user-1",
				address: null,
				body: { confirm: true, kind: "pcb", address },
				clientFor: noAddress.clientFor,
			}),
		).rejects.toThrow(ADDRESS_REQUIRED);
		expect(noAddress.calls).toEqual([]);

		const cancelled = orderClient();
		await expect(
			handleJlcpcbOrder({
				env: appEnv(),
				userId: "user-1",
				address,
				body: { kind: "pcb", confirm: false },
				clientFor: cancelled.clientFor,
			}),
		).rejects.toThrow(CONFIRM_REQUIRED);
		expect(cancelled.constructed()).toBe(0);
		await expect(
			handleJlcpcbOrder({
				env: appEnv(),
				userId: "user-1",
				address,
				body: { kind: "assembly", confirm: true },
				clientFor: cancelled.clientFor,
			}),
		).rejects.toThrow(ORDER_KIND_INVALID);
		expect(cancelled.constructed()).toBe(0);
	});

	test("confirm uses the stored address and ignores a body address", async () => {
		const mocked = orderClient();
		const result = await handleJlcpcbOrder({
			env: appEnv(),
			userId: "user-1",
			address,
			body: {
				confirm: true,
				kind: "pcb",
				fileKey: "gerber-1",
				layer: "2",
				qty: "5",
				address: { name: "Other", line1: "nope" },
				secretKey: SECRET,
			},
			clientFor: mocked.clientFor,
		});
		expect(result).toEqual({ order: { batchNum: "pcb-1" } });
		expect(mocked.calls).toEqual([
			{
				method: "pcb.createOrder",
				body: {
					shippingAddress: {
						firstName: "Ada",
						lastName: "Lovelace",
						streetAddress: "1 Analytical",
						city: "London",
						country: "GB",
						postalCode: "SW1",
						province: "Greater London",
					},
					fileKey: "gerber-1",
					pcbParam: { layer: 2, qty: 5 },
				},
			},
		]);
		expect(JSON.stringify(mocked.calls)).not.toContain(SECRET);
	});

	test("quote does not create an order", async () => {
		const mocked = orderClient();
		const result = await handleJlcpcbQuote({
			env: appEnv(),
			userId: "user-1",
			address,
			body: { confirm: true, kind: "tdp", fileAccessId: "file-1" },
			clientFor: mocked.clientFor,
		});
		expect(result).toEqual({ quote: { total: 4 } });
		expect(mocked.calls.map((call) => call.method)).toEqual(["tdp.quote"]);
	});
});

describe("jlcpcb import boundary", () => {
	test("the npm client is dashboard-only", async () => {
		const root = `${import.meta.dir}/../../../..`;
		const dashboard = (await Bun.file(
			`${root}/apps/dashboard/package.json`,
		).json()) as { dependencies: Record<string, string> };
		expect(dashboard.dependencies["@community-jlcpcb/client"]).toBe("0.2.0");
		for (const app of ["desktop", "mobile"]) {
			const pkg = (await Bun.file(
				`${root}/apps/${app}/package.json`,
			).json()) as { dependencies?: Record<string, string> };
			expect(pkg.dependencies?.["@community-jlcpcb/client"]).toBeUndefined();
		}
		const glob = new Glob("**/*.{ts,tsx}");
		const hits: string[] = [];
		for await (const path of glob.scan({
			cwd: `${root}/apps`,
			onlyFiles: true,
		})) {
			if (
				path.endsWith("src/lib/jlcpcb.ts") ||
				path.endsWith("src/lib/jlcpcb.test.ts") ||
				path.includes("node_modules")
			) {
				continue;
			}
			const text = await Bun.file(`${root}/apps/${path}`).text();
			if (text.includes("@community-jlcpcb/client")) {
				hits.push(path);
			}
		}
		expect(hits).toEqual([]);
	});
});
