import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GpioApply,
	type GpioSnapshot,
	generateDeviceKeyPair,
	signDeviceRequest,
} from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import type { GpioController } from "./gpio.ts";
import { filePairingStore } from "./pairing.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";
import { memoryVerify } from "./verify.ts";

const diagram = JSON.stringify({
	version: 1,
	parts: [
		{ id: "bb1", type: "wokwi-breadboard-half" },
		{
			id: "header",
			type: "gpio-companion-header",
			attrs: { hardware: "raspberrypi" },
		},
		{ id: "led1", type: "wokwi-led" },
	],
	connections: [
		["header:13", "bb1:12a", "orange", []],
		["header:15", "bb1:12e", "orange", []],
		["header:11", "bb1:10a", "yellow", []],
		["led1:A", "bb1:10e", "green", []],
	],
});

function memoryGpio(linked: boolean): GpioController {
	const values = new Map<number, 0 | 1>();
	function snapshot(): GpioSnapshot {
		const pins: GpioSnapshot["pins"] = [11, 13, 15].map((physical) => ({
			physical,
			name: "GPIO",
			type: "gpio" as const,
			dir: "in" as const,
			value: values.get(physical) ?? 0,
		}));
		return { hardware: "raspberrypi", pins };
	}
	return {
		async snapshot() {
			return snapshot();
		},
		async apply(_hardware, put: GpioApply) {
			if ("dir" in put && put.dir === "out") {
				const value = put.value === 1 ? 1 : 0;
				values.set(put.physical, value);
				if (linked && (put.physical === 13 || put.physical === 15)) {
					values.set(13, value);
					values.set(15, value);
				}
			}
			return snapshot();
		},
	};
}

describe("verify controller", () => {
	test("passes linked jumpers and leaves drive nets unknown", async () => {
		const verify = memoryVerify({
			gpio: memoryGpio(true),
			diagram,
		});
		expect(verify.start({ repo: "blink-led" })).toEqual({ started: true });
		expect(verify.status().running).toBe(true);
		await Bun.sleep(20);
		expect(verify.status().running).toBe(false);
		const last = verify.status().last;
		expect(last?.ok).toBe(true);
		expect(
			last?.results.find((item) => item.kind === "continuity")?.status,
		).toBe("pass");
		expect(last?.results.find((item) => item.kind === "drive")?.status).toBe(
			"unknown",
		);
	});

	test("fails an open jumper", async () => {
		const verify = memoryVerify({
			gpio: memoryGpio(false),
			diagram,
		});
		verify.start({ repo: "blink-led" });
		await Bun.sleep(20);
		expect(
			verify.status().last?.results.find((item) => item.kind === "continuity")
				?.status,
		).toBe("fail");
	});

	test("409 while running", async () => {
		let release: () => void = () => undefined;
		const hang = new Promise<void>((resolve) => {
			release = () => resolve();
		});
		const verify = memoryVerify({
			gpio: memoryGpio(true),
			diagram,
			sleep: () => hang,
		});
		verify.start({ repo: "blink-led" });
		expect(() => verify.start({ repo: "blink-led" })).toThrow(
			"already running",
		);
		release();
		await Bun.sleep(20);
	});

	test("pulses arduino-proxy jumpers when connected", async () => {
		const values = new Map<number, 0 | 1>();
		const base = memoryArduinoProxy({ connected: true });
		const proxy = {
			...base,
			snapshot(hardware: "raspberrypi") {
				return {
					...base.snapshot(hardware),
					pins: [12, 13].map((physical) => ({
						physical,
						name: `D${physical}`,
						type: "gpio" as const,
						dir: "in" as const,
						value: values.get(physical) ?? 0,
					})),
				};
			},
			apply(hardware: "raspberrypi", put: GpioApply) {
				if ("dir" in put && put.dir === "out") {
					const value = put.value === 1 ? 1 : 0;
					values.set(12, value);
					values.set(13, value);
				}
				return proxy.snapshot(hardware);
			},
		};
		const verify = memoryVerify({
			gpio: memoryGpio(false),
			proxy,
			diagram: JSON.stringify({
				version: 1,
				parts: [
					{ id: "bb1", type: "wokwi-breadboard-half" },
					{
						id: "uno",
						type: "gpio-arduino-proxy",
						attrs: { board: "uno" },
					},
				],
				connections: [
					["uno:13", "bb1:12a", "orange", []],
					["uno:12", "bb1:12e", "orange", []],
				],
			}),
		});
		verify.start({ repo: "blink-led" });
		await Bun.sleep(20);
		expect(
			verify.status().last?.results.find((item) => item.kind === "continuity")
				?.status,
		).toBe("pass");
	});
});

const dir = await mkdtemp(join(tmpdir(), "verify-api-"));
const keys = await generateDeviceKeyPair();
const verify = memoryVerify({
	gpio: memoryGpio(true),
	diagram,
});
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
	verify,
	projectsDir: join(dir, "projects"),
});

afterAll(() => {
	server.stop();
});

describe("verify api", () => {
	test("loopback unsigned status", async () => {
		const response = await fetch(`${server.url}v1/verify`);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ running: false });
	});

	test("loopback unsigned start", async () => {
		const start = await fetch(`${server.url}v1/verify`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repo: "blink-led" }),
		});
		expect(start.status).toBe(200);
		expect(await start.json()).toEqual({ started: true });
		await Bun.sleep(20);
		const status = await fetch(`${server.url}v1/verify`);
		const snap = (await status.json()) as {
			running: boolean;
			last: { ok: boolean };
		};
		expect(snap.running).toBe(false);
		expect(snap.last.ok).toBe(true);
	});

	test("signed post works", async () => {
		const body = JSON.stringify({ repo: "blink-led" });
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "POST",
			path: "/v1/verify",
			body,
		});
		const response = await fetch(`${server.url}v1/verify`, {
			method: "POST",
			headers: { "content-type": "application/json", ...auth },
			body,
		});
		expect(response.status).toBe(200);
	});

	test("off-loopback unsigned is 401", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/verify", { method: "GET" }),
				stores.store,
				stores.secrets,
				stores.pairing,
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
				undefined,
				undefined,
				undefined,
				{ verify },
			),
		).rejects.toThrow("missing device signature");
	});
});
