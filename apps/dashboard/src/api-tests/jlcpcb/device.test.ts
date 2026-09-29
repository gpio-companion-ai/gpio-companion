import { describe, expect, test } from "bun:test";
import { generateDeviceKeyPair } from "gpio-companion";
import {
	type JlcpcbDeviceContext,
	onRequestGet,
	postDevice,
} from "../../actions/api/jlcpcb/device.ts";
import { issueAiCredentials } from "../../lib/ai-credentials.ts";
import {
	JLCPCB_CREDENTIALS_REQUIRED,
	type JlcpcbPartsClient,
} from "../../lib/jlcpcb.ts";
import type { StoredPairing } from "../../lib/pairing-store.ts";

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

function pairing(): StoredPairing {
	return {
		userId: "user-1",
		uuid: "pair-uuid",
		key: "pair-key",
		deviceUrl: "https://api.example",
		login: "ada",
		email: "ada@example.com",
		claimedAt: "2026-08-31T00:00:00.000Z",
		label: "",
		bleMac: "",
	};
}

async function authed(kv: MemoryKv, method: "GET" | "POST", body?: unknown) {
	const keys = await generateDeviceKeyPair();
	await kv.put("pair:pair-uuid", "user-1");
	await kv.put("device:user-1", JSON.stringify([pairing()]));
	const env = {
		DYNAMIC_PAGE_KV: kv as unknown as KVNamespace,
		GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
	};
	const creds = await issueAiCredentials(env, "pair-uuid", "pair-key");
	const ctx: JlcpcbDeviceContext = {
		request: new Request("https://gpio-companion.com/api/jlcpcb/device", {
			method,
			headers: {
				authorization: `Bearer ${creds.token}`,
				"content-type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		env,
	};
	return ctx;
}

describe("JLCPCB device route", () => {
	test("401 without a device token", async () => {
		const response = await onRequestGet({
			request: new Request("https://gpio-companion.com/api/jlcpcb/device"),
			env: { DYNAMIC_PAGE_KV: new MemoryKv() as unknown as KVNamespace },
		});
		expect(response.status).toBe(401);
	});

	test("401 with an unknown token", async () => {
		const response = await onRequestGet({
			request: new Request("https://gpio-companion.com/api/jlcpcb/device", {
				headers: { authorization: "Bearer nope" },
			}),
			env: { DYNAMIC_PAGE_KV: new MemoryKv() as unknown as KVNamespace },
		});
		expect(response.status).toBe(401);
	});

	test("search returns 400 and does not build a client without credentials", async () => {
		const ctx = await authed(new MemoryKv(), "POST", {
			componentCodes: ["C2040"],
			secretKey: SECRET,
		});
		let constructed = 0;
		const response = await postDevice(ctx, () => {
			constructed += 1;
			throw new Error("constructed");
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe(JLCPCB_CREDENTIALS_REQUIRED);
		expect(constructed).toBe(0);
		expect(JSON.stringify(body)).not.toContain(SECRET);
	});

	test("status is not configured when Pages secrets are missing", async () => {
		const ctx = await authed(new MemoryKv(), "GET");
		const response = await onRequestGet(ctx);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { configured: boolean };
		};
		expect(body.data.configured).toBe(false);
	});

	test("search uses Pages secrets and does not echo the key", async () => {
		const kv = new MemoryKv();
		const ctx = await authed(kv, "POST", { componentCodes: ["C2040"] });
		ctx.env = {
			...ctx.env,
			JLCPCB_APP_ID: "app-1",
			JLCPCB_ACCESS_KEY: "access-1",
			JLCPCB_SECRET_KEY: SECRET,
		};
		const client: JlcpcbPartsClient = {
			components: {
				async getDetailsByCode() {
					return {
						raiseForStatus() {},
						data: [
							{
								componentCode: "C2040",
								name: "10k",
								package: "0603",
								stock: 12,
								secretKey: SECRET,
							},
						],
					};
				},
			},
		};
		const response = await postDevice(ctx, () => client);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("C2040");
		expect(text).toContain("0603");
		expect(text).not.toContain(SECRET);
	});
});
