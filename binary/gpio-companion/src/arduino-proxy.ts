import {
	constants,
	createReadStream,
	createWriteStream,
	existsSync,
	lstatSync,
	openSync,
	type ReadStream,
	readdirSync,
	type WriteStream,
	watch,
} from "node:fs";
import { join } from "node:path";
import {
	type ArduinoProxyBoard,
	type ArduinoProxyStatus,
	ArduinoProxyError,
	arduinoProxyBaud,
	arduinoProxyBoard,
	arduinoProxyPins,
	arduinoProxySnapshot,
	createFirmataParser,
	emptyArduinoProxyStatus,
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
export const TTY_NOCTTY_FLAGS = constants.O_NOCTTY;

export function openTtyReadStream(port: string): ReadStream {
	const fd = openSync(port, constants.O_RDONLY | TTY_NOCTTY_FLAGS);
	return createReadStream(port, { fd });
}

export function openTtyWriteStream(port: string): WriteStream {
	const fd = openSync(port, constants.O_WRONLY | TTY_NOCTTY_FLAGS);
	return createWriteStream(port, { fd });
}

export function listUsbSerialPorts(devDir = "/dev"): string[] {
	try {
		return readdirSync(devDir)
			.filter(
				(name) => name.startsWith("ttyACM") || name.startsWith("ttyUSB"),
			)
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
	const source = new URL(
		"../../../native/arduino-proxy",
		import.meta.url,
	).pathname;
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
		if (event.type === "digital" && event.port !== undefined && event.value !== undefined) {
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
		if (event.type === "analog" && event.pin !== undefined && event.value !== undefined) {
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
		if (options.listPorts) {
			try {
				return parseArduinoBoardList(await listPorts());
			} catch {
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
		const board =
			arduinoProxyBoard(fqbn || "") || arduinoProxyBoard("arduino:avr:uno");
		if (!board) {
			throw new ArduinoProxyError("unsupported board");
		}
		serial?.close();
		const baud = arduinoProxyBaud(board);
		let sawFirmware = false;
		serial = openSerial(
			port,
			baud,
			(bytes) => {
				for (const event of parser.push(bytes)) {
					if (event.type === "firmware" || event.type === "version") {
						sawFirmware = true;
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
		while (!sawFirmware && Date.now() < deadline) {
			serial.write(encodeQueryFirmware());
			serial.write(encodeCapabilityQuery());
			await Bun.sleep(Math.min(QUERY_EVERY_MS, Math.max(0, deadline - Date.now())));
		}
		if (!sawFirmware && !options.openSerial) {
			disconnect();
			throw new ArduinoProxyError("arduino-proxy not detected");
		}
		setBoard(board, port, fqbn);
		return status;
	}

	return {
		status() {
			return status;
		},
		snapshot(hardware) {
			return arduinoProxySnapshot(hardware, status);
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
			return arduinoProxySnapshot(hardware, status);
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
			return arduinoProxySnapshot(hardware, status);
		},
		apply(hardware, command) {
			requireOpen();
			status = { ...status, pins: patchPins(status.pins, command) };
			return arduinoProxySnapshot(hardware, status);
		},
		bus() {
			requireOpen();
			return status;
		},
		hold(next) {
			held = next;
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
	let reader: ReadStream | null = null;
	let writer: WriteStream | null = null;
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
		reader.on("data", (buf: string | Buffer) => {
			if (closed) {
				return;
			}
			const bytes =
				typeof buf === "string" ? Buffer.from(buf) : new Uint8Array(buf);
			onData(bytes);
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
			reader?.destroy();
			writer?.end();
		},
		ready,
	};
}

async function spawnText(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
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
