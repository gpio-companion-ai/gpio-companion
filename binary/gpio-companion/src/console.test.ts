import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CONSOLE_PATH,
	debugAuthQuery,
	generateDeviceKeyPair,
	signDeviceRequest,
} from "gpio-companion";
import { createConsoleHub } from "./console.ts";
import { filePairingStore } from "./pairing.ts";
import { memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

describe("console hub", () => {
	test("appends host log and usb start/stop", () => {
		const frames: string[] = [];
		const hub = createConsoleHub({
			openUsb(_port, _baud, onChunk) {
				onChunk("hello\n");
				return { close() {} };
			},
			flushMs: 0,
		});
		hub.add({
			send(data) {
				frames.push(data);
			},
			close() {},
		});
		hub.setHostRunning(true);
		hub.appendHost("pin 7\n");
		expect(hub.snapshot().host.running).toBe(true);
		expect(hub.snapshot().host.log).toBe("pin 7\n");
		expect(hub.startUsb({ port: "/dev/ttyACM0" })).toEqual({ started: true });
		expect(hub.snapshot().usb.open).toBe(true);
		expect(hub.snapshot().usb.log).toContain("hello");
		expect(hub.stopUsb()).toEqual({ stopped: true });
		expect(hub.snapshot().usb.open).toBe(false);
		expect(frames.some((item) => item.includes("pin 7"))).toBe(true);
	});

	test("rejects a bad usb port", () => {
		const hub = createConsoleHub();
		expect(() => hub.startUsb({ port: "/dev/ttyS0" })).toThrow("tty");
	});
});

const dir = await mkdtemp(join(tmpdir(), "console-api-"));
const keys = await generateDeviceKeyPair();
const consoleHub = createConsoleHub({
	openUsb() {
		return { close() {} };
	},
});
const run = memoryRun();
const stores = {
	store: fileConfigStore(join(dir, "config.json"), "raspberrypi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
};

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	...stores,
	applyTunnel: async () => undefined,
	deviceAuth: { keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
	run,
	console: consoleHub,
});

afterAll(() => {
	server.stop();
});

describe("console http", () => {
	test("loopback unsigned snapshot", async () => {
		const response = await fetch(`${server.url}v1/console`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			host: { running: boolean };
			usb: { open: boolean };
		};
		expect(body.host.running).toBe(false);
		expect(body.usb.open).toBe(false);
	});

	test("starts and stops usb", async () => {
		const start = await fetch(`${server.url}v1/console/usb`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ port: "/dev/ttyACM0" }),
		});
		expect(start.status).toBe(200);
		expect(await start.json()).toEqual({ started: true });
		const snap = await fetch(`${server.url}v1/console`);
		expect(((await snap.json()) as { usb: { open: boolean } }).usb.open).toBe(
			true,
		);
		const stop = await fetch(`${server.url}v1/console/usb/stop`, {
			method: "POST",
		});
		expect(stop.status).toBe(200);
		expect(await stop.json()).toEqual({ stopped: true });
	});

	test("signed websocket handshake upgrades", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: CONSOLE_PATH,
		});
		const response = await fetch(
			`${server.url}v1/console?${debugAuthQuery(headers)}`,
			{ headers: { upgrade: "websocket" } },
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("upgrade failed");
	});

	test("streams host chunks over the companion websocket", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: CONSOLE_PATH,
		});
		const messages: Array<{ host?: { log?: string }; chunk?: string }> = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/console?${debugAuthQuery(headers)}`,
		);
		ws.addEventListener("message", (event) => {
			messages.push(
				JSON.parse(String(event.data)) as {
					host?: { log?: string };
					chunk?: string;
				},
			);
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});
		const start = Date.now();
		while (Date.now() - start < 1000 && messages.length === 0) {
			await Bun.sleep(10);
		}
		consoleHub.appendHost("live\n");
		const after = Date.now();
		while (
			Date.now() - after < 1000 &&
			!messages.some(
				(item) => item.chunk === "live\n" || item.host?.log?.includes("live"),
			)
		) {
			await Bun.sleep(10);
		}
		ws.close();
		expect(
			messages.some(
				(item) => item.chunk === "live\n" || item.host?.log?.includes("live"),
			),
		).toBe(true);
	});

	test("unsigned websocket is 401", async () => {
		const missing = await fetch(`${server.url}v1/console`, {
			headers: { upgrade: "websocket" },
		});
		expect(missing.status).toBe(401);
	});

	test("off-loopback unsigned is 401", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/console", { method: "GET" }),
				stores.store,
				stores.secrets,
				stores.pairing,
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
				undefined,
				undefined,
				undefined,
				{ console: consoleHub },
			),
		).rejects.toThrow("missing device signature");
	});
});
