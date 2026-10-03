import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	debugAuthQuery,
	GPIO_PATH,
	generateDeviceKeyPair,
	signDeviceRequest,
} from "gpio-companion";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import {
	createGpioController,
	isGpioPermissionDenied,
	memoryGpioBackend,
	parseGpioGet,
	parseGpioGetMany,
	parseGpioinfo,
	parseWiringOpReadall,
	readSketchStatus,
	resolveHeaderLines,
} from "./gpio.ts";
import { createGpioStream } from "./gpio-stream.ts";
import { filePairingStore } from "./pairing.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const GPIOINFO = `
gpiochip0 - 58 lines:
	line   0:      unnamed       unused   input
	line   2:      "GPIO2"       unused   input
	line  17:      "GPIO17"      unused  output
gpiochip4 - 54 lines:
	line 437:      "GPIO25"      unused   input
`;

const READALL = `
 | BCM | wPi |   Name   | Mode | V | Physical | V | Mode | Name     | wPi | BCM |
 |     |     |     3.3v |      |   |  1 || 2  |   |      | 5v       |     |     |
 |  12 |   8 |   SDA.0  | ALT5 | 1 |  3 || 4  |   |      | 5v       |     |     |
 |   6 |   2 |  GPIO.2  |  IN  | 0 |  7 || 8  | 1 | ALT5 | TxD.3    |  15 |   13 |
`;

const OPI_INFO = `
gpiochip1 - 32 lines:
	line   5:      "SDA.0"       unused   input
	line  12:      "GPIO.2"      unused   input
	line  21:      "TxD.3"       unused  output
`;

const OPI3_LIVE_INFO = `
gpiochip0 - 64 lines:
gpiochip1 - 256 lines:
`;

const OPI3_CLASSIC_INFO = `
gpiochip0 - 256 lines:
gpiochip1 - 64 lines:
`;

describe("gpio permission", () => {
	test("detects chip open failures that need sudo fallback", () => {
		expect(
			isGpioPermissionDenied(
				"gpioget: unable to open chip /dev/gpiochip0: Permission denied",
			),
		).toBe(true);
		expect(isGpioPermissionDenied("Operation not permitted")).toBe(true);
		expect(isGpioPermissionDenied("invalid option -- 'c'")).toBe(false);
	});
});

describe("gpioget parse", () => {
	test("reads libgpiod v2 active/inactive and numeric", () => {
		expect(parseGpioGet('"118"=active')).toEqual({ value: 1 });
		expect(parseGpioGet('"118"=inactive')).toEqual({ value: 0 });
		expect(parseGpioGet("1")).toEqual({ value: 1 });
		expect(parseGpioGet("0")).toEqual({ value: 0 });
	});

	test("parses batched numeric and named values", () => {
		expect(parseGpioGetMany("1 0 1")).toEqual([
			{ value: 1 },
			{ value: 0 },
			{ value: 1 },
		]);
		expect(parseGpioGetMany("1\n0\n1")).toEqual([
			{ value: 1 },
			{ value: 0 },
			{ value: 1 },
		]);
		expect(parseGpioGetMany('"118"=active\n"122"=inactive')).toEqual([
			{ value: 1 },
			{ value: 0 },
		]);
	});
});

describe("gpioinfo parse", () => {
	test("reads named lines across chips", () => {
		const lines = parseGpioinfo(GPIOINFO);
		expect(lines).toContainEqual(
			expect.objectContaining({
				chip: "gpiochip0",
				line: 17,
				name: "GPIO17",
				dir: "out",
			}),
		);
		expect(lines).toContainEqual(
			expect.objectContaining({
				chip: "gpiochip4",
				line: 437,
				name: "GPIO25",
			}),
		);
		expect(lines.some((line) => line.name === "unnamed")).toBe(false);
		expect(lines).toContainEqual(
			expect.objectContaining({
				chip: "gpiochip0",
				line: 0,
				name: "",
				dir: "in",
			}),
		);
	});
});

describe("resolve header", () => {
	test("raspberry pi prefers named GPIO lines", () => {
		const resolved = resolveHeaderLines("raspberrypi", GPIOINFO);
		expect(resolved.get(11)).toEqual({
			chip: "gpiochip0",
			line: 17,
			name: "GPIO17",
		});
		expect(resolved.get(22)).toEqual({
			chip: "gpiochip4",
			line: 437,
			name: "GPIO25",
		});
	});

	test("orangepi uses wiringOP physical names", () => {
		const resolved = resolveHeaderLines("orangepi", OPI_INFO, READALL);
		expect(resolved.get(3)?.name).toBe("SDA.0");
		expect(resolved.get(7)?.name).toBe("GPIO.2");
		expect(resolved.get(8)?.name).toBe("TxD.3");
		expect(resolved.get(11)).toBeUndefined();
	});

	test("parses wiringOP physical names", () => {
		const names = parseWiringOpReadall(READALL);
		expect(names.get(3)).toBe("SDA.0");
		expect(names.get(7)).toBe("GPIO.2");
		expect(names.get(8)).toBe("TxD.3");
	});
});

describe("gpio controller", () => {
	test("snapshot and digital out", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		const before = await gpio.snapshot("raspberrypi");
		const pin11 = before.pins.find((pin) => pin.physical === 11);
		expect(pin11?.chip).toBe("gpiochip0");
		expect(pin11?.line).toBe(17);
		const after = await gpio.apply("raspberrypi", {
			physical: 11,
			dir: "out",
			value: 1,
		});
		expect(after.pins.find((pin) => pin.physical === 11)?.value).toBe(1);
	});

	test("reuses gpioinfo within the probe cache", async () => {
		let infoCalls = 0;
		const inner = memoryGpioBackend(GPIOINFO);
		const gpio = createGpioController({
			...inner,
			async gpioinfo() {
				infoCalls += 1;
				return inner.gpioinfo();
			},
		});
		await gpio.snapshot("raspberrypi");
		await gpio.snapshot("raspberrypi");
		expect(infoCalls).toBe(1);
		await gpio.apply("raspberrypi", { physical: 11, dir: "out", value: 1 });
		expect(infoCalls).toBe(2);
	});

	test("refuses power and reserved", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		await expect(
			gpio.apply("raspberrypi", { physical: 1, dir: "out", value: 1 }),
		).rejects.toThrow("power");
		await expect(
			gpio.apply("raspberrypi", { physical: 27, dir: "out", value: 1 }),
		).rejects.toThrow("reserved");
	});

	test("orangepi unresolved pin fails closed", async () => {
		const gpio = createGpioController(memoryGpioBackend(OPI_INFO));
		await expect(
			gpio.apply("orangepi", { physical: 11, dir: "out", value: 1 }),
		).rejects.toThrow("unresolved");
	});

	test("orange pi 3 lts uses sku chip/line without wiringop", async () => {
		const gpio = createGpioController(memoryGpioBackend(OPI3_LIVE_INFO), {
			model: "Orange Pi 3 LTS",
		});
		const snap = await gpio.snapshot("orangepi");
		expect(snap.pins).toHaveLength(26);
		const pin7 = snap.pins.find((pin) => pin.physical === 7);
		expect(pin7?.unresolved).toBeUndefined();
		expect(pin7?.chip).toBe("gpiochip1");
		expect(pin7?.line).toBe(118);
		const pin8 = snap.pins.find((pin) => pin.physical === 8);
		expect(pin8?.chip).toBe("gpiochip0");
		expect(pin8?.line).toBe(2);
		const after = await gpio.apply("orangepi", {
			physical: 7,
			dir: "out",
			value: 1,
		});
		expect(after.pins.find((pin) => pin.physical === 7)?.value).toBe(1);
		await expect(
			gpio.apply("orangepi", { physical: 40, dir: "out", value: 1 }),
		).rejects.toThrow("not on this header");
	});

	test("orange pi 3 lts follows gpiochip probe order", () => {
		const live = resolveHeaderLines(
			"orangepi",
			OPI3_LIVE_INFO,
			"",
			"Orange Pi 3 LTS",
		);
		expect(live.get(7)).toEqual({
			chip: "gpiochip1",
			line: 118,
			name: "PD22",
		});
		expect(live.get(8)).toEqual({
			chip: "gpiochip0",
			line: 2,
			name: "PL2",
		});
		const classic = resolveHeaderLines(
			"orangepi",
			OPI3_CLASSIC_INFO,
			"",
			"Orange Pi 3 LTS",
		);
		expect(classic.get(7)?.chip).toBe("gpiochip0");
		expect(classic.get(8)?.chip).toBe("gpiochip1");
	});

	test("snapshot includes pwm duty on PWM0 pins", async () => {
		const gpio = createGpioController(
			memoryGpioBackend(GPIOINFO, "", {}, { 0: 42.5 }),
		);
		const snap = await gpio.snapshot("raspberrypi");
		expect(snap.pins.find((pin) => pin.physical === 12)?.pwm).toBe(42.5);
		expect(snap.pins.find((pin) => pin.physical === 11)?.pwm).toBeUndefined();
	});

	test("analogWrite and tone land on the snapshot", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		const pwm = await gpio.apply("raspberrypi", {
			physical: 11,
			dir: "pwm",
			analog: 128,
		});
		expect(pwm.pins.find((pin) => pin.physical === 11)?.analog).toBe(128);
		expect(pwm.pins.find((pin) => pin.physical === 11)?.dir).toBe("pwm");
		const tone = await gpio.apply("raspberrypi", {
			physical: 11,
			op: "tone",
			hz: 440,
		});
		expect(tone.pins.find((pin) => pin.physical === 11)?.hz).toBe(440);
		const silent = await gpio.apply("raspberrypi", {
			physical: 11,
			op: "notone",
		});
		expect(silent.pins.find((pin) => pin.physical === 11)?.hz).toBeUndefined();
		const released = await gpio.apply("raspberrypi", {
			physical: 11,
			dir: "off",
		});
		expect(released.pins.find((pin) => pin.physical === 11)?.dir).toBe("off");
		expect(
			released.pins.find((pin) => pin.physical === 11)?.value,
		).toBeUndefined();
		expect(
			released.pins.find((pin) => pin.physical === 11)?.analog,
		).toBeUndefined();
	});
});

describe("gpio stream commands", () => {
	test("applies a put from the websocket and broadcasts", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		const sent: string[] = [];
		const stream = createGpioStream({
			gpio,
			hardware: async () => "raspberrypi",
			intervalMs: 60_000,
		});
		const ws = {
			send(data: string) {
				sent.push(data);
			},
			close() {},
		};
		stream.add(ws);
		const start = Date.now();
		while (Date.now() - start < 500 && sent.length === 0) {
			await Bun.sleep(10);
		}
		sent.length = 0;
		await stream.handle(
			ws,
			JSON.stringify({ physical: 11, dir: "out", value: 1 }),
		);
		const last = JSON.parse(sent.at(-1) ?? "{}") as {
			pins?: { physical: number; value?: number }[];
			patch?: { physical: number; value?: number }[];
		};
		const pins = last.pins ?? last.patch;
		expect(pins?.find((pin) => pin.physical === 11)?.value).toBe(1);
	});

	test("returns an error for power pins", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		const sent: string[] = [];
		const stream = createGpioStream({
			gpio,
			hardware: async () => "raspberrypi",
			intervalMs: 60_000,
		});
		const ws = {
			send(data: string) {
				sent.push(data);
			},
			close() {},
		};
		await stream.handle(
			ws,
			JSON.stringify({ physical: 1, dir: "out", value: 1 }),
		);
		expect(JSON.parse(sent.at(-1) ?? "{}")).toEqual({
			error: "pin 1 is power, not gpio",
		});
	});

	test("blocks header writes only while a header sketch runs", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		let target: "header" | "arduino-proxy" | null = null;
		const sent: string[] = [];
		const stream = createGpioStream({
			gpio,
			hardware: async () => "raspberrypi",
			intervalMs: 60_000,
			sketchTarget: () => target,
		});
		const ws = {
			send(data: string) {
				sent.push(data);
			},
			close() {},
		};
		stream.add(ws);
		const start = Date.now();
		while (Date.now() - start < 500 && sent.length === 0) {
			await Bun.sleep(10);
		}
		sent.length = 0;
		target = "header";
		await stream.handle(
			ws,
			JSON.stringify({ physical: 11, dir: "out", value: 1 }),
		);
		expect(JSON.parse(sent.at(-1) ?? "{}")).toEqual({
			error: "sketch is running — Live GPIO is read-only",
		});
		target = "arduino-proxy";
		await stream.handle(
			ws,
			JSON.stringify({ physical: 11, dir: "out", value: 1 }),
		);
		const applied = JSON.parse(sent.at(-1) ?? "{}") as {
			pins?: { physical: number; value?: number }[];
			patch?: { physical: number; value?: number }[];
		};
		const pins = applied.pins ?? applied.patch;
		expect(pins?.find((pin) => pin.physical === 11)?.value).toBe(1);
	});

	test("blocks proxy writes only while a proxy sketch runs", async () => {
		const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
		const proxy = memoryArduinoProxy({ connected: true });
		let target: "header" | "arduino-proxy" | null = null;
		const sent: string[] = [];
		const stream = createGpioStream({
			gpio,
			proxy,
			hardware: async () => "raspberrypi",
			intervalMs: 60_000,
			sketchTarget: () => target,
		});
		const ws = {
			send(data: string) {
				sent.push(data);
			},
			close() {},
		};
		stream.add(ws);
		const start = Date.now();
		while (Date.now() - start < 500 && sent.length === 0) {
			await Bun.sleep(10);
		}
		sent.length = 0;
		target = "arduino-proxy";
		await stream.handle(
			ws,
			JSON.stringify({
				physical: 13,
				dir: "out",
				value: 1,
				target: "arduino-proxy",
			}),
		);
		expect(JSON.parse(sent.at(-1) ?? "{}")).toEqual({
			error: "sketch is running — Live GPIO is read-only",
		});
		target = null;
		sent.length = 0;
		await stream.handle(
			ws,
			JSON.stringify({
				physical: 13,
				dir: "out",
				value: 1,
				target: "arduino-proxy",
			}),
		);
		const applied = JSON.parse(sent.at(-1) ?? "{}") as {
			pins?: { physical: number; value?: number }[];
			patch?: { physical: number; value?: number }[];
		};
		const pins = applied.pins ?? applied.patch;
		expect(pins?.find((pin) => pin.physical === 13)?.value).toBe(1);
	});
});

describe("sketch status file", () => {
	test("parses proxy-shaped pins without chip and line", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sketch-status-"));
		const path = join(dir, "status.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			path,
			JSON.stringify({
				pid: process.pid,
				pins: [
					{ physical: 0, mode: "out", value: 1 },
					{ physical: 11, mode: "out", analog: 200 },
					{ physical: 14, mode: "in", adc: 512 },
				],
			}),
		);
		const status = readSketchStatus(path);
		expect(status?.pins).toHaveLength(3);
		expect(status?.pins[0]?.physical).toBe(0);
		expect(status?.pins[1]?.analog).toBe(200);
		expect(status?.pins[2]?.adc).toBe(512);
		expect(status?.pins[2]?.mode).toBe("in");
	});
});

const dir = await mkdtemp(join(tmpdir(), "gpio-api-"));
const keys = await generateDeviceKeyPair();
const gpio = createGpioController(memoryGpioBackend(GPIOINFO));
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
	gpio,
});

afterAll(() => {
	server.stop();
});

describe("gpio http", () => {
	test("loopback unsigned get and put", async () => {
		const get = await fetch(`${server.url}v1/gpio`);
		expect(get.status).toBe(200);
		const snap = (await get.json()) as { hardware: string };
		expect(snap.hardware).toBe("raspberrypi");

		const put = await fetch(`${server.url}v1/gpio`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ physical: 11, value: 1 }),
		});
		expect(put.status).toBe(200);
		const after = (await put.json()) as {
			pins: { physical: number; value?: number }[];
		};
		expect(after.pins.find((pin) => pin.physical === 11)?.value).toBe(1);
	});

	test("signed loopback put still works", async () => {
		const body = JSON.stringify({ physical: 11, dir: "out", value: 0 });
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "PUT",
			path: "/v1/gpio",
			body,
		});
		const response = await fetch(`${server.url}v1/gpio`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...auth },
			body,
		});
		expect(response.status).toBe(200);
	});

	test("gpio websocket requires a signature", async () => {
		const missing = await fetch(`${server.url}v1/gpio`, {
			headers: { upgrade: "websocket" },
		});
		expect(missing.status).toBe(401);
	});

	test("signed gpio websocket handshake upgrades", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: GPIO_PATH,
		});
		const response = await fetch(
			`${server.url}v1/gpio?${debugAuthQuery(headers)}`,
			{ headers: { upgrade: "websocket" } },
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("upgrade failed");
	});

	test("drives a pin over the companion websocket", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: GPIO_PATH,
		});
		const snapshots: Array<{
			pins?: { physical: number; value?: number }[];
			patch?: { physical: number; value?: number }[];
			error?: string;
		}> = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/gpio?${debugAuthQuery(headers)}`,
		);
		ws.addEventListener("message", (event) => {
			snapshots.push(
				JSON.parse(String(event.data)) as {
					pins?: { physical: number; value?: number }[];
					patch?: { physical: number; value?: number }[];
					error?: string;
				},
			);
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});
		const start = Date.now();
		while (Date.now() - start < 1000 && snapshots.length === 0) {
			await Bun.sleep(10);
		}
		ws.send(JSON.stringify({ physical: 11, dir: "out", value: 1 }));
		const after = Date.now();
		function pinHigh(snap: (typeof snapshots)[number]) {
			return (
				(snap.pins ?? snap.patch)?.find((pin) => pin.physical === 11)?.value ===
				1
			);
		}
		while (Date.now() - after < 1000 && !snapshots.some(pinHigh)) {
			await Bun.sleep(10);
		}
		ws.close();
		expect(snapshots.some(pinHigh)).toBe(true);
	});

	test("streams gpio snapshots over the companion websocket", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "GET",
			path: GPIO_PATH,
		});
		const snapshots: Array<{ hardware?: string }> = [];
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/gpio?${debugAuthQuery(headers)}`,
		);
		ws.addEventListener("message", (event) => {
			snapshots.push(JSON.parse(String(event.data)) as { hardware?: string });
		});
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});
		const start = Date.now();
		while (Date.now() - start < 1000 && snapshots.length === 0) {
			await Bun.sleep(10);
		}
		ws.close();
		expect(snapshots[0]?.hardware).toBe("raspberrypi");
	});

	test("off-loopback unsigned is 401", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/gpio", { method: "GET" }),
				stores.store,
				stores.secrets,
				stores.pairing,
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
				undefined,
				undefined,
				undefined,
				{ gpio },
			),
		).rejects.toThrow("missing device signature");
	});
});
