import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEBUG_EVENT_PATH,
	DEBUG_PATH,
	DEBUG_VIA_HEADER,
	type DebugEvent,
	debugAuthQuery,
	generateDeviceKeyPair,
	parseDebugEvent,
	signDeviceRequest,
	WifiConnectError,
} from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import { memoryFlash } from "./flash.ts";
import { createGpioController, memoryGpioBackend } from "./gpio.ts";
import { filePairingStore } from "./pairing.ts";
import { memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const dir = await mkdtemp(join(tmpdir(), "gpio-companion-debug-"));
const keys = await generateDeviceKeyPair();
const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(dir, "config.json"), "orangepi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
	applyTunnel: async () => undefined,
	gpio: createGpioController(memoryGpioBackend("")),
	flash: memoryFlash(),
	run: memoryRun(),
	proxy: memoryArduinoProxy(),
	applyWifi: async (config) => {
		if (config.ssid === "missing") {
			throw new WifiConnectError("ssid-not-found");
		}
		return { ssid: config.ssid };
	},
	deviceAuth: {
		keyId: keys.keyId,
		publicKeyPem: keys.publicKeyPem,
	},
	clockTrusted: () => true,
});

afterAll(() => {
	server.stop();
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

async function signedDebugQuery(now?: number): Promise<string> {
	const headers = await signDeviceRequest({
		privateKeyPem: keys.privateKeyPem,
		keyId: keys.keyId,
		method: "GET",
		path: DEBUG_PATH,
		now,
	});
	return debugAuthQuery(headers);
}

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (predicate()) {
			return;
		}
		await Bun.sleep(10);
	}
	throw new Error("timeout");
}

describe("device debug suite", () => {
	test("rejects unsigned debug websocket", async () => {
		const missing = await fetch(`${server.url}v1/debug`);
		expect(missing.status).toBe(401);
		const invalid = await fetch(`${server.url}v1/debug?x-gpio-signature=nope`);
		expect(invalid.status).toBe(401);
	});

	test("accepts debug auth from headers when query is missing", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: DEBUG_PATH,
		});
		const response = await fetch(`${server.url}v1/debug`, { headers });
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("upgrade failed");
	});

	test("rejects expired debug signature", async () => {
		const query = await signedDebugQuery(Date.now() - 120_000);
		const response = await fetch(`${server.url}v1/debug?${query}`);
		expect(response.status).toBe(403);
	});

	test("rejects debug origin that is not the dashboard", async () => {
		const query = await signedDebugQuery();
		const blocked = await fetch(`${server.url}v1/debug?${query}`, {
			headers: { origin: "https://evil.example" },
		});
		expect(blocked.status).toBe(401);
	});

	test("accepts native websocket origins", async () => {
		const native = await fetch(
			`${server.url}v1/debug?${await signedDebugQuery()}`,
			{ headers: { origin: "https://api-abc.gpio-companion.com" } },
		);
		expect(native.status).toBe(400);
		expect(await native.text()).toBe("upgrade failed");
		const tauri = await fetch(
			`${server.url}v1/debug?${await signedDebugQuery()}`,
			{ headers: { origin: "https://tauri.localhost" } },
		);
		expect(tauri.status).toBe(400);
		expect(await tauri.text()).toBe("upgrade failed");
	});

	test("streams request warnings without secrets", async () => {
		const query = await signedDebugQuery();
		const events: DebugEvent[] = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/debug?${query}`,
		);
		ws.addEventListener("message", (event) => {
			const parsed = parseDebugEvent(JSON.parse(String(event.data)));
			if (parsed) {
				events.push(parsed);
			}
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});

		const status = await deviceFetch("v1/status");
		expect(status.status).toBe(200);
		await Bun.sleep(50);
		expect(events).toEqual([]);

		const wifi = await deviceFetch("v1/config/wifi", {
			method: "PUT",
			body: JSON.stringify({
				ssid: "missing",
				psk: "secret-psk-value",
				uuid: "pair-uuid",
			}),
		});
		expect(wifi.status).toBe(400);
		await waitFor(() => events.length > 0);
		expect(events[0]).toMatchObject({
			level: "warning",
			method: "PUT",
			path: "/v1/config/wifi",
			status: 400,
			message: "wifi network not found",
		});
		expect(JSON.stringify(events)).not.toContain("secret-psk-value");
		expect(JSON.stringify(events)).not.toContain("pair-key");
		ws.close();
	});

	test("streams not-found warnings", async () => {
		const query = await signedDebugQuery();
		const events: DebugEvent[] = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/debug?${query}`,
		);
		ws.addEventListener("message", (event) => {
			const parsed = parseDebugEvent(JSON.parse(String(event.data)));
			if (parsed) {
				events.push(parsed);
			}
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});
		const missing = await deviceFetch("v1/nope");
		expect(missing.status).toBe(404);
		await waitFor(() =>
			events.some((event) => event.status === 404 && event.path === "/v1/nope"),
		);
		ws.close();
	});

	test("streams ble request/response including success", async () => {
		const query = await signedDebugQuery();
		const events: DebugEvent[] = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/debug?${query}`,
		);
		ws.addEventListener("message", (event) => {
			const parsed = parseDebugEvent(JSON.parse(String(event.data)));
			if (parsed) {
				events.push(parsed);
			}
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});

		const status = await deviceFetch("v1/status", {
			headers: { [DEBUG_VIA_HEADER]: "ble" },
		});
		expect(status.status).toBe(200);
		await waitFor(() =>
			events.some(
				(event) =>
					event.via === "ble" &&
					event.level === "info" &&
					event.path === "/v1/status" &&
					event.status === 200,
			),
		);

		const ingest = await fetch(`${server.url}v1/debug/event`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				method: "GET",
				path: "/v1/info",
				status: 401,
				message: "missing device signature",
				via: "ble",
			}),
		});
		expect(ingest.status).toBe(200);
		await waitFor(() =>
			events.some(
				(event) =>
					event.via === "ble" &&
					event.status === 401 &&
					event.path === "/v1/info" &&
					event.message === "missing device signature",
			),
		);
		ws.close();
	});

	test("rejects debug event ingest off loopback", async () => {
		await expect(
			handleDeviceRequest(
				new Request(`https://api.example${DEBUG_EVENT_PATH}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						method: "GET",
						path: "/v1/info",
						status: 401,
						via: "ble",
					}),
				}),
				fileConfigStore(join(dir, "config.json"), "orangepi"),
				fileSecretsStore(join(dir, "secrets.env")),
				filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
			),
		).rejects.toThrow("debug event is local-only");
	});
});
