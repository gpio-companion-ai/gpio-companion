import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair, signDeviceRequest } from "gpio-companion";
import { memoryFlash } from "./flash.ts";
import { filePairingStore } from "./pairing.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const portsJson = JSON.stringify({
	detected_ports: [
		{
			port: { address: "/dev/ttyUSB0", protocol: "serial" },
			matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
		},
	],
});

describe("flash controller", () => {
	test("starts and records last result", async () => {
		const flash = memoryFlash(portsJson);
		expect(flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/blink" })).toEqual(
			{ started: true },
		);
		expect(flash.status().running).toBe(true);
		await Bun.sleep(20);
		expect(flash.status().running).toBe(false);
		expect(flash.status().last?.ok).toBe(true);
		expect((await flash.ports()).ports[0]?.fqbn).toBe("arduino:avr:uno");
	});

	test("refuses a second job while running", async () => {
		let release: () => void = () => undefined;
		const hang = new Promise<{ ok: boolean; log: string }>((resolve) => {
			release = () => resolve({ ok: true, log: "done" });
		});
		const flash = memoryFlash(portsJson, () => hang);
		flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/a" });
		expect(() =>
			flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/b" }),
		).toThrow("already running");
		release();
		await Bun.sleep(20);
	});

	test("needs a sketch", () => {
		const flash = memoryFlash(portsJson, undefined, false);
		expect(() =>
			flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/empty" }),
		).toThrow(".ino");
	});
});

const dir = await mkdtemp(join(tmpdir(), "flash-api-"));
const keys = await generateDeviceKeyPair();
const flash = memoryFlash(portsJson);
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
	flash,
});

afterAll(() => {
	server.stop();
});

describe("flash http", () => {
	test("loopback unsigned sketches", async () => {
		const listed = await fetch(`${server.url}v1/flash/sketches`);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({ sketches: [] });
	});

	test("loopback unsigned ports and start", async () => {
		const ports = await fetch(`${server.url}v1/flash/ports`);
		expect(ports.status).toBe(200);
		const body = (await ports.json()) as { ports: { address: string }[] };
		expect(body.ports[0]?.address).toBe("/dev/ttyUSB0");

		const start = await fetch(`${server.url}v1/flash`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fqbn: "arduino:avr:uno", dir: "/tmp/blink" }),
		});
		expect(start.status).toBe(200);
		expect(await start.json()).toEqual({ started: true });
		await Bun.sleep(20);
		const status = await fetch(`${server.url}v1/flash`);
		const snap = (await status.json()) as {
			running: boolean;
			last: { ok: boolean };
		};
		expect(snap.running).toBe(false);
		expect(snap.last.ok).toBe(true);
	});

	test("signed post works", async () => {
		const body = JSON.stringify({ fqbn: "arduino:avr:uno", dir: "/tmp/blink" });
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "POST",
			path: "/v1/flash",
			body,
		});
		const response = await fetch(`${server.url}v1/flash`, {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body,
		});
		expect(response.status).toBe(200);
	});

	test("off-loopback unsigned is 401", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/flash", { method: "GET" }),
				stores.store,
				stores.secrets,
				stores.pairing,
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
				undefined,
				undefined,
				undefined,
				{ flash },
			),
		).rejects.toThrow("missing device signature");
	});
});
