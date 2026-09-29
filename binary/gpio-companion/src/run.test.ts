import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair, signDeviceRequest } from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import { filePairingStore } from "./pairing.ts";
import {
	createRunController,
	formatPinmap,
	memoryRun,
	type RunProcess,
} from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

describe("run controller", () => {
	test("starts and records last result", async () => {
		const run = memoryRun();
		expect(run.start({ dir: "/tmp/blink" })).toEqual({ started: true });
		expect(run.status().running).toBe(true);
		await Bun.sleep(20);
		expect(run.status().running).toBe(false);
		expect(run.status().last?.ok).toBe(true);
	});

	test("refuses a second job while running", async () => {
		let release: () => void = () => undefined;
		const hang = new Promise<{ ok: boolean; log: string }>((resolve) => {
			release = () => resolve({ ok: true, log: "done" });
		});
		const run = memoryRun(() => hang);
		run.start({ dir: "/tmp/a" });
		expect(() => run.start({ dir: "/tmp/b" })).toThrow("already running");
		release();
		await Bun.sleep(20);
	});

	test("needs a sketch", () => {
		const run = memoryRun(undefined, false);
		expect(() => run.start({ dir: "/tmp/empty" })).toThrow(".ino");
	});

	test("stop is idempotent", () => {
		const run = memoryRun();
		expect(run.stop()).toEqual({ stopped: true });
	});

	test("stop during compile does not start the sketch", async () => {
		let spawned = false;
		let compiling = false;
		let release: () => void = () => undefined;
		const hang = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run = createRunController({
			hardware: "raspberrypi",
			hasSketch: () => true,
			async compileAndRun(job) {
				const proc: RunProcess = {
					exited: hang.then(() => 0),
					kill() {
						release();
					},
				};
				job.setProc?.(proc);
				compiling = true;
				await hang;
				if (job.cancelled?.()) {
					return { ok: true, log: "stopped" };
				}
				spawned = true;
				return {
					ok: true,
					log: "warning: lock unused\n",
					proc: { exited: Promise.resolve(0), kill() {} },
				};
			},
		});
		expect(run.start({ dir: "/tmp/fade" })).toEqual({ started: true });
		const wait = Date.now();
		while (!compiling && Date.now() - wait < 1000) {
			await Bun.sleep(10);
		}
		expect(run.status().running).toBe(true);
		expect(run.stop()).toEqual({ stopped: true });
		const start = Date.now();
		while (run.status().running && Date.now() - start < 1000) {
			await Bun.sleep(10);
		}
		expect(run.status().running).toBe(false);
		expect(spawned).toBe(false);
	});

	test("live log is sketch output not gcc warnings", async () => {
		const chunks: string[] = [];
		const run = createRunController({
			hardware: "raspberrypi",
			hasSketch: () => true,
			onLog: (chunk) => {
				chunks.push(chunk);
			},
			async compileAndRun() {
				return {
					ok: true,
					log: "warning: lock unused\n",
					proc: {
						exited: Promise.resolve(0),
						kill() {},
						stdout: new Blob(["LED fade\n"]).stream(),
					},
				};
			},
		});
		expect(run.start({ dir: "/tmp/fade" })).toEqual({ started: true });
		const start = Date.now();
		while (run.status().running && Date.now() - start < 1000) {
			await Bun.sleep(10);
		}
		expect(chunks.join("")).toBe("LED fade\n");
		expect(run.status().last?.log).toContain("warning");
		expect(run.status().last?.log).toContain("LED fade");
	});

	test("proxy sketch restores serial after stop", async () => {
		const proxy = memoryArduinoProxy({
			connected: true,
			port: "/dev/ttyACM0",
		});
		const holds: boolean[] = [];
		const origHold = proxy.hold.bind(proxy);
		proxy.hold = (next) => {
			holds.push(next);
			origHold(next);
		};
		let released = 0;
		const origRelease = proxy.release.bind(proxy);
		proxy.release = () => {
			released += 1;
			origRelease();
		};
		let attached = 0;
		const origAttach = proxy.attach.bind(proxy);
		proxy.attach = async (port, fqbn) => {
			attached += 1;
			return origAttach(port, fqbn);
		};
		let finish: () => void = () => undefined;
		const hang = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const run = createRunController({
			hardware: "raspberrypi",
			proxy,
			hasSketch: () => true,
			proxyRestoreMs: { delay: 0, retry: 0 },
			async compileAndRun() {
				expect(() =>
					proxy.apply("raspberrypi", { physical: 13, dir: "out", value: 1 }),
				).toThrow("not connected");
				await hang;
				return {
					ok: true,
					log: "ok",
					proc: { exited: Promise.resolve(0), kill() {} },
				};
			},
		});
		expect(run.start({ dir: "/tmp/arduino-proxy-blink" })).toEqual({
			started: true,
		});
		const wait = Date.now();
		while (released === 0 && Date.now() - wait < 1000) {
			await Bun.sleep(10);
		}
		expect(released).toBe(1);
		expect(holds).toEqual([true]);
		finish();
		const done = Date.now();
		while (run.status().running && Date.now() - done < 1000) {
			await Bun.sleep(10);
		}
		const restore = Date.now();
		while (attached === 0 && Date.now() - restore < 1000) {
			await Bun.sleep(10);
		}
		expect(holds).toEqual([true, false]);
		expect(attached).toBe(1);
		const snapshot = proxy.apply("raspberrypi", {
			physical: 13,
			dir: "out",
			value: 1,
		});
		expect(snapshot.pins.find((pin) => pin.physical === 13)?.value).toBe(1);
	});
});

describe("formatPinmap", () => {
	test("writes physical chip lines", () => {
		expect(
			formatPinmap({
				hardware: "orangepi",
				pins: [
					{ physical: 1, name: "3V3", type: "power" },
					{ physical: 6, name: "GND", type: "gnd" },
					{
						physical: 7,
						name: "GPIO",
						type: "gpio",
						chip: "gpiochip1",
						line: 118,
					},
					{ physical: 15, name: "GPIO", type: "gpio", unresolved: true },
				],
			}),
		).toBe(
			"hardware orangepi\n1 power\n6 gnd\n7 gpio gpiochip1 118\n15 unresolved\n",
		);
	});
});

const dir = await mkdtemp(join(tmpdir(), "run-api-"));
const keys = await generateDeviceKeyPair();
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
});

afterAll(() => {
	server.stop();
});

describe("run http", () => {
	test("loopback unsigned sketches", async () => {
		const listed = await fetch(`${server.url}v1/run/sketches`);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({ sketches: [] });
	});

	test("loopback unsigned start and stop", async () => {
		const start = await fetch(`${server.url}v1/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ dir: "/tmp/blink" }),
		});
		expect(start.status).toBe(200);
		expect(await start.json()).toEqual({ started: true });
		await Bun.sleep(20);
		const status = await fetch(`${server.url}v1/run`);
		const snap = (await status.json()) as {
			running: boolean;
			last: { ok: boolean };
		};
		expect(snap.running).toBe(false);
		expect(snap.last.ok).toBe(true);
		const stop = await fetch(`${server.url}v1/run/stop`, { method: "POST" });
		expect(stop.status).toBe(200);
		expect(await stop.json()).toEqual({ stopped: true });
	});

	test("signed post works", async () => {
		const body = JSON.stringify({ dir: "/tmp/blink" });
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "POST",
			path: "/v1/run",
			body,
		});
		const response = await fetch(`${server.url}v1/run`, {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body,
		});
		expect(response.status).toBe(200);
	});

	test("off-loopback unsigned is 401", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/run", { method: "GET" }),
				stores.store,
				stores.secrets,
				stores.pairing,
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
				undefined,
				undefined,
				undefined,
				{ run },
			),
		).rejects.toThrow("missing device signature");
	});
});
