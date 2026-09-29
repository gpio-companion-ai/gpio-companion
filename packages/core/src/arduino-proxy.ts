import { FLASH_PROXY_PATH } from "./flash.ts";
import type { GpioPinState, GpioSnapshot } from "./gpio.ts";

export type { GpioTarget } from "./gpio.ts";
export { FLASH_PROXY_PATH };

export const ARDUINO_PROXY_PATH = "/v1/arduino-proxy";
export const ARDUINO_PROXY_SKETCH_PREFIX = "arduino-proxy-";
export const ARDUINO_PROXY_LIB_DIR = "/usr/local/lib/gpio-companion/arduino-proxy";
export const FIRMWARE_BAUD_AVR = 57600;
export const FIRMWARE_BAUD_ESP32 = 115200;
export const ESP32_BOARD_MANAGER_URL =
	"https://espressif.github.io/arduino-esp32/package_esp32_index.json";

export type ArduinoProxyVoltage = "5v" | "3v3";

export type ArduinoProxyFamily = "avr" | "samd" | "esp32";

export type ArduinoProxyBoardId =
	| "uno"
	| "nano"
	| "mega"
	| "nano_33_iot"
	| "mkrwifi1010"
	| "mkrzero"
	| "mzero"
	| "esp32"
	| "esp32s3"
	| "esp32c3";

export type ArduinoProxyPinDef = {
	physical: number;
	name: string;
	pwm?: boolean;
	adc?: boolean;
	reserved?: boolean;
	analogOnly?: boolean;
};

export type ArduinoProxyBoard = {
	id: ArduinoProxyBoardId;
	fqbn: string;
	name: string;
	family: ArduinoProxyFamily;
	voltage: ArduinoProxyVoltage;
	uart: string[];
	i2c: boolean;
	spi: boolean;
	pins: ArduinoProxyPinDef[];
};

export type ArduinoProxyBuses = {
	i2c: boolean;
	spi: boolean;
	uart: string[];
};

export type ArduinoProxyStatus = {
	connected: boolean;
	protocol: "firmata";
	port?: string;
	baud?: number;
	fqbn?: string;
	name?: string;
	board?: ArduinoProxyBoardId;
	voltage?: ArduinoProxyVoltage;
	pins: GpioPinState[];
	buses: ArduinoProxyBuses;
};

export type FlashProxyPut = {
	fqbn?: string;
	port?: string;
};

export class ArduinoProxyError extends Error {
	readonly status: 400 | 409;

	constructor(message: string, status: 400 | 409 = 400) {
		super(message);
		this.name = "ArduinoProxyError";
		this.status = status;
	}
}

const PWM_UNO = new Set([3, 5, 6, 9, 10, 11]);
const PWM_MEGA = new Set([
	2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46,
]);
const PWM_SAMD = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

function digitalPins(
	count: number,
	pwm: Set<number>,
	reserved: number[] = [0, 1],
): ArduinoProxyPinDef[] {
	const pins: ArduinoProxyPinDef[] = [];
	for (let pin = 0; pin < count; pin++) {
		pins.push({
			physical: pin,
			name: `D${pin}`,
			pwm: pwm.has(pin),
			reserved: reserved.includes(pin),
		});
	}
	return pins;
}

function analogPins(start: number, count: number, analogOnly = false): ArduinoProxyPinDef[] {
	const pins: ArduinoProxyPinDef[] = [];
	for (let index = 0; index < count; index++) {
		pins.push({
			physical: start + index,
			name: `A${index}`,
			adc: true,
			analogOnly,
		});
	}
	return pins;
}

export const ARDUINO_PROXY_BOARDS: ArduinoProxyBoard[] = [
	{
		id: "uno",
		fqbn: "arduino:avr:uno",
		name: "Arduino Uno",
		family: "avr",
		voltage: "5v",
		uart: [],
		i2c: true,
		spi: true,
		pins: [...digitalPins(14, PWM_UNO), ...analogPins(14, 6)],
	},
	{
		id: "nano",
		fqbn: "arduino:avr:nano",
		name: "Arduino Nano",
		family: "avr",
		voltage: "5v",
		uart: [],
		i2c: true,
		spi: true,
		pins: [
			...digitalPins(14, PWM_UNO),
			...analogPins(14, 6),
			...analogPins(20, 2, true),
		],
	},
	{
		id: "mega",
		fqbn: "arduino:avr:mega",
		name: "Arduino Mega 2560",
		family: "avr",
		voltage: "5v",
		uart: ["Serial1", "Serial2", "Serial3"],
		i2c: true,
		spi: true,
		pins: [...digitalPins(54, PWM_MEGA), ...analogPins(54, 16)],
	},
	{
		id: "nano_33_iot",
		fqbn: "arduino:samd:nano_33_iot",
		name: "Arduino Nano 33 IoT",
		family: "samd",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: [...digitalPins(14, PWM_SAMD, []), ...analogPins(14, 8)],
	},
	{
		id: "mkrwifi1010",
		fqbn: "arduino:samd:mkrwifi1010",
		name: "Arduino MKR WiFi 1010",
		family: "samd",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: [...digitalPins(15, PWM_SAMD, []), ...analogPins(15, 7)],
	},
	{
		id: "mkrzero",
		fqbn: "arduino:samd:mkrzero",
		name: "Arduino MKR Zero",
		family: "samd",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: [...digitalPins(15, PWM_SAMD, []), ...analogPins(15, 7)],
	},
	{
		id: "mzero",
		fqbn: "arduino:samd:mzero",
		name: "Arduino Zero",
		family: "samd",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: [...digitalPins(14, PWM_SAMD, []), ...analogPins(14, 6)],
	},
	{
		id: "esp32",
		fqbn: "esp32:esp32:esp32",
		name: "ESP32 Dev Module",
		family: "esp32",
		voltage: "3v3",
		uart: ["Serial1", "Serial2"],
		i2c: true,
		spi: true,
		pins: esp32Pins(),
	},
	{
		id: "esp32s3",
		fqbn: "esp32:esp32:esp32s3",
		name: "ESP32-S3",
		family: "esp32",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: esp32Pins([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]),
	},
	{
		id: "esp32c3",
		fqbn: "esp32:esp32:esp32c3",
		name: "ESP32-C3",
		family: "esp32",
		voltage: "3v3",
		uart: ["Serial1"],
		i2c: true,
		spi: true,
		pins: esp32Pins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21]),
	},
];

function esp32Pins(list?: number[]): ArduinoProxyPinDef[] {
	const numbers =
		list ??
		[2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
	const adc = new Set([32, 33, 34, 35, 36, 39, 0, 1, 2, 3, 4, 5]);
	const inputOnly = new Set([34, 35, 36, 39]);
	return numbers.map((pin) => ({
		physical: pin,
		name: `GPIO${pin}`,
		pwm: !inputOnly.has(pin),
		adc: adc.has(pin),
		analogOnly: inputOnly.has(pin),
	}));
}

export const ARDUINO_PROXY_FQBNS = ARDUINO_PROXY_BOARDS.map((board) => board.fqbn);

export function isArduinoProxyPath(path: string): boolean {
	return path === ARDUINO_PROXY_PATH || path === FLASH_PROXY_PATH;
}

export function arduinoCoreForFqbn(fqbn: string): string {
	const trimmed = fqbn.trim();
	const parts = trimmed.split(":");
	if (!parts[0] || !parts[1]) {
		return "";
	}
	return `${parts[0]}:${parts[1]}`;
}

export function parseArduinoCoreList(input: unknown): string[] {
	let parsed = input;
	if (typeof input === "string") {
		try {
			parsed = JSON.parse(input) as unknown;
		} catch {
			return [];
		}
	}
	const rows = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object"
			? ((parsed as { platforms?: unknown }).platforms ?? [])
			: [];
	if (!Array.isArray(rows)) {
		return [];
	}
	const cores: string[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") {
			continue;
		}
		const id = (row as { id?: unknown }).id;
		if (typeof id === "string" && id.includes(":")) {
			cores.push(id);
		}
	}
	return cores;
}

export function isArduinoProxyFqbn(fqbn: string): boolean {
	const normalized = normalizeFqbn(fqbn);
	return ARDUINO_PROXY_BOARDS.some((board) => board.fqbn === normalized);
}

export function normalizeFqbn(fqbn: string): string {
	const trimmed = fqbn.trim();
	if (trimmed.startsWith("arduino:avr:mega")) {
		return "arduino:avr:mega";
	}
	const board = ARDUINO_PROXY_BOARDS.find(
		(item) => item.fqbn === trimmed || trimmed.startsWith(`${item.fqbn}:`),
	);
	return board?.fqbn ?? trimmed;
}

export function arduinoProxyBoardFromProbe(input: {
	pinCount?: number;
	analogMap?: number[];
}): ArduinoProxyBoard | undefined {
	const map = input.analogMap ?? [];
	const a0 = map.findIndex((value) => value === 0);
	const count =
		input.pinCount && input.pinCount > 0 ? input.pinCount : map.length;
	if (a0 >= 54 || count >= 54) {
		return arduinoProxyBoard("mega");
	}
	return undefined;
}

export function arduinoProxyBoard(fqbnOrId: string): ArduinoProxyBoard | undefined {
	const trimmed = fqbnOrId.trim();
	return ARDUINO_PROXY_BOARDS.find(
		(board) =>
			board.id === trimmed ||
			board.fqbn === normalizeFqbn(trimmed) ||
			trimmed.startsWith(`${board.fqbn}:`),
	);
}

export function arduinoProxyBaud(board: ArduinoProxyBoard): number {
	return board.family === "esp32" ? FIRMWARE_BAUD_ESP32 : FIRMWARE_BAUD_AVR;
}

export function isArduinoProxySketchName(name: string): boolean {
	return name.startsWith(ARDUINO_PROXY_SKETCH_PREFIX) && name.length > ARDUINO_PROXY_SKETCH_PREFIX.length;
}

export function arduinoProxySketchName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/^arduino-proxy-/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) {
		throw new ArduinoProxyError("sketch name is required");
	}
	return `${ARDUINO_PROXY_SKETCH_PREFIX}${slug}`;
}

export function emptyArduinoProxyStatus(): ArduinoProxyStatus {
	return {
		connected: false,
		protocol: "firmata",
		pins: [],
		buses: { i2c: false, spi: false, uart: [] },
	};
}

export function arduinoProxyPins(board: ArduinoProxyBoard): GpioPinState[] {
	return board.pins.map((pin) => ({
		physical: pin.physical,
		name: pin.name,
		type: "gpio",
		reserved: pin.reserved,
		adc: pin.adc ? 0 : undefined,
		alt: [
			...(pin.pwm ? ["PWM"] : []),
			...(pin.adc ? ["ADC"] : []),
			...(pin.analogOnly ? ["analog-only"] : []),
		],
	}));
}

export function arduinoProxySnapshot(
	hardware: GpioSnapshot["hardware"],
	status: ArduinoProxyStatus,
): GpioSnapshot {
	return {
		hardware,
		target: "arduino-proxy",
		proxy: {
			connected: status.connected,
			protocol: status.protocol,
			port: status.port,
			fqbn: status.fqbn,
			name: status.name,
			voltage: status.voltage,
			buses: status.buses,
		},
		pins: status.pins,
	};
}

export function parseFlashProxyPut(input: unknown): FlashProxyPut {
	if (input === null || typeof input !== "object") {
		throw new ArduinoProxyError("flash proxy must be an object");
	}
	const record = input as Record<string, unknown>;
	const put: FlashProxyPut = {};
	if (record.fqbn !== undefined && record.fqbn !== "") {
		const fqbn = requiredToken(record.fqbn, "fqbn");
		if (!isArduinoProxyFqbn(fqbn)) {
			throw new ArduinoProxyError(`unsupported fqbn ${fqbn}`);
		}
		put.fqbn = normalizeFqbn(fqbn);
	}
	if (record.port !== undefined && record.port !== "") {
		put.port = requiredToken(record.port, "port");
	}
	return put;
}

export function parseArduinoProxyStatus(input: unknown): ArduinoProxyStatus {
	if (input === null || typeof input !== "object") {
		return emptyArduinoProxyStatus();
	}
	const record = input as Record<string, unknown>;
	const connected = record.connected === true;
	const pins = Array.isArray(record.pins)
		? (record.pins as GpioPinState[])
		: [];
	const busesRaw =
		record.buses && typeof record.buses === "object"
			? (record.buses as Record<string, unknown>)
			: {};
	return {
		connected,
		protocol: "firmata",
		port: stringField(record.port) || undefined,
		baud:
			typeof record.baud === "number" && Number.isFinite(record.baud)
				? record.baud
				: undefined,
		fqbn: stringField(record.fqbn) || undefined,
		name: stringField(record.name) || undefined,
		board: arduinoProxyBoard(stringField(record.fqbn) || stringField(record.board) || "")
			?.id,
		voltage:
			record.voltage === "5v" || record.voltage === "3v3"
				? record.voltage
				: undefined,
		pins,
		buses: {
			i2c: busesRaw.i2c === true,
			spi: busesRaw.spi === true,
			uart: Array.isArray(busesRaw.uart)
				? busesRaw.uart.filter((item): item is string => typeof item === "string")
				: [],
		},
	};
}

function requiredToken(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ArduinoProxyError(`${field} is required`);
	}
	const trimmed = value.trim();
	if (!/^[A-Za-z0-9/._:=-]+$/.test(trimmed)) {
		throw new ArduinoProxyError(`${field} is invalid`);
	}
	return trimmed;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
