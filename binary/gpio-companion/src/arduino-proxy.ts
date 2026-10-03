import {
	closeSync,
	constants,
	existsSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
	watch,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import {
	type ArduinoProxyBoard,
	ArduinoProxyError,
	type ArduinoProxyStatus,
	analogToPwmPercent,
	arduinoProxyBaud,
	arduinoProxyBoard,
	arduinoProxyBoardFromProbe,
	arduinoProxyPins,
	arduinoProxySnapshot,
	createFirmataParser,
	emptyArduinoProxyStatus,
	encodeAnalogMappingQuery,
	encodeAnalogWrite,
	encodeCapabilityQuery,
	encodeDigitalPin,
	encodeI2cRead,
	encodeI2cWrite,
	encodeQueryFirmware,
	encodeReportAnalog,
	encodeSerialWrite,
	encodeSetPinMode,
	encodeSpiTransfer,
	encodeSystemReset,
	FIRMWARE_BAUD_AVR,
	type FlashPort,
	type GpioApply,
	type GpioBusCommand,
	type GpioPinState,
	type GpioSnapshot,
	gpioPinOff,
	type HardwareId,
	isArduinoProxyFqbn,
	parseArduinoBoardList,
} from "gpio-companion";
import type { SketchStatus } from "./gpio.ts";

export type ProxySerial = {
	write(bytes: Uint8Array): void;
	close(): void;
	ready?: Promise<void>;
};

export type ArduinoProxyController = {
	status(): ArduinoProxyStatus;
	snapshot(hardware: HardwareId): GpioSnapshot;
	apply(hardware: HardwareId, command: GpioApply): GpioSnapshot;
	bus(command: GpioBusCommand): ArduinoProxyStatus;
	hold(held: boolean): void;
	release(): void;
	attach(port: string, fqbn?: string): Promise<ArduinoProxyStatus>;
	probe(): Promise<ArduinoProxyStatus>;
	setSketchStatus?(sketchStatus: () => SketchStatus | null): void;
};

export type ArduinoProxyOptions = {
	listPorts?: () => Promise<string>;
	openSerial?: (
		port: string,
		baud: number,
		onData: (bytes: Uint8Array) => void,
		onClose: () => void,
	) => ProxySerial;
	probeMs?: number;
	reconnectDelaysMs?: number[];
	onChange?: (status: ArduinoProxyStatus) => void;
};

const PROBE_MS = 3_500;
const QUERY_EVERY_MS = 250;
const RECONNECT_DELAYS_MS = [800, 2_000, 5_000];
const SERIAL_OPEN_MS = 1_000;
const TTY_POLL_MS = 15;
export const TTY_NOCTTY_FLAGS = constants.O_NOCTTY | constants.O_NONBLOCK;

type TtyListener = (value?: Buffer | Error) => void;

export type TtyByteStream = {
	on(event: "data", listener: (buf: Buffer) => void): TtyByteStream;
	on(event: "error", listener: (error: Error) => void): TtyByteStream;
	on(event: "end", listener: () => void): TtyByteStream;
	destroy(): void;
	write(chunk: Buffer | Uint8Array): boolean;
	end(): void;
};

export function openTtyReadStream(port: string): TtyByteStream {
	return openTtyByteStream(port, constants.O_RDONLY | TTY_NOCTTY_FLAGS, true);
}

export function openTtyWriteStream(port: string): TtyByteStream {
	return openTtyByteStream(port, constants.O_WRONLY | TTY_NOCTTY_FLAGS, false);
}

function openTtyByteStream(
	port: string,
	flags: number,
	readable: boolean,
): TtyByteStream {
	const fd = openSync(port, flags);
	const listeners: Record<"data" | "error" | "end", TtyListener[]> = {
		data: [],
		error: [],
		end: [],
	};
	const pending: { buf: Buffer; offset: number }[] = [];
	const buf = Buffer.alloc(4096);
	let destroyed = false;
	function emit(event: "data" | "error" | "end", value?: Buffer | Error) {
		if (destroyed && event !== "end") {
			return;
		}
		for (const listener of listeners[event]) {
			listener(value);
		}
	}
	function fail(error: unknown) {
		if (destroyed) {
			return;
		}
		emit(
			"error",
			error instanceof Error ? error : new Error("serial read failed"),
		);
		stream.destroy();
	}
	function flush() {
		while (pending.length > 0) {
			const next = pending[0];
			if (!next) {
				return;
			}
			try {
				const wrote = writeSync(
					fd,
					next.buf,
					next.offset,
					next.buf.length - next.offset,
				);
				next.offset += wrote;
				if (next.offset >= next.buf.length) {
					pending.shift();
				}
			} catch (error) {
				if (isAgain(error)) {
					return;
				}
				fail(error);
				return;
			}
		}
	}
	function readOnce() {
		for (;;) {
			try {
				const n = readSync(fd, buf, 0, buf.length, null);
				if (n > 0) {
					emit("data", Buffer.from(buf.subarray(0, n)));
					continue;
				}
				return;
			} catch (error) {
				if (isAgain(error)) {
					return;
				}
				fail(error);
				return;
			}
		}
	}
	const timer = setInterval(() => {
		if (destroyed) {
			return;
		}
		flush();
		if (readable) {
			readOnce();
		}
	}, TTY_POLL_MS);
	timer.unref?.();
	const stream = {
		on(event: "data" | "error" | "end", listener: TtyListener) {
			listeners[event].push(listener);
			return stream;
		},
		write(chunk: Buffer | Uint8Array) {
			if (destroyed) {
				return false;
			}
			pending.push({ buf: Buffer.from(chunk), offset: 0 });
			flush();
			return true;
		},
		end() {
			stream.destroy();
		},
		destroy() {
			if (destroyed) {
				return;
			}
			destroyed = true;
			clearInterval(timer);
			pending.length = 0;
			try {
				closeSync(fd);
			} catch {
				undefined;
			}
		},
	};
	return stream as TtyByteStream;
}

function isAgain(error: unknown): boolean {
	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
	return code === "EAGAIN" || code === "EWOULDBLOCK";
}

export function listUsbSerialPorts(devDir = "/dev"): string[] {
	try {
		return readdirSync(devDir)
			.filter((name) => name.startsWith("ttyACM") || name.startsWith("ttyUSB"))
			.map((name) => join(devDir, name))
			.sort();
	} catch {
		return [];
	}
}

export function usbSerialStamp(devDir = "/dev"): string {
	return listUsbSerialPorts(devDir)
		.map((port) => {
			try {
				const st = lstatSync(port);
				return `${port}:${st.ino}:${Math.trunc(st.mtimeMs)}`;
			} catch {
				return `${port}:missing`;
			}
		})
		.join("\n");
}

export function serialWatchDir(devDir = "/dev"): string {
	const byId = join(devDir, "serial", "by-id");
	return existsSync(byId) ? byId : devDir;
}

export function watchUsbSerialPorts(
	onChange: () => void,
	options?: { intervalMs?: number; devDir?: string },
): () => void {
	const devDir = options?.devDir ?? "/dev";
	const intervalMs = options?.intervalMs ?? 2_000;
	let last = usbSerialStamp(devDir);
	function check() {
		const next = usbSerialStamp(devDir);
		if (next === last) {
			return;
		}
		last = next;
		onChange();
	}
	const timer = setInterval(check, intervalMs);
	let watcher: ReturnType<typeof watch> | null = null;
	try {
		watcher = watch(serialWatchDir(devDir), { persistent: false }, check);
	} catch {
		watcher = null;
	}
	return () => {
		clearInterval(timer);
		watcher?.close();
	};
}

export function resolveArduinoProxyDir(): string {
	const installed = "/usr/local/lib/gpio-companion/arduino-proxy";
	const source = new URL("../../../native/arduino-proxy", import.meta.url)
		.pathname;
	if (existsSync(join(installed, "arduino-proxy.ino"))) {
		return installed;
	}
	return source;
}

export function createArduinoProxy(
	options: ArduinoProxyOptions = {},
): ArduinoProxyController {
	let status = emptyArduinoProxyStatus();
	let serial: ProxySerial | null = null;
	let held = false;
	let probing: Promise<ArduinoProxyStatus> | null = null;
	let again = false;
	let parser = createFirmataParser();
	let sketchStatus: (() => SketchStatus | null) | null = null;
	const listPorts =
		options.listPorts ??
		(async () =>
			spawnText(["arduino-cli", "board", "list", "--format", "json"]));
	const openSerial = options.openSerial ?? liveOpenSerial;

	function publish() {
		options.onChange?.(status);
	}

	function setBoard(board: ArduinoProxyBoard, port: string, fqbn?: string) {
		status = {
			connected: true,
			protocol: "firmata",
			port,
			baud: arduinoProxyBaud(board),
			fqbn: fqbn || board.fqbn,
			name: board.name,
			board: board.id,
			voltage: board.voltage,
			pins: arduinoProxyPins(board),
			buses: {
				i2c: board.i2c,
				spi: board.spi,
				uart: [...board.uart],
			},
		};
		publish();
	}

	function disconnect() {
		serial?.close();
		serial = null;
		status = emptyArduinoProxyStatus();
		publish();
	}

	function ingestEvent(event: {
		type: string;
		port?: number;
		value?: number;
		pin?: number;
	}) {
		if (
			event.type === "digital" &&
			event.port !== undefined &&
			event.value !== undefined
		) {
			const port = event.port;
			const bits = event.value;
			status = {
				...status,
				pins: status.pins.map((pin) => {
					if (Math.floor(pin.physical / 8) !== port) {
						return pin;
					}
					if (pin.dir !== "in") {
						return pin;
					}
					const bit = pin.physical % 8;
					const value = ((bits >> bit) & 1) as 0 | 1;
					return { ...pin, value };
				}),
			};
			publish();
		}
		if (
			event.type === "analog" &&
			event.pin !== undefined &&
			event.value !== undefined
		) {
			const analogChannel = event.pin;
			const adc = event.value;
			status = {
				...status,
				pins: status.pins.map((pin) =>
					pin.physical === analogPin(status, analogChannel)
						? { ...pin, adc }
						: pin,
				),
			};
			publish();
		}
	}

	async function listedPorts(): Promise<FlashPort[] | null> {
		try {
			const parsed = parseArduinoBoardList(await listPorts());
			if (parsed.length > 0 || options.listPorts) {
				return parsed;
			}
		} catch {
			if (options.listPorts) {
				return null;
			}
		}
		return listUsbSerialPorts().map((address) => ({ address }));
	}

	function requireSerial(): ProxySerial {
		if (!status.connected || !serial) {
			throw new ArduinoProxyError("arduino-proxy not connected");
		}
		return serial;
	}

	async function handshake(
		port: string,
		fqbn?: string,
	): Promise<ArduinoProxyStatus> {
		if (held) {
			return status;
		}
		parser = createFirmataParser();
		const usbBoard = arduinoProxyBoard(fqbn || "");
		serial?.close();
		const baud = usbBoard ? arduinoProxyBaud(usbBoard) : FIRMWARE_BAUD_AVR;
		let sawFirmware = false;
		let pinCount = 0;
		let analogMap: number[] | undefined;
		serial = openSerial(
			port,
			baud,
			(bytes) => {
				for (const event of parser.push(bytes)) {
					if (event.type === "firmware" || event.type === "version") {
						sawFirmware = true;
					}
					if (event.type === "capability") {
						pinCount = event.pins.length;
					}
					if (event.type === "analog-map") {
						analogMap = event.map;
					}
					if (event.type === "digital" || event.type === "analog") {
						ingestEvent(event);
					}
				}
			},
			() => {
				if (status.port === port) {
					disconnect();
				}
			},
		);
		try {
			if (serial.ready) {
				await serial.ready;
			}
		} catch {
			serial?.close();
			serial = null;
			throw new ArduinoProxyError("arduino-proxy not detected");
		}
		serial.write(encodeSystemReset());
		const probeMs = options.probeMs ?? PROBE_MS;
		const deadline = Date.now() + probeMs;
		const suspectUno =
			!options.openSerial && (!usbBoard || usbBoard.id === "uno");
		while (Date.now() < deadline) {
			serial.write(encodeQueryFirmware());
			serial.write(encodeCapabilityQuery());
			serial.write(encodeAnalogMappingQuery());
			if (sawFirmware && pinCount > 0) {
				break;
			}
			if (sawFirmware && !suspectUno) {
				break;
			}
			await Bun.sleep(
				Math.min(QUERY_EVERY_MS, Math.max(0, deadline - Date.now())),
			);
		}
		if (!sawFirmware && !options.openSerial) {
			disconnect();
			throw new ArduinoProxyError("arduino-proxy not detected");
		}
		const board =
			arduinoProxyBoardFromProbe({ pinCount, analogMap }) ??
			usbBoard ??
			(options.openSerial ? arduinoProxyBoard("uno") : undefined);
		if (!board) {
			disconnect();
			throw new ArduinoProxyError("arduino-proxy board unknown");
		}
		setBoard(board, port, board.fqbn);
		return status;
	}

	return {
		status() {
			return status;
		},
		snapshot(hardware) {
			return applySketchToProxySnapshot(
				arduinoProxySnapshot(hardware, status),
				sketchStatus?.() ?? null,
			);
		},
		apply(hardware, command) {
			const open = requireSerial();
			if (command.physical !== undefined) {
				const pin = status.pins.find(
					(item) => item.physical === command.physical,
				);
				if (!pin) {
					throw new ArduinoProxyError(`unknown pin ${command.physical}`);
				}
				if (pin.reserved) {
					throw new ArduinoProxyError(`pin ${command.physical} is reserved`);
				}
			}
			if ("op" in command && command.op === "tone") {
				open.write(encodeSetPinMode(command.physical, "pwm"));
			} else if ("op" in command && command.op === "notone") {
				open.write(encodeSetPinMode(command.physical, "output"));
				open.write(encodeDigitalPin(command.physical, 0));
			} else if (command.dir === "pwm") {
				open.write(encodeSetPinMode(command.physical, "pwm"));
				open.write(encodeAnalogWrite(command.physical, command.analog ?? 0));
			} else if (command.dir === "off") {
				const pin = status.pins.find(
					(item) => item.physical === command.physical,
				);
				if (pin && pin.adc !== undefined) {
					open.write(
						encodeReportAnalog(analogChannel(status, command.physical), false),
					);
				}
				open.write(encodeSetPinMode(command.physical, "ignore"));
			} else if (command.dir === "in") {
				const pin = status.pins.find(
					(item) => item.physical === command.physical,
				);
				if (pin && pin.adc !== undefined) {
					open.write(encodeSetPinMode(command.physical, "analog"));
					open.write(
						encodeReportAnalog(analogChannel(status, command.physical), true),
					);
				} else {
					open.write(encodeSetPinMode(command.physical, "input"));
				}
			} else {
				open.write(encodeSetPinMode(command.physical, "output"));
				open.write(
					encodeDigitalPin(command.physical, (command.value ?? 0) as 0 | 1),
				);
			}
			status = {
				...status,
				pins: patchPins(status.pins, command),
			};
			publish();
			return applySketchToProxySnapshot(
				arduinoProxySnapshot(hardware, status),
				sketchStatus?.() ?? null,
			);
		},
		bus(command) {
			const open = requireSerial();
			if (command.op === "i2c-scan" || command.op === "i2c-read") {
				open.write(
					encodeI2cRead(
						command.op === "i2c-read" ? command.address : 0x08,
						command.op === "i2c-read" ? (command.length ?? 1) : 1,
					),
				);
			}
			if (command.op === "i2c-write") {
				open.write(encodeI2cWrite(command.address, command.data));
			}
			if (command.op === "spi-xfer") {
				open.write(encodeSpiTransfer(command.data));
			}
			if (command.op === "uart-write") {
				const bytes = [...Buffer.from(command.data)];
				open.write(encodeSerialWrite(0, bytes));
			}
			return status;
		},
		hold(next) {
			held = next;
		},
		setSketchStatus(next) {
			sketchStatus = next;
		},
		release() {
			serial?.close();
			serial = null;
		},
		async attach(port, fqbn) {
			if (held) {
				return status;
			}
			return handshake(port, fqbn);
		},
		async probe() {
			if (held) {
				return status;
			}
			if (probing) {
				again = true;
				return probing;
			}
			const delays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
			probing = (async () => {
				let retries = 0;
				while (!held) {
					again = false;
					const ports = await listedPorts();
					if (ports === null || held) {
						return status;
					}
					if (status.connected && serial) {
						if (
							status.port &&
							ports.some((item) => item.address === status.port)
						) {
							return status;
						}
						disconnect();
					}
					for (const port of ports) {
						if (held || again) {
							break;
						}
						if (!port.address) {
							continue;
						}
						try {
							await handshake(port.address, port.fqbn);
							return status;
						} catch {}
					}
					if (status.connected || held) {
						return status;
					}
					if (again) {
						continue;
					}
					if (retries >= delays.length || ports.length === 0) {
						return status;
					}
					const delay = delays[retries] ?? 0;
					retries += 1;
					if (delay > 0) {
						await Bun.sleep(delay);
					}
				}
				return status;
			})().finally(() => {
				probing = null;
			});
			return probing;
		},
	};
}

export function memoryArduinoProxy(
	initial?: Partial<ArduinoProxyStatus>,
): ArduinoProxyController {
	const uno = arduinoProxyBoard("uno");
	if (!uno) {
		throw new Error("missing uno map");
	}
	let status: ArduinoProxyStatus = {
		...emptyArduinoProxyStatus(),
		...initial,
		pins: initial?.pins ?? arduinoProxyPins(uno),
		buses: initial?.buses ?? { i2c: true, spi: true, uart: [] },
	};
	if (initial?.connected) {
		status = {
			...status,
			connected: true,
			protocol: "firmata",
			fqbn: initial.fqbn ?? uno.fqbn,
			name: initial.name ?? uno.name,
			board: "uno",
			voltage: "5v",
			port: initial.port ?? "/dev/ttyACM0",
		};
	}
	let open = Boolean(status.connected);
	let held = false;
	let sketchStatus: (() => SketchStatus | null) | null = null;
	function requireOpen() {
		if (!status.connected || !open) {
			throw new ArduinoProxyError("arduino-proxy not connected");
		}
	}
	return {
		status() {
			return status;
		},
		snapshot(hardware) {
			return applySketchToProxySnapshot(
				arduinoProxySnapshot(hardware, status),
				sketchStatus?.() ?? null,
			);
		},
		apply(hardware, command) {
			requireOpen();
			status = { ...status, pins: patchPins(status.pins, command) };
			return applySketchToProxySnapshot(
				arduinoProxySnapshot(hardware, status),
				sketchStatus?.() ?? null,
			);
		},
		bus() {
			requireOpen();
			return status;
		},
		hold(next) {
			held = next;
		},
		setSketchStatus(next) {
			sketchStatus = next;
		},
		release() {
			open = false;
		},
		async attach(port, fqbn) {
			if (held) {
				return status;
			}
			if (fqbn && !isArduinoProxyFqbn(fqbn)) {
				throw new ArduinoProxyError(`unsupported fqbn ${fqbn}`);
			}
			const board = arduinoProxyBoard(fqbn || "uno") ?? uno;
			status = {
				connected: true,
				protocol: "firmata",
				port,
				baud: arduinoProxyBaud(board),
				fqbn: board.fqbn,
				name: board.name,
				board: board.id,
				voltage: board.voltage,
				pins: arduinoProxyPins(board),
				buses: { i2c: board.i2c, spi: board.spi, uart: [...board.uart] },
			};
			open = true;
			return status;
		},
		async probe() {
			return status;
		},
	};
}

function applySketchToProxySnapshot(
	snapshot: GpioSnapshot,
	sketch: SketchStatus | null,
): GpioSnapshot {
	if (!sketch) {
		return snapshot;
	}
	const byPhysical = new Map(
		sketch.pins.map((pin) => [pin.physical, pin] as const),
	);
	return {
		...snapshot,
		sketch: true,
		pins: snapshot.pins.map((pin) => {
			if (pin.type !== "gpio" || pin.reserved) {
				return pin;
			}
			const sketchPin = byPhysical.get(pin.physical);
			if (!sketchPin) {
				return pin;
			}
			const next: GpioPinState = { ...pin, sketch: true };
			delete next.dir;
			delete next.value;
			delete next.analog;
			delete next.hz;
			delete next.adc;
			delete next.pwm;
			if (typeof sketchPin.adc === "number") {
				next.dir = "in";
				next.adc = sketchPin.adc;
			} else if (sketchPin.mode === "in") {
				next.dir = "in";
				next.value = sketchPin.value ?? 0;
			} else if (typeof sketchPin.analog === "number") {
				next.dir = "pwm";
				next.analog = sketchPin.analog;
				next.pwm = analogToPwmPercent(sketchPin.analog);
				next.value = sketchPin.analog >= 128 ? 1 : 0;
			} else {
				next.dir = "out";
				next.value = sketchPin.value ?? 0;
			}
			return next;
		}),
	};
}

function patchPins(pins: GpioPinState[], command: GpioApply): GpioPinState[] {
	return pins.map((pin) => {
		if (pin.physical !== command.physical) {
			return pin;
		}
		if ("op" in command && command.op === "notone") {
			const next = { ...pin, dir: "in" as const };
			delete next.hz;
			delete next.analog;
			return next;
		}
		if ("op" in command && command.op === "tone") {
			return { ...pin, dir: "out", hz: command.hz };
		}
		if (command.dir === "pwm") {
			return {
				...pin,
				dir: "pwm",
				analog: command.analog ?? 0,
				value: (command.analog ?? 0) >= 128 ? 1 : 0,
			};
		}
		if (command.dir === "off") {
			return gpioPinOff(pin);
		}
		if (command.dir === "in") {
			const next = { ...pin, dir: "in" as const };
			delete next.analog;
			delete next.hz;
			return next;
		}
		return {
			...pin,
			dir: "out",
			value: command.value ?? 0,
		};
	});
}

function analogPins(status: ArduinoProxyStatus) {
	return status.pins.filter((pin) => pin.adc !== undefined);
}

function analogPin(status: ArduinoProxyStatus, analogChannel: number): number {
	return analogPins(status)[analogChannel]?.physical ?? analogChannel;
}

function analogChannel(status: ArduinoProxyStatus, physical: number): number {
	const index = analogPins(status).findIndex(
		(pin) => pin.physical === physical,
	);
	return index >= 0 ? index : physical;
}

function liveOpenSerial(
	port: string,
	baud: number,
	onData: (bytes: Uint8Array) => void,
	onClose: () => void,
): ProxySerial {
	let closed = false;
	let reader: TtyByteStream | null = null;
	let writer: TtyByteStream | null = null;
	const pending: Uint8Array[] = [];
	let resolveReady: () => void = () => undefined;
	let rejectReady: (error: Error) => void = () => undefined;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	void (async () => {
		const proc = Bun.spawn(
			[
				"stty",
				"-F",
				port,
				String(baud),
				"cs8",
				"-cstopb",
				"-parenb",
				"raw",
				"-echo",
				"-icrnl",
				"-hupcl",
				"clocal",
				"cread",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const opened = await Promise.race([
			proc.exited,
			Bun.sleep(SERIAL_OPEN_MS).then(() => -1),
		]);
		if (opened !== 0 || closed) {
			try {
				proc.kill();
			} catch {
				undefined;
			}
			rejectReady(new Error("serial open failed"));
			onClose();
			return;
		}
		try {
			reader = openTtyReadStream(port);
			writer = openTtyWriteStream(port);
			if (closed) {
				reader.destroy();
				writer.destroy();
				reader = null;
				writer = null;
				rejectReady(new Error("serial open failed"));
				return;
			}
			reader.on("error", () => {
				if (!closed) {
					onClose();
				}
			});
			writer.on("error", () => {
				if (!closed) {
					onClose();
				}
			});
		} catch (error) {
			reader?.destroy();
			writer?.destroy();
			reader = null;
			writer = null;
			rejectReady(
				error instanceof Error ? error : new Error("serial open failed"),
			);
			onClose();
			return;
		}
		for (const bytes of pending) {
			writer.write(Buffer.from(bytes));
		}
		pending.length = 0;
		resolveReady();
		reader.on("data", (buf) => {
			if (closed) {
				return;
			}
			onData(new Uint8Array(buf));
		});
		reader.on("end", () => {
			if (!closed) {
				onClose();
			}
		});
	})();
	return {
		write(bytes) {
			if (writer) {
				writer.write(Buffer.from(bytes));
				return;
			}
			pending.push(bytes);
		},
		close() {
			closed = true;
			pending.length = 0;
			const currentReader = reader;
			const currentWriter = writer;
			reader = null;
			writer = null;
			currentReader?.destroy();
			currentWriter?.destroy();
		},
		ready,
	};
}

export async function restoreUploadCarrier(port: string): Promise<void> {
	if (!port.startsWith("/dev/ttyACM") && !port.startsWith("/dev/ttyUSB")) {
		return;
	}
	const proc = Bun.spawn(["stty", "-F", port, "hupcl"], {
		stdout: "ignore",
		stderr: "ignore",
		env: { ...process.env },
	});
	await proc.exited.catch(() => undefined);
}

export function proxyUploadHooks(
	proxy: ArduinoProxyController,
	timing: { settleMs?: number; retryMs?: number } = {},
): {
	beforeUpload(job: { port?: string }): Promise<void>;
	afterUpload(
		job: { port?: string; fqbn?: string },
		result: { ok: boolean },
	): Promise<void>;
} {
	const settleMs = timing.settleMs ?? 400;
	const retryMs = timing.retryMs ?? 1_500;
	return {
		async beforeUpload(job) {
			proxy.hold(true);
			proxy.release();
			if (job.port) {
				await restoreUploadCarrier(job.port);
			}
		},
		async afterUpload(job, result) {
			proxy.hold(false);
			if (result.ok && job.port) {
				if (settleMs > 0) {
					await Bun.sleep(settleMs);
				}
				try {
					await proxy.attach(job.port, job.fqbn);
				} catch {
					if (retryMs > 0) {
						await Bun.sleep(retryMs);
					}
					await proxy.attach(job.port, job.fqbn).catch(() => undefined);
				}
				return;
			}
			await proxy.probe();
		},
	};
}

async function spawnText(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new ArduinoProxyError(stderr.trim() || `${cmd[0]} failed`);
	}
	return stdout;
}
