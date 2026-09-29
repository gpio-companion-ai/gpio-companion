import { afterAll, describe, expect, test } from "bun:test";
import {
	constants,
	lstatSync,
	mkdirSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair, signDeviceRequest } from "gpio-companion";
import {
	createArduinoProxy,
	listUsbSerialPorts,
	memoryArduinoProxy,
	openTtyReadStream,
	serialWatchDir,
	TTY_NOCTTY_FLAGS,
	usbSerialStamp,
	watchUsbSerialPorts,
} from "./arduino-proxy.ts";
import { memoryFlash } from "./flash.ts";
import { filePairingStore } from "./pairing.ts";
import { formatProxyPinmap, memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

describe("memory arduino proxy", () => {
	test("applies pin writes when connected", async () => {
		const proxy = memoryArduinoProxy({ connected: true });
		const snapshot = proxy.apply("raspberrypi", {
			physical: 13,
			dir: "out",
			value: 1,
		});
		expect(snapshot.target).toBe("arduino-proxy");
		expect(snapshot.pins.find((pin) => pin.physical === 13)?.value).toBe(1);
	});

	test("refuses writes when disconnected", () => {
		const proxy = memoryArduinoProxy();
		expect(() =>
			proxy.apply("raspberrypi", { physical: 13, dir: "out", value: 1 }),
		).toThrow("not connected");
	});

	test("refuses writes after release until attach", async () => {
		const proxy = memoryArduinoProxy({ connected: true });
		proxy.release();
		expect(() =>
			proxy.apply("raspberrypi", { physical: 13, dir: "out", value: 1 }),
		).toThrow("not connected");
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		const snapshot = proxy.apply("raspberrypi", {
			physical: 13,
			dir: "out",
			value: 1,
		});
		expect(snapshot.pins.find((pin) => pin.physical === 13)?.value).toBe(1);
	});

	test("attach sets board from fqbn", async () => {
		const proxy = memoryArduinoProxy();
		const status = await proxy.attach("/dev/ttyACM0", "arduino:avr:mega");
		expect(status.connected).toBe(true);
		expect(status.board).toBe("mega");
		expect(status.pins.some((pin) => pin.physical === 54)).toBe(true);
	});
});

describe("live handshake", () => {
	test("retries firmware query until the board answers", async () => {
		let writes = 0;
		let onData: (bytes: Uint8Array) => void = () => undefined;
		const proxy = createArduinoProxy({
			probeMs: 800,
			openSerial: (_port, _baud, data) => {
				onData = data;
				return {
					write() {
						writes += 1;
						if (writes >= 2) {
							onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
						}
					},
					close() {
						undefined;
					},
				};
			},
		});
		const status = await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(status.connected).toBe(true);
		expect(status.board).toBe("uno");
		expect(writes).toBeGreaterThanOrEqual(2);
	});

	test("pwm analogWrite is not clobbered by digital reports", async () => {
		let onData: (bytes: Uint8Array) => void = () => undefined;
		const writes: number[][] = [];
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, data) => {
				onData = data;
				return {
					write(bytes) {
						writes.push([...bytes]);
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(writes[0]).toEqual([0xff]);
		const snapshot = proxy.apply("orangepi", {
			physical: 9,
			dir: "pwm",
			analog: 64,
		});
		expect(snapshot.pins.find((pin) => pin.physical === 9)).toMatchObject({
			dir: "pwm",
			analog: 64,
		});
		expect(
			writes.some((item) => item[0] === 0xf4 && item[1] === 9 && item[2] === 3),
		).toBe(true);
		expect(
			writes.some(
				(item) => item[0] === 0xe9 && item[1] === 64 && item[2] === 0,
			),
		).toBe(true);
		onData(Uint8Array.from([0x91, 0, 0]));
		const pin = proxy.status().pins.find((item) => item.physical === 9);
		expect(pin?.dir).toBe("pwm");
		expect(pin?.analog).toBe(64);
	});

	test("analog reports update A0 adc", async () => {
		let onData: (bytes: Uint8Array) => void = () => undefined;
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, data) => {
				onData = data;
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		onData(Uint8Array.from([0xe0, 0x7b, 0x03]));
		expect(proxy.status().pins.find((pin) => pin.physical === 14)?.adc).toBe(
			507,
		);
	});

	test("dir in on A0 enables analog reporting", async () => {
		const writes: number[][] = [];
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, onData) => {
				return {
					write(bytes) {
						writes.push([...bytes]);
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		writes.length = 0;
		proxy.apply("orangepi", { physical: 14, dir: "in" });
		expect(
			writes.some(
				(item) => item[0] === 0xf4 && item[1] === 14 && item[2] === 2,
			),
		).toBe(true);
		expect(writes.some((item) => item[0] === 0xc0 && item[1] === 1)).toBe(true);
		writes.length = 0;
		proxy.apply("orangepi", { physical: 14, dir: "off" });
		expect(
			writes.some(
				(item) => item[0] === 0xf4 && item[1] === 14 && item[2] === 0x7f,
			),
		).toBe(true);
		expect(writes.some((item) => item[0] === 0xc0 && item[1] === 0)).toBe(true);
		expect(proxy.status().pins.find((pin) => pin.physical === 14)?.dir).toBe(
			"off",
		);
	});

	test("probe drops the proxy when the usb port vanishes", async () => {
		let listed = ["/dev/ttyACM0"];
		let closed = 0;
		const proxy = createArduinoProxy({
			probeMs: 200,
			listPorts: async () =>
				JSON.stringify({
					detected_ports: listed.map((address) => ({
						port: { address, protocol: "serial" },
					})),
				}),
			openSerial: (_port, _baud, onData) => {
				onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
				return {
					write() {
						undefined;
					},
					close() {
						closed += 1;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(proxy.status().connected).toBe(true);
		listed = [];
		const status = await proxy.probe();
		expect(status.connected).toBe(false);
		expect(closed).toBe(1);
		expect(proxy.status().port).toBeUndefined();
	});

	test("apply throws after release until attach", async () => {
		let opens = 0;
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, onData) => {
				opens += 1;
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		proxy.release();
		expect(() =>
			proxy.apply("orangepi", { physical: 13, dir: "out", value: 1 }),
		).toThrow("not connected");
		expect(proxy.status().connected).toBe(true);
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(opens).toBe(2);
		const snapshot = proxy.apply("orangepi", {
			physical: 13,
			dir: "out",
			value: 1,
		});
		expect(snapshot.pins.find((pin) => pin.physical === 13)?.value).toBe(1);
	});

	test("probe skips handshake while held", async () => {
		const listed = ["/dev/ttyACM0"];
		let opens = 0;
		const proxy = createArduinoProxy({
			probeMs: 200,
			listPorts: async () =>
				JSON.stringify({
					detected_ports: listed.map((address) => ({
						port: { address, protocol: "serial" },
					})),
				}),
			openSerial: (_port, _baud, onData) => {
				opens += 1;
				onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
				return {
					write() {
						undefined;
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(opens).toBe(1);
		proxy.hold(true);
		proxy.release();
		const held = await proxy.probe();
		expect(held.connected).toBe(true);
		expect(opens).toBe(1);
		expect(() =>
			proxy.apply("orangepi", { physical: 13, dir: "out", value: 1 }),
		).toThrow("not connected");
		proxy.hold(false);
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(opens).toBe(2);
	});

	test("probe retries while the port is still present", async () => {
		let opens = 0;
		const proxy = createArduinoProxy({
			probeMs: 40,
			reconnectDelaysMs: [15, 15],
			listPorts: async () =>
				JSON.stringify({
					detected_ports: [
						{
							port: { address: "/dev/ttyACM0", protocol: "serial" },
						},
					],
				}),
			openSerial: (_port, _baud, onData) => {
				opens += 1;
				if (opens < 3) {
					throw new Error("port not ready");
				}
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		const status = await proxy.probe();
		expect(status.connected).toBe(true);
		expect(opens).toBeGreaterThanOrEqual(3);
	});

	test("probe rescans if called again during an empty listing", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let phase = 0;
		let opens = 0;
		const proxy = createArduinoProxy({
			probeMs: 40,
			reconnectDelaysMs: [],
			listPorts: async () => {
				phase += 1;
				if (phase === 1) {
					await gate;
					return JSON.stringify({ detected_ports: [] });
				}
				return JSON.stringify({
					detected_ports: [
						{
							port: { address: "/dev/ttyACM0", protocol: "serial" },
						},
					],
				});
			},
			openSerial: (_port, _baud, onData) => {
				opens += 1;
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		const pending = proxy.probe();
		const again = proxy.probe();
		release();
		expect((await pending).connected).toBe(true);
		expect((await again).connected).toBe(true);
		expect(opens).toBe(1);
	});

	test("serial close does not throw while connected", async () => {
		let onClose: () => void = () => undefined;
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, onData, close) => {
				onClose = close;
				onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
				return {
					write() {
						undefined;
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		onClose();
		expect(proxy.status().connected).toBe(false);
	});

	test("digital reports only update pins set to input", async () => {
		let onData: (bytes: Uint8Array) => void = () => undefined;
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, data) => {
				onData = data;
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		onData(Uint8Array.from([0x90, 0x7f, 0x01]));
		expect(
			proxy.status().pins.find((pin) => pin.physical === 2)?.value,
		).toBeUndefined();
		proxy.apply("orangepi", { physical: 2, dir: "in" });
		onData(Uint8Array.from([0x90, 0x04, 0]));
		expect(proxy.status().pins.find((pin) => pin.physical === 2)?.value).toBe(
			1,
		);
		expect(
			proxy.status().pins.find((pin) => pin.physical === 3)?.value,
		).toBeUndefined();
		proxy.apply("orangepi", { physical: 4, dir: "out", value: 1 });
		onData(Uint8Array.from([0x90, 0, 0]));
		expect(proxy.status().pins.find((pin) => pin.physical === 4)?.value).toBe(
			1,
		);
		expect(proxy.status().pins.find((pin) => pin.physical === 2)?.value).toBe(
			0,
		);
	});
});

describe("tty open flags", () => {
	test("include O_NOCTTY so usb unplug cannot SIGHUP serve", () => {
		expect(TTY_NOCTTY_FLAGS & constants.O_NOCTTY).toBe(constants.O_NOCTTY);
		expect(TTY_NOCTTY_FLAGS & constants.O_NONBLOCK).toBe(0);
		const path = join(tmpdir(), `tty-noctty-${Date.now()}`);
		writeFileSync(path, "ok");
		const stream = openTtyReadStream(path);
		stream.destroy();
	});
});

describe("listUsbSerialPorts", () => {
	test("stamp changes when the same tty name is recreated", () => {
		const root = join(tmpdir(), `usb-stamp-${Date.now()}`);
		mkdirSync(root);
		const port = join(root, "ttyACM0");
		writeFileSync(port, "");
		const first = usbSerialStamp(root);
		expect(first).toContain(`${port}:${lstatSync(port).ino}:`);
		unlinkSync(port);
		writeFileSync(port, "");
		utimesSync(port, new Date(), new Date(Date.now() + 5_000));
		expect(usbSerialStamp(root)).not.toBe(first);
	});

	test("watches serial/by-id when that directory exists", () => {
		const root = join(tmpdir(), `usb-byid-${Date.now()}`);
		mkdirSync(join(root, "serial", "by-id"), { recursive: true });
		expect(serialWatchDir(root)).toBe(join(root, "serial", "by-id"));
	});

	test("watch fires when a tty node is recreated", async () => {
		const root = join(tmpdir(), `usb-watch-${Date.now()}`);
		mkdirSync(root);
		const port = join(root, "ttyACM0");
		writeFileSync(port, "");
		let hits = 0;
		const stop = watchUsbSerialPorts(
			() => {
				hits += 1;
			},
			{ devDir: root, intervalMs: 40 },
		);
		unlinkSync(port);
		writeFileSync(port, "");
		utimesSync(port, new Date(), new Date(Date.now() + 5_000));
		await Bun.sleep(150);
		stop();
		expect(hits).toBeGreaterThan(0);
	});

	test("finds ttyACM and ttyUSB only", () => {
		const root = join(tmpdir(), `usb-serial-${Date.now()}`);
		mkdirSync(root);
		writeFileSync(join(root, "ttyACM0"), "");
		writeFileSync(join(root, "ttyUSB1"), "");
		writeFileSync(join(root, "ttyS0"), "");
		expect(listUsbSerialPorts(root)).toEqual([
			join(root, "ttyACM0"),
			join(root, "ttyUSB1"),
		]);
	});
});

describe("formatProxyPinmap", () => {
	test("writes port and reserved pins", () => {
		const proxy = memoryArduinoProxy({ connected: true, port: "/dev/ttyACM0" });
		const text = formatProxyPinmap(proxy.status());
		expect(text).toContain("target arduino-proxy");
		expect(text).toContain("port /dev/ttyACM0");
		expect(text).toContain("0 reserved");
	});
});

const dir = await mkdtemp(join(tmpdir(), "proxy-api-"));
const keys = await generateDeviceKeyPair();
const proxy = memoryArduinoProxy({ connected: true, port: "/dev/ttyACM0" });
const flash = memoryFlash(
	JSON.stringify({
		detected_ports: [
			{
				port: { address: "/dev/ttyACM0", protocol: "serial" },
				matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
			},
		],
	}),
);
const stores = {
	store: fileConfigStore(join(dir, "config.json"), "raspberrypi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
};

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: stores.store,
	secrets: stores.secrets,
	pairing: stores.pairing,
	applyTunnel: async () => undefined,
	deviceAuth: { keyId: "k", publicKeyPem: keys.publicKeyPem },
	flash,
	run: memoryRun(),
	proxy,
});

afterAll(() => {
	server.stop();
});

describe("arduino-proxy http", () => {
	test("GET /v1/arduino-proxy", async () => {
		const response = await fetch(`${server.url}v1/arduino-proxy`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			connected: boolean;
			fqbn?: string;
		};
		expect(body.connected).toBe(true);
	});

	test("POST /v1/flash/proxy starts a job", async () => {
		const response = await fetch(`${server.url}v1/flash/proxy`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ started: true });
	});

	test("PUT gpio target arduino-proxy", async () => {
		await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		const response = await fetch(`${server.url}v1/gpio`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				target: "arduino-proxy",
				physical: 13,
				dir: "out",
				value: 1,
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			target?: string;
			pins: Array<{ physical: number; value?: number }>;
		};
		expect(body.target).toBe("arduino-proxy");
		expect(body.pins.find((pin) => pin.physical === 13)?.value).toBe(1);
	});
});

describe("signed flash proxy", () => {
	test("owner POST /v1/flash/proxy", async () => {
		const headers = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: "k",
			method: "POST",
			path: "/v1/flash/proxy",
			body: "{}",
		});
		const response = await handleDeviceRequest(
			new Request("https://api.example/v1/flash/proxy", {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: "{}",
			}),
			stores.store,
			stores.secrets,
			stores.pairing,
			async () => undefined,
			undefined,
			{ keyId: "k", publicKeyPem: keys.publicKeyPem },
			undefined,
			undefined,
			undefined,
			{ flash, proxy },
		);
		expect(response.status).toBe(200);
	});
});
