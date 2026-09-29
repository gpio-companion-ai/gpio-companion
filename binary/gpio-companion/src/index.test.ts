import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	generateDeviceKeyPair,
	mintOfflineGrant,
	signDeviceRequest,
	signOfflineEnvelope,
	WifiConnectError,
} from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import { memoryFlash } from "./flash.ts";
import { createGpioController, memoryGpioBackend } from "./gpio.ts";
import { filePairingStore } from "./pairing.ts";
import { memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { startDeviceApi } from "./serve.ts";
import { fileConfigStore, tunnelEnvContents } from "./store.ts";

const dir = await mkdtemp(join(tmpdir(), "gpio-companion-"));
const configPath = join(dir, "config.json");
const secretsPath = join(dir, "secrets.env");
const pairingPath = join(dir, "pairing.json");
const keys = await generateDeviceKeyPair();
let applied = 0;
let wifiSsid = "";
const clockSets: number[] = [];
let updateStarts = 0;
const projectSyncs: Array<{ owner?: string; name?: string }> = [];
const projectRemoves: Array<{ owner: string; name: string }> = [];
const projectPushes: Array<{ owner: string; name: string; message: string }> =
	[];

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(configPath, "orangepi"),
	secrets: fileSecretsStore(secretsPath),
	pairing: filePairingStore(pairingPath, "pair-uuid", "pair-key"),
	applyTunnel: async () => {
		applied += 1;
	},
	applyUpdate: async () => {
		updateStarts += 1;
	},
	applyProjects: async (target) => {
		projectSyncs.push(target);
	},
	applyProjectRemove: async (put) => {
		projectRemoves.push(put);
		return { removed: true };
	},
	applyProjectPush: async (put) => {
		projectPushes.push(put);
		return {
			committed: true,
			pushed: true,
			sha: "abc123",
			message: put.message,
		};
	},
	applyWifi: async (config) => {
		if (config.ssid === "missing") {
			throw new WifiConnectError("ssid-not-found");
		}
		if (config.ssid === "badpass") {
			throw new WifiConnectError("password");
		}
		if (config.ssid === "nowifi") {
			throw new WifiConnectError("no-device");
		}
		wifiSsid = config.ssid;
		return { ssid: config.ssid };
	},
	gpio: createGpioController(memoryGpioBackend("")),
	flash: memoryFlash(),
	run: memoryRun(),
	proxy: memoryArduinoProxy(),
	deviceAuth: {
		keyId: keys.keyId,
		publicKeyPem: keys.publicKeyPem,
	},
	applyClock: async (issuedMs) => {
		clockSets.push(issuedMs);
	},
	clockTrusted: () => true,
	readDisk: () => ({ totalMb: 7456, availMb: 1800 }),
	readLogs: async () => "token ghs_abcDEF123 failed",
	readNetwork: () => ({
		type: "wifi",
		ssid: "bench",
		interface: "wlan0",
		connection: "bench",
	}),
	readInfo: async () => ({
		host: { hostname: "orangepi" },
		network: {
			type: "ethernet",
			ssid: "",
			interface: "eth0",
			connection: "Wired",
		},
	}),
});

afterAll(() => {
	server.stop();
});

const seenNonces = new Set<string>();
const untrustedDir = await mkdtemp(join(tmpdir(), "gpio-companion-offline-"));
const untrusted = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(untrustedDir, "config.json"), "orangepi"),
	secrets: fileSecretsStore(join(untrustedDir, "secrets.env")),
	pairing: filePairingStore(
		join(untrustedDir, "pairing.json"),
		"pair-uuid",
		"pair-key",
	),
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
	nonceStore: {
		has: (nonce) => seenNonces.has(nonce),
		add: (nonce) => {
			seenNonces.add(nonce);
		},
	},
});

afterAll(() => {
	untrusted.stop();
});

async function deviceFetch(
	path: string,
	init: RequestInit = {},
	signed = true,
): Promise<Response> {
	const method = (init.method ?? "GET").toUpperCase();
	const body = typeof init.body === "string" ? init.body : "";
	const auth = signed
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
			"content-type": "application/json",
			...auth,
			...(init.headers ?? {}),
		},
	});
}

describe("gpio-companion-bin", () => {
	test("health", async () => {
		const response = await fetch(`${server.url}health`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	test("rejects unsigned config writes", async () => {
		const response = await deviceFetch(
			"v1/config/secrets",
			{
				method: "PUT",
				body: JSON.stringify({ gpioAiKey: "ai-key" }),
			},
			false,
		);
		expect(response.status).toBe(401);
	});

	test("sets tunnel replica endpoint", async () => {
		const response = await deviceFetch("v1/config/tunnel", {
			method: "PUT",
			body: JSON.stringify({
				token: "tunnel-token",
				hostname: "t3.gpio.example",
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			hardware: string;
			tunnel: { token: string; hostname: string };
		};
		expect(body.hardware).toBe("orangepi");
		expect(body.tunnel.token).toBe("***");
		expect(body.tunnel.hostname).toBe("t3.gpio.example");
		expect(applied).toBe(1);

		const status = await deviceFetch("v1/status");
		const statusBody = (await status.json()) as {
			tunnel: { configured: boolean; hostname: string };
			t3?: unknown;
			t3codePairing?: unknown;
		};
		expect(statusBody.tunnel.configured).toBe(true);
		expect(statusBody.t3).toBeUndefined();
		expect(statusBody.t3codePairing).toBeUndefined();
		expect(
			(statusBody as { disk?: { totalMb: number; availMb: number } }).disk,
		).toEqual({ totalMb: 7456, availMb: 1800 });
		expect(
			(
				statusBody as {
					network?: {
						type: string;
						ssid: string;
						interface: string;
						connection: string;
					};
				}
			).network,
		).toEqual({
			type: "wifi",
			ssid: "bench",
			interface: "wlan0",
			connection: "bench",
		});
	});

	test("returns companion info when signed", async () => {
		const denied = await deviceFetch("v1/info", {}, false);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/info");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			host: { hostname: "orangepi" },
			network: {
				type: "ethernet",
				ssid: "",
				interface: "eth0",
				connection: "Wired",
			},
		});
	});

	test("returns redacted journal excerpt", async () => {
		const denied = await deviceFetch("v1/logs", {}, false);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/logs");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			text: "token [redacted] failed",
			sinceHours: 24,
		});
	});

	test("starts companion update when signed", async () => {
		const denied = await deviceFetch("v1/update", { method: "POST" }, false);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/update", { method: "POST" });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ started: true });
		expect(updateStarts).toBe(1);
	});

	test("starts project sync when signed", async () => {
		const denied = await deviceFetch(
			"v1/projects/sync",
			{ method: "POST" },
			false,
		);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/projects/sync", {
			method: "POST",
			body: JSON.stringify({ owner: "ada", name: "blink" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ started: true });
		expect(projectSyncs).toEqual([{ owner: "ada", name: "blink" }]);
	});

	test("removes project when signed", async () => {
		const denied = await deviceFetch(
			"v1/projects/remove",
			{ method: "POST" },
			false,
		);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/projects/remove", {
			method: "POST",
			body: JSON.stringify({ owner: "ada", name: "blink" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			removed: true,
		});
		expect(projectRemoves).toEqual([{ owner: "ada", name: "blink" }]);
	});

	test("pushes project when signed", async () => {
		const denied = await deviceFetch(
			"v1/projects/push",
			{ method: "POST" },
			false,
		);
		expect(denied.status).toBe(401);
		const response = await deviceFetch("v1/projects/push", {
			method: "POST",
			body: JSON.stringify({ owner: "ada", name: "blink" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			committed: true,
			pushed: true,
			sha: "abc123",
			message: "Save project from board",
		});
		expect(projectPushes).toEqual([
			{
				owner: "ada",
				name: "blink",
				message: "Save project from board",
			},
		]);
	});

	test("quotes tunnel env values", () => {
		expect(
			tunnelEnvContents({
				token: 'a"b',
				hostname: "host",
				apiHostname: "",
				tunnelId: "",
			}),
		).toContain('TUNNEL_TOKEN="a\\"b"');
	});

	test("stores dashboard secrets without echoing them", async () => {
		const response = await deviceFetch("v1/config/secrets", {
			method: "PUT",
			body: JSON.stringify({
				gpioAiKey: "ai-key",
				githubToken: "gh-key",
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			gpioAiKey: boolean;
			githubToken: boolean;
			source: string;
		};
		expect(body.gpioAiKey).toBe(true);
		expect(body.githubToken).toBe(true);
		expect(body.source).toBe("device-api");
	});

	test("returns whether a gpio ai key is set, not the secret", async () => {
		const response = await deviceFetch("v1/config/ai-key");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { gpioAiKey: boolean };
		expect(body.gpioAiKey).toBe(true);
	});

	test("sets github credentials on the pi api", async () => {
		const response = await deviceFetch("v1/config/github", {
			method: "PUT",
			body: JSON.stringify({
				githubUsername: "ada",
				githubToken: "gh-key",
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			githubReady: boolean;
			githubUrl: boolean;
		};
		expect(body.githubReady).toBe(true);
		expect(body.githubUrl).toBe(true);
	});

	test("rejects unsigned wifi and uuid mismatch", async () => {
		const unsigned = await deviceFetch(
			"v1/config/wifi",
			{
				method: "PUT",
				body: JSON.stringify({
					ssid: "bench",
					psk: "secret-pass",
					uuid: "pair-uuid",
				}),
			},
			false,
		);
		expect(unsigned.status).toBe(401);

		const mismatch = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "bench",
				psk: "secret-pass",
				uuid: "other-uuid",
			}),
		});
		expect(mismatch.status).toBe(403);
	});

	test("sets the clock from a valid future wifi signature", async () => {
		const issued = Date.now() + 180_000;
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
			now: issued,
		});
		const response = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...auth,
			},
			body,
		});
		expect(response.status).toBe(200);
		expect(clockSets.at(-1)).toBe(issued);

		const older = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
			now: Date.now() + 90_000,
		});
		const replay = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...older,
			},
			body,
		});
		expect(replay.status).toBe(403);
		expect(await replay.json()).toEqual({
			error: "expired device signature",
		});
		expect(clockSets.at(-1)).toBe(issued);
	});

	test("rejects an expired wifi signature without setting the clock", async () => {
		const before = clockSets.length;
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
			now: Date.now() - 120_000,
		});
		const response = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...auth,
			},
			body,
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "expired device signature",
		});
		expect(clockSets.length).toBe(before);
	});

	test("does not set the clock for an invalid future signature", async () => {
		const before = clockSets.length;
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
			now: Date.now() + 240_000,
		});
		auth["X-Gpio-Signature"] = btoa("not-a-real-signature");
		const response = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...auth,
			},
			body,
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "invalid device signature",
		});
		expect(clockSets.length).toBe(before);
	});

	test("applies signed wifi when pairing uuid matches", async () => {
		const response = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "bench",
				psk: "secret-pass",
				uuid: "pair-uuid",
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			ssid: string;
			connected: boolean;
		};
		expect(body.ssid).toBe("bench");
		expect(body.connected).toBe(true);
		expect(wifiSsid).toBe("bench");
	});

	test("returns classified wifi connect failures", async () => {
		const missing = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "missing",
				psk: "secret-pass",
				uuid: "pair-uuid",
			}),
		});
		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual({
			ssid: "missing",
			connected: false,
			reason: "ssid-not-found",
			error: "wifi network not found",
		});

		const badpass = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "badpass",
				psk: "secret-pass",
				uuid: "pair-uuid",
			}),
		});
		expect(badpass.status).toBe(400);
		expect(await badpass.json()).toEqual({
			ssid: "badpass",
			connected: false,
			reason: "password",
			error: "wifi password incorrect",
		});

		const nowifi = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "nowifi",
				psk: "secret-pass",
				uuid: "pair-uuid",
			}),
		});
		expect(nowifi.status).toBe(400);
		expect(await nowifi.json()).toEqual({
			ssid: "nowifi",
			connected: false,
			reason: "no-device",
			error: "wifi adapter not available",
		});
	});

	test("claims pairing uuid-key", async () => {
		const denied = await deviceFetch("v1/pairing/claim", {
			method: "POST",
			body: JSON.stringify({
				uuid: "pair-uuid",
				key: "wrong",
				userId: "user-1",
				email: "ada@gpio-companion.com",
			}),
		});
		expect(denied.status).toBe(403);

		const claimed = await deviceFetch("v1/pairing/claim", {
			method: "POST",
			body: JSON.stringify({
				uuid: "pair-uuid",
				key: "pair-key",
				userId: "user-1",
				email: "ada@gpio-companion.com",
			}),
		});
		expect(claimed.status).toBe(200);
		const body = (await claimed.json()) as {
			paired: boolean;
			login: string;
		};
		expect(body.paired).toBe(true);
		expect(body.login).toBe("ada");
	});

	test("credentials are signed and include pairing key", async () => {
		await deviceFetch("v1/config/tunnel", {
			method: "PUT",
			body: JSON.stringify({
				token: "tunnel-token",
				hostname: "t3.gpio.example",
				apiHostname: "api.gpio.example",
				tunnelId: "tun-1",
			}),
		});
		const response = await deviceFetch("v1/pairing/credentials");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			uuid: string;
			key: string;
			paired: boolean;
			userId: string;
			deviceUrl: string;
		};
		expect(body.uuid).toBe("pair-uuid");
		expect(body.key).toBe("pair-key");
		expect(body.paired).toBe(true);
		expect(body.userId).toBe("user-1");
		expect(body.deviceUrl).toBe("https://api.gpio.example");
	});

	test("transfers owner and unpairs", async () => {
		const transferred = await deviceFetch("v1/pairing/transfer", {
			method: "POST",
			body: JSON.stringify({
				uuid: "pair-uuid",
				key: "pair-key",
				userId: "user-2",
				email: "bob@gpio-companion.com",
			}),
		});
		expect(transferred.status).toBe(200);
		const transferredBody = (await transferred.json()) as {
			login: string;
			paired: boolean;
		};
		expect(transferredBody.paired).toBe(true);
		expect(transferredBody.login).toBe("bob");

		const unpaired = await deviceFetch("v1/pairing/unpair", {
			method: "POST",
			body: JSON.stringify({
				uuid: "pair-uuid",
				key: "pair-key",
			}),
		});
		expect(unpaired.status).toBe(200);
		const unpairedBody = (await unpaired.json()) as { paired: boolean };
		expect(unpairedBody.paired).toBe(false);
	});

	test("does not serve t3 pair or status", async () => {
		const unsigned = await deviceFetch(
			"v1/t3/pair",
			{ method: "POST", body: "" },
			false,
		);
		expect(unsigned.status).toBe(401);
		const paired = await deviceFetch("v1/t3/pair", {
			method: "POST",
			body: "",
		});
		expect(paired.status).toBe(404);
		const started = await deviceFetch("v1/t3/start", {
			method: "POST",
			body: "",
		});
		expect(started.status).toBe(404);
		const status = await deviceFetch("v1/t3/status");
		expect(status.status).toBe(404);
	});

	test("github token is loopback only", async () => {
		const response = await fetch(`${server.url}v1/github-token`);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("not configured");
	});
});

describe("untrusted clock nonce replay", () => {
	test("accepts a stale pairing signature once per nonce", async () => {
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: "/v1/pairing/credentials",
			now: Date.now() - 120_000,
			nonce: "offline-pair-1",
		});
		const ok = await fetch(`${untrusted.url}v1/pairing/credentials`, {
			headers: { ...auth },
		});
		expect(ok.status).toBe(200);

		const replay = await fetch(`${untrusted.url}v1/pairing/credentials`, {
			headers: { ...auth },
		});
		expect(replay.status).toBe(403);
		expect(await replay.json()).toEqual({
			error: "replayed device signature",
		});
	});

	test("still rejects a stale signature when the clock is trusted", async () => {
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: "/v1/pairing/credentials",
			now: Date.now() - 120_000,
		});
		const response = await fetch(`${server.url}v1/pairing/credentials`, {
			headers: { ...auth },
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "expired device signature",
		});
	});

	test("accepts an offline grant wifi envelope", async () => {
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: keys.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
		});
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const envelope = await signOfflineEnvelope({
			bundle,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
		});
		const response = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...envelope.headers,
			},
			body,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ssid: "bench",
			connected: true,
		});
	});

	test("rejects an offline grant for another pairing uuid", async () => {
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: keys.privateKeyPem,
			uuid: "other-uuid",
			userId: "user-1",
		});
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const envelope = await signOfflineEnvelope({
			bundle,
			method: "PUT",
			path: "/v1/config/wifi",
			body,
		});
		const response = await fetch(`${server.url}v1/config/wifi`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...envelope.headers,
			},
			body,
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "offline grant device mismatch",
		});
	});

	test("rejects pairing routes on an offline grant", async () => {
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: keys.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
		});
		const envelope = await signOfflineEnvelope({
			bundle,
			method: "GET",
			path: "/v1/info",
		});
		const hijack = await signOfflineEnvelope({
			bundle,
			method: "POST",
			path: "/v1/pairing/unpair",
			body: JSON.stringify({ uuid: "pair-uuid" }),
		});
		const info = await fetch(`${server.url}v1/info`, {
			headers: { ...envelope.headers },
		});
		expect(info.status).toBe(200);
		const unpair = await fetch(`${server.url}v1/pairing/unpair`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...hijack.headers,
			},
			body: hijack.body,
		});
		expect(unpair.status).toBe(403);
		expect(await unpair.json()).toEqual({
			error: "offline grant scope mismatch",
		});
	});
});
