import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair, signDeviceRequest } from "gpio-companion";
import {
	createArduinoFlash,
	createFlashController,
	type FlashRunner,
	memoryFlash,
} from "./flash.ts";
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

const acmPortsJson = JSON.stringify({
	detected_ports: [
		{
			port: { address: "/dev/ttyACM0", protocol: "serial" },
			matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
		},
	],
});

async function makeSketchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "flash-retry-"));
	await writeFile(join(dir, "sketch.c"), "void setup(void) {}\n");
	return dir;
}

function queueRunner(results: Array<{ code: number; log: string }>): {
	runner: FlashRunner;
	calls: string[][];
} {
	const calls: string[][] = [];
	const runner: FlashRunner = async (cmd) => {
		calls.push(cmd);
		return results.shift() ?? { code: 0, log: "ok" };
	};
	return { runner, calls };
}

async function waitIdle(flash: ReturnType<typeof memoryFlash>): Promise<void> {
	for (let i = 0; i < 200 && flash.status().running; i += 1) {
		await Bun.sleep(10);
	}
	expect(flash.status().running).toBe(false);
}

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

describe("flash retry", () => {
	test("retries a retryable upload failure and succeeds", async () => {
		const dir = await makeSketchDir();
		const { runner, calls } = queueRunner([
			{ code: 0, log: "compile ok" },
			{ code: 1, log: "avrdude: stk500_recv(): programmer is not responding" },
			{ code: 0, log: "upload ok" },
		]);
		let carrierCalls = 0;
		const flash = createArduinoFlash(undefined, {
			runner,
			carrier: async () => {
				carrierCalls += 1;
			},
			listPorts: () => Promise.resolve(acmPortsJson),
			ensureCore: async () => "",
			settleMs: 1,
		});
		flash.start({ fqbn: "arduino:avr:uno", dir, port: "/dev/ttyACM0" });
		await waitIdle(flash);
		expect(flash.status().last?.ok).toBe(true);
		expect(flash.status().last?.log).toContain("attempt 2/3");
		expect(flash.status().last?.log).toContain("upload ok");
		expect(calls.length).toBe(3);
		expect(calls[0]?.[1]).toBe("compile");
		expect(calls[1]?.[1]).toBe("upload");
		expect(calls[2]?.[1]).toBe("upload");
		expect(carrierCalls).toBe(1);
	});

	test("does not retry a permanent upload failure", async () => {
		const dir = await makeSketchDir();
		const { runner, calls } = queueRunner([
			{ code: 0, log: "compile ok" },
			{ code: 1, log: "sketch too big; need 32768 bytes" },
		]);
		const flash = createArduinoFlash(undefined, {
			runner,
			listPorts: () => Promise.resolve(acmPortsJson),
			ensureCore: async () => "",
			settleMs: 1,
		});
		flash.start({ fqbn: "arduino:avr:uno", dir, port: "/dev/ttyACM0" });
		await waitIdle(flash);
		expect(flash.status().last?.ok).toBe(false);
		expect(flash.status().last?.log).not.toContain("attempt 2/3");
		expect(calls.length).toBe(2);
	});

	test("stops retrying when the port disappears", async () => {
		const dir = await makeSketchDir();
		const { runner, calls } = queueRunner([
			{ code: 0, log: "compile ok" },
			{ code: 1, log: "no device found on port /dev/ttyACM0" },
		]);
		const flash = createArduinoFlash(undefined, {
			runner,
			listPorts: () => Promise.resolve('{"detected_ports":[]}'),
			ensureCore: async () => "",
			settleMs: 1,
		});
		flash.start({ fqbn: "arduino:avr:uno", dir, port: "/dev/ttyACM0" });
		await waitIdle(flash);
		expect(flash.status().last?.ok).toBe(false);
		expect(flash.status().last?.log).toContain("disappeared; not retrying");
		expect(calls.length).toBe(2);
	});

	test("exhausts upload attempts on repeated timeouts", async () => {
		const dir = await makeSketchDir();
		const { runner, calls } = queueRunner([
			{ code: 0, log: "compile ok" },
			{ code: 1, log: "arduino-cli timed out after 60s" },
			{ code: 1, log: "arduino-cli timed out after 60s" },
			{ code: 1, log: "arduino-cli timed out after 60s" },
		]);
		let carrierCalls = 0;
		const flash = createArduinoFlash(undefined, {
			runner,
			carrier: async () => {
				carrierCalls += 1;
			},
			listPorts: () => Promise.resolve(acmPortsJson),
			ensureCore: async () => "",
			settleMs: 1,
		});
		flash.start({ fqbn: "arduino:avr:uno", dir, port: "/dev/ttyACM0" });
		await waitIdle(flash);
		expect(flash.status().last?.ok).toBe(false);
		expect(flash.status().last?.log).toContain("attempt 3/3");
		expect(calls.filter((cmd) => cmd[1] === "upload").length).toBe(3);
		expect(carrierCalls).toBe(2);
	});
});

describe("flash watchdog", () => {
	test("fails a stale job and accepts a new one", async () => {
		let hang = true;
		const flash = memoryFlash(
			portsJson,
			async () => {
				if (hang) {
					await new Promise<{ ok: boolean; log: string }>(() => undefined);
				}
				return { ok: true, log: "second" };
			},
			true,
			{ maxJobMs: 60 },
		);
		flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/a" });
		await Bun.sleep(150);
		const status = flash.status();
		expect(status.running).toBe(false);
		expect(status.last?.ok).toBe(false);
		expect(status.last?.log).toContain("timed out");
		hang = false;
		expect(flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/b" })).toEqual({
			started: true,
		});
		await waitIdle(flash);
		expect(flash.status().last?.ok).toBe(true);
		expect(flash.status().last?.log).toBe("second");
	});
});

describe("flash stop", () => {
	test("stops a running job and keeps the stopped result", async () => {
		let release: () => void = () => undefined;
		const hang = new Promise<{ ok: boolean; log: string }>((resolve) => {
			release = () => resolve({ ok: true, log: "late ok" });
		});
		const flash = memoryFlash(portsJson, () => hang);
		flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/a" });
		expect(flash.stop()).toEqual({ stopped: true });
		expect(flash.status().running).toBe(false);
		expect(flash.status().last?.log).toBe("stopped");
		release();
		await Bun.sleep(30);
		expect(flash.status().last?.log).toBe("stopped");
	});

	test("a stopped job does not clobber the next job", async () => {
		const flash = createFlashController({
			async listPorts() {
				return portsJson;
			},
			async compileAndUpload(job) {
				return { ok: true, log: job.dir };
			},
			hasSketch: () => true,
			async afterUpload() {
				await Bun.sleep(60);
			},
		});
		flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/a" });
		await Bun.sleep(10);
		expect(flash.stop()).toEqual({ stopped: true });
		flash.start({ fqbn: "arduino:avr:uno", dir: "/tmp/b" });
		expect(flash.status().running).toBe(true);
		await Bun.sleep(5);
		expect(flash.status().running).toBe(true);
		await waitIdle(flash);
		expect(flash.status().running).toBe(false);
		expect(flash.status().last?.log).toBe("/tmp/b");
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

	test("loopback unsigned stop", async () => {
		const stop = await fetch(`${server.url}v1/flash/stop`, {
			method: "POST",
		});
		expect(stop.status).toBe(200);
		expect(await stop.json()).toEqual({ stopped: true });
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
