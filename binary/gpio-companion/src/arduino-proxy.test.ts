import { afterAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	constants,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
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
	proxyUploadHooks,
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

	test("merges sketch pin status into the snapshot", () => {
		const proxy = memoryArduinoProxy({ connected: true });
		proxy.apply("raspberrypi", { physical: 13, dir: "out", value: 0 });
		proxy.setSketchStatus?.(() => ({
			pid: process.pid,
			pins: [
				{ physical: 9, mode: "out", value: 1 },
				{ physical: 11, mode: "out", analog: 200 },
				{ physical: 14, mode: "in", adc: 512 },
			],
		}));
		const snapshot = proxy.snapshot("raspberrypi");
		expect(snapshot.sketch).toBe(true);
		const pin9 = snapshot.pins.find((pin) => pin.physical === 9);
		expect(pin9?.sketch).toBe(true);
		expect(pin9?.dir).toBe("out");
		expect(pin9?.value).toBe(1);
		const pin11 = snapshot.pins.find((pin) => pin.physical === 11);
		expect(pin11?.sketch).toBe(true);
		expect(pin11?.dir).toBe("pwm");
		expect(pin11?.analog).toBe(200);
		expect(pin11?.pwm).toBeCloseTo(78.4, 1);
		expect(pin11?.value).toBe(1);
		const pin14 = snapshot.pins.find((pin) => pin.physical === 14);
		expect(pin14?.sketch).toBe(true);
		expect(pin14?.dir).toBe("in");
		expect(pin14?.adc).toBe(512);
		const pin13 = snapshot.pins.find((pin) => pin.physical === 13);
		expect(pin13?.sketch).toBeUndefined();
		expect(pin13?.value).toBe(0);
	});

	test("snapshot has no sketch flag without a running sketch", () => {
		const proxy = memoryArduinoProxy({ connected: true });
		proxy.setSketchStatus?.(() => null);
		const snapshot = proxy.snapshot("raspberrypi");
		expect(snapshot.sketch).toBeUndefined();
		expect(
			snapshot.pins.some((pin) => pin.sketch === true),
		).toBe(false);
	});
});

describe("live handshake", () => {
	test("capability overrides a usb uno label on mega", async () => {
		const proxy = createArduinoProxy({
			probeMs: 200,
			openSerial: (_port, _baud, onData) => {
				return {
					write() {
						onData(Uint8Array.from([0xf0, 0x79, 2, 5, 0xf7]));
						const pins = Array.from({ length: 70 }, () => 0x7f);
						onData(Uint8Array.from([0xf0, 0x6c, ...pins, 0xf7]));
					},
					close() {
						undefined;
					},
				};
			},
		});
		const status = await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
		expect(status.board).toBe("mega");
		expect(status.fqbn).toBe("arduino:avr:mega");
		expect(status.pins.some((pin) => pin.physical === 54)).toBe(true);
	});

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

	test("upload restores hupcl and does not reopen the proxy mid-flash", async () => {
		const root = await mkdtemp(join(tmpdir(), "proxy-hupcl-"));
		const logPath = join(root, "stty.log");
		writeFileSync(
			join(root, "stty"),
			'#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$GPIO_STTY_LOG"\n',
		);
		chmodSync(join(root, "stty"), 0o755);
		const previousPath = process.env.PATH;
		process.env.PATH = `${root}${previousPath ? `:${previousPath}` : ""}`;
		process.env.GPIO_STTY_LOG = logPath;
		let opens = 0;
		const proxy = createArduinoProxy({
			probeMs: 30,
			reconnectDelaysMs: [],
			listPorts: async () =>
				JSON.stringify({
					detected_ports: [
						{
							port: { address: "/dev/ttyACM0", protocol: "serial" },
							matching_boards: [
								{ name: "Arduino Uno", fqbn: "arduino:avr:uno" },
							],
						},
					],
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
		const hooks = proxyUploadHooks(proxy, { settleMs: 0, retryMs: 0 });
		try {
			await proxy.attach("/dev/ttyACM0", "arduino:avr:uno");
			const opened = opens;
			await hooks.beforeUpload({ port: "/dev/ttyACM0" });
			const carrier = readFileSync(logPath, "utf8");
			expect(carrier).toContain("hupcl");
			expect(carrier).not.toContain("-hupcl");
			await proxy.probe();
			expect(opens).toBe(opened);
			await hooks.afterUpload(
				{ port: "/dev/ttyACM0", fqbn: "arduino:avr:uno" },
				{ ok: false },
			);
			expect(opens).toBeGreaterThan(opened);
			expect(proxy.status().connected).toBe(true);
			expect(proxy.status().fqbn).toBe("arduino:avr:uno");
		} finally {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
			delete process.env.GPIO_STTY_LOG;
		}
	});

	test("probe asks arduino-cli for the fqbn", async () => {
		const root = await mkdtemp(join(tmpdir(), "proxy-cli-"));
		const marker = join(root, "asked");
		writeFileSync(
			join(root, "arduino-cli"),
			`#!/bin/sh\ntouch "$GPIO_PROXY_ASKED"\nprintf '%s\\n' '{"detected_ports":[{"port":{"address":"/dev/ttyACM0","protocol":"serial","label":"Arduino UNO"},"matching_boards":[{"name":"Arduino Uno","fqbn":"arduino:avr:uno"}]}]}'\n`,
		);
		chmodSync(join(root, "arduino-cli"), 0o755);
		const previous = process.env.PATH;
		process.env.PATH = `${root}${previous ? `:${previous}` : ""}`;
		process.env.GPIO_PROXY_ASKED = marker;
		try {
			const proxy = createArduinoProxy({
				probeMs: 40,
				reconnectDelaysMs: [],
				openSerial: (_port, _baud, onData) => {
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
			const status = await proxy.probe();
			expect(existsSync(marker)).toBe(true);
			expect(status.connected).toBe(true);
			expect(status.board).toBe("uno");
			expect(status.fqbn).toBe("arduino:avr:uno");
		} finally {
			if (previous === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previous;
			}
			delete process.env.GPIO_PROXY_ASKED;
		}
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
		expect(TTY_NOCTTY_FLAGS & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
	});

	test("usb serial reads do not consume the bun thread pool", async () => {
		const root = await mkdtemp(join(tmpdir(), "tty-pool-"));
		const listPath = join(root, "slaves");
		const marker = join(root, "marker");
		writeFileSync(marker, "pool-ok");
		const proc = Bun.spawn(
			[
				"python3",
				"-c",
				[
					"import os, pty, time",
					"masters = []",
					"slaves = []",
					"for _ in range(5):",
					"    master, slave = pty.openpty()",
					"    masters.append(master)",
					"    slaves.append(os.ttyname(slave))",
					"os.write(masters[0], b'ready\\n')",
					"open(os.environ['PTY_LIST'], 'w').write('\\n'.join(slaves))",
					"time.sleep(30)",
				].join("\n"),
			],
			{
				env: { ...process.env, PTY_LIST: listPath },
				stdout: "ignore",
				stderr: "pipe",
			},
		);
		const streams: ReturnType<typeof openTtyReadStream>[] = [];
		try {
			const started = Date.now();
			while (!existsSync(listPath)) {
				if (Date.now() - started > 2_000) {
					throw new Error("pty helper timed out");
				}
				await Bun.sleep(20);
			}
			const paths = readFileSync(listPath, "utf8")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			expect(paths).toHaveLength(5);
			let got = "";
			for (const path of paths) {
				const stream = openTtyReadStream(path);
				streams.push(stream);
				stream.on("data", (buf) => {
					if (buf instanceof Buffer) {
						got += buf.toString();
					}
				});
			}
			await Bun.sleep(40);
			const read = await Promise.race([
				Bun.file(marker)
					.text()
					.then(() => "ok" as const),
				Bun.sleep(1_000).then(() => "timeout" as const),
			]);
			expect(read).toBe("ok");
			const deadline = Date.now() + 500;
			while (!got.includes("ready") && Date.now() < deadline) {
				await Bun.sleep(20);
			}
			expect(got).toContain("ready");
		} finally {
			for (const stream of streams) {
				stream.destroy();
			}
			proc.kill();
			await proc.exited.catch(() => undefined);
		}
	}, 10_000);
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

const proxyPortRoot = await mkdtemp(join(tmpdir(), "proxy-port-"));
const proxyPortKeys = await generateDeviceKeyPair();
const proxyPortJobs: Array<{ port?: string }> = [];
const proxyPortFlash = memoryFlash(
	JSON.stringify({
		detected_ports: [
			{ port: { address: "/dev/ttyS0", protocol: "serial" } },
			{
				port: { address: "/dev/ttyACM0", protocol: "serial" },
				matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
			},
		],
	}),
	async (job) => {
		proxyPortJobs.push({ port: job.port });
		return { ok: true, log: "ok" };
	},
);
const proxyPortStores = {
	store: fileConfigStore(join(proxyPortRoot, "config.json"), "raspberrypi"),
	secrets: fileSecretsStore(join(proxyPortRoot, "secrets.env")),
	pairing: filePairingStore(
		join(proxyPortRoot, "pairing.json"),
		"pair-uuid",
		"pair-key",
	),
};
const proxyPortServer = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: proxyPortStores.store,
	secrets: proxyPortStores.secrets,
	pairing: proxyPortStores.pairing,
	applyTunnel: async () => undefined,
	deviceAuth: { keyId: "k", publicKeyPem: proxyPortKeys.publicKeyPem },
	flash: proxyPortFlash,
	run: memoryRun(),
	proxy: memoryArduinoProxy(),
});

describe("proxy flash port", () => {
	afterAll(() => {
		proxyPortServer.stop();
	});

	test("ttyS0 alone does not start an upload", async () => {
		let started = false;
		const onlyUart = memoryFlash(
			JSON.stringify({
				detected_ports: [
					{ port: { address: "/dev/ttyS0", protocol: "serial" } },
				],
			}),
			async () => {
				started = true;
				return { ok: false, log: "should not upload" };
			},
		);
		const uartServer = startDeviceApi({
			port: 0,
			hostname: "127.0.0.1",
			store: proxyPortStores.store,
			secrets: proxyPortStores.secrets,
			pairing: proxyPortStores.pairing,
			applyTunnel: async () => undefined,
			deviceAuth: { keyId: "k", publicKeyPem: proxyPortKeys.publicKeyPem },
			flash: onlyUart,
			run: memoryRun(),
			proxy: memoryArduinoProxy(),
		});
		try {
			const response = await fetch(`${uartServer.url}v1/flash/proxy`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					fqbn: "arduino:avr:uno",
					port: "/dev/ttyS0",
				}),
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: "no arduino connected" });
			expect(started).toBe(false);
			expect(onlyUart.status().last).toBeNull();
		} finally {
			uartServer.stop();
		}
	});

	test("ttyS0 plus ttyACM0 uploads to ttyACM0", async () => {
		proxyPortJobs.length = 0;
		const omitted = await fetch(`${proxyPortServer.url}v1/flash/proxy`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fqbn: "arduino:avr:uno" }),
		});
		expect(omitted.status).toBe(200);
		for (let i = 0; i < 20 && proxyPortFlash.status().running; i += 1) {
			await Bun.sleep(10);
		}
		expect(proxyPortJobs.at(-1)?.port).toBe("/dev/ttyACM0");

		const forced = await fetch(`${proxyPortServer.url}v1/flash/proxy`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				fqbn: "arduino:avr:uno",
				port: "/dev/ttyS0",
			}),
		});
		expect(forced.status).toBe(200);
		for (let i = 0; i < 20 && proxyPortFlash.status().running; i += 1) {
			await Bun.sleep(10);
		}
		expect(proxyPortJobs.at(-1)?.port).toBe("/dev/ttyACM0");
	});
});
