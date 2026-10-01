import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	debugAuthQuery,
	generateDeviceKeyPair,
	OPENCODE_REPO_HEADER,
	opencodeEventPath,
	signDeviceRequest,
} from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import { memoryFlash } from "./flash.ts";
import { createGpioController, memoryGpioBackend } from "./gpio.ts";
import {
	opencodeBasicAuthorization,
	readOpencodeServerAuth,
	rotateOpencodeServerPassword,
} from "./opencode-proxy.ts";
import { filePairingStore } from "./pairing.ts";
import { memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const dir = await mkdtemp(join(tmpdir(), "gpio-oc-proxy-"));
const envPath = join(dir, "opencode-server.env");
const pairingPath = join(dir, "pairing.json");
const keys = await generateDeviceKeyPair();
const seen: { url: string; authorization: string; lastEventId: string }[] = [];
const credentialHits: string[] = [];
let credentialsOk = true;
let revoked = 0;

await writeFile(
	pairingPath,
	`${JSON.stringify(
		{
			uuid: "pair-uuid",
			key: "pair-key",
			claimed: true,
			userId: "user-1",
			email: "ada@gpio-companion.com",
			login: "ada",
			claimedAt: "2026-09-28T00:00:00.000Z",
		},
		null,
		"\t",
	)}\n`,
);
await writeFile(
	envPath,
	"OPENCODE_SERVER_USERNAME=opencode\nOPENCODE_SERVER_PASSWORD=secret-one\n",
);

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(dir, "config.json"), "orangepi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(pairingPath, "pair-uuid", "pair-key"),
	applyTunnel: async () => undefined,
	gpio: createGpioController(memoryGpioBackend("")),
	flash: memoryFlash(),
	run: memoryRun(),
	proxy: memoryArduinoProxy(),
	deviceAuth: {
		keyId: keys.keyId,
		publicKeyPem: keys.publicKeyPem,
	},
	clockTrusted: () => false,
	dashboardUrl: "https://gpio-companion.com",
	opencodeEnvPath: envPath,
	opencodeJsonPath: join(dir, "opencode.json"),
	projectsDir: "/home/companion/projects",
	revokeOpencode: async () => {
		revoked += 1;
		await rotateOpencodeServerPassword(envPath);
	},
	fetchImpl: async (input) => {
		const url = String(input);
		credentialHits.push(url);
		if (!credentialsOk) {
			return Response.json({ error: "unknown pairing" }, { status: 404 });
		}
		return Response.json({
			token: "gpioai.v1.test",
			expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
		});
	},
	opencodeFetch: async (input, init) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		seen.push({
			url,
			authorization: headers.get("authorization") ?? "",
			lastEventId: headers.get("last-event-id") ?? "",
		});
		if (new URL(url).pathname.endsWith("/event")) {
			return new Response("data: hi\n\n", {
				headers: {
					"content-type": "text/event-stream",
					"access-control-allow-origin": "https://evil.example",
				},
			});
		}
		return Response.json({ healthy: true, version: "1.2.3" });
	},
});

afterAll(() => {
	server.stop();
});

async function signed(
	path: string,
	init: RequestInit = {},
	sign = true,
): Promise<Response> {
	const method = (init.method ?? "GET").toUpperCase();
	const body = typeof init.body === "string" ? init.body : "";
	const auth = sign
		? await signDeviceRequest({
				privateKeyPem: keys.privateKeyPem,
				keyId: keys.keyId,
				method,
				path: `/${path}`,
				body,
			})
		: {};
	return fetch(`${server.url}${path}`, {
		...init,
		headers: {
			authorization: "Bearer client-must-not-forward",
			...auth,
			...(init.headers ?? {}),
		},
	});
}

describe("signed opencode proxy", () => {
	test("GET /global/health injects basic auth on loopback", async () => {
		seen.length = 0;
		credentialHits.length = 0;
		const response = await signed("v1/opencode/global/health");
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		const body = (await response.json()) as {
			healthy: boolean;
			version: string;
		};
		expect(body).toEqual({ healthy: true, version: "1.2.3" });
		expect(seen[0]?.url).toBe("http://127.0.0.1:4096/global/health");
		expect(seen[0]?.authorization).toBe(
			opencodeBasicAuthorization({
				username: "opencode",
				password: "secret-one",
			}),
		);
		expect(seen[0]?.authorization).not.toContain("client-must-not-forward");
		expect(
			credentialHits.some((url) => url.endsWith("/api/ai/credentials")),
		).toBe(true);
		expect(server.port).not.toBe(4096);
	});

	test("streams SSE scoped to ~/projects/<repo> and strips upstream CORS", async () => {
		seen.length = 0;
		const response = await signed("v1/opencode/event?directory=%2Fetc", {
			headers: { "x-gpio-opencode-repo": "demo" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(await response.text()).toBe("data: hi\n\n");
		expect(seen[0]?.url).toBe(
			"http://127.0.0.1:4096/event?directory=%2Fhome%2Fcompanion%2Fprojects%2Fdemo",
		);
	});

	test("streams events over the companion websocket", async () => {
		seen.length = 0;
		const path = opencodeEventPath("demo");
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path,
		});
		const frames: string[] = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}${path.slice(1)}?${debugAuthQuery(headers)}&last=evt_9`,
		);
		const got = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("no frame")), 2000);
			ws.addEventListener("message", (event) => {
				frames.push(String(event.data));
				clearTimeout(timer);
				resolve();
			});
			ws.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new Error("ws error"));
			});
		});
		await got;
		ws.close();
		expect(JSON.parse(frames[0] ?? "")).toEqual({
			id: "",
			data: { type: "text", text: "hi" },
		});
		expect(seen[0]?.url).toBe(
			"http://127.0.0.1:4096/event?directory=%2Fhome%2Fcompanion%2Fprojects%2Fdemo",
		);
		expect(seen[0]?.authorization.startsWith("Basic ")).toBe(true);
		expect(seen[0]?.lastEventId).toBe("evt_9");
	});

	test("revoked event websocket does not upgrade", async () => {
		credentialsOk = false;
		const path = opencodeEventPath("demo");
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path,
		});
		const denied = await fetch(
			`${server.url}${path.slice(1)}?${debugAuthQuery(headers)}`,
			{
				headers: { upgrade: "websocket", origin: "https://gpio-companion.com" },
			},
		);
		credentialsOk = true;
		expect(denied.status).toBe(403);
	});

	test("unsigned event websocket is 401", async () => {
		const missing = await fetch(`${server.url}v1/opencode/event/demo`, {
			headers: { upgrade: "websocket" },
		});
		expect(missing.status).toBe(401);
	});

	test("does not proxy file or shell routes", async () => {
		seen.length = 0;
		const response = await signed("v1/opencode/file", {
			headers: { "x-gpio-opencode-repo": "demo" },
		});
		expect(response.status).toBe(404);
		expect(seen).toHaveLength(0);
	});

	test("unsigned and unpaired calls do not reach :4096", async () => {
		seen.length = 0;
		const unsigned = await signed("v1/opencode/global/health", {}, false);
		expect(unsigned.status).toBe(401);
		expect(seen).toHaveLength(0);

		credentialsOk = false;
		const denied = await signed("v1/opencode/global/health");
		expect(denied.status).toBe(403);
		expect(seen).toHaveLength(0);
		credentialsOk = true;
	});

	test("unpair and transfer revoke the proxy immediately", async () => {
		const before = await readOpencodeServerAuth(envPath);
		revoked = 0;
		seen.length = 0;
		const unpaired = await signed("v1/pairing/unpair", {
			method: "POST",
			body: JSON.stringify({ uuid: "pair-uuid", key: "pair-key" }),
		});
		expect(unpaired.status).toBe(200);
		expect(revoked).toBe(1);
		const after = await readOpencodeServerAuth(envPath);
		expect(after.password).not.toBe(before.password);
		const blocked = await signed("v1/opencode/global/health");
		expect(blocked.status).toBe(403);
		expect(seen).toHaveLength(0);

		await writeFile(
			pairingPath,
			`${JSON.stringify(
				{
					claimed: true,
					userId: "user-1",
					email: "ada@gpio-companion.com",
					login: "ada",
					claimedAt: "2026-09-28T00:00:00.000Z",
				},
				null,
				"\t",
			)}\n`,
		);
		const current = await readOpencodeServerAuth(envPath);
		seen.length = 0;
		const transferred = await signed("v1/pairing/transfer", {
			method: "POST",
			body: JSON.stringify({
				uuid: "pair-uuid",
				key: "pair-key",
				userId: "user-2",
				email: "bob@gpio-companion.com",
			}),
		});
		expect(transferred.status).toBe(200);
		expect(revoked).toBe(2);
		const rotated = await readOpencodeServerAuth(envPath);
		expect(rotated.password).not.toBe(current.password);
		const again = await signed("v1/opencode/global/health");
		expect(again.status).toBe(200);
		expect(seen[0]?.authorization).toBe(opencodeBasicAuthorization(rotated));
		expect(seen[0]?.url.startsWith("http://127.0.0.1:4096/")).toBe(true);
	});

	test("permission mode stays on the board", async () => {
		seen.length = 0;
		const got = await signed("v1/opencode/permission-mode", {
			headers: { [OPENCODE_REPO_HEADER]: "blink-led" },
		});
		expect(got.status).toBe(200);
		expect(await got.json()).toEqual({ mode: "ask" });
		expect(seen).toHaveLength(0);
		const set = await signed("v1/opencode/permission-mode", {
			method: "POST",
			body: JSON.stringify({ mode: "full" }),
			headers: { [OPENCODE_REPO_HEADER]: "blink-led" },
		});
		expect(set.status).toBe(200);
		expect(await set.json()).toEqual({ mode: "full" });
		const config = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
		expect(config.opencodePermission).toBe("full");
		const written = JSON.parse(
			await readFile(join(dir, "opencode.json"), "utf8"),
		);
		expect(written.permission).toEqual({
			edit: "allow",
			bash: "allow",
			webfetch: "allow",
		});
		expect(seen).toHaveLength(0);
	});
});
