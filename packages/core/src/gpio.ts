import type { HardwareId } from "./config.ts";
import { debugAuthQuery } from "./debug.ts";
import type { DeviceAuthHeaders } from "./device-auth.ts";
import { skuPinout } from "./gpio-sku.ts";

export const GPIO_PATH = "/v1/gpio";
export const GPIO_STREAM_MS = 200;
export const GPIO_MAX_SOCKETS = 8;
export const GPIO_MAX_PWM = 8;
export const GPIO_PWM_HZ = 490;
export const GPIO_ANALOG_MAX = 255;

export function gpioWsUrl(deviceUrl: string): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	if (origin.startsWith("https://")) {
		return `wss://${origin.slice("https://".length)}${GPIO_PATH}`;
	}
	if (origin.startsWith("http://")) {
		return `ws://${origin.slice("http://".length)}${GPIO_PATH}`;
	}
	return `wss://${origin}${GPIO_PATH}`;
}

export function gpioWsConnectUrl(
	deviceUrl: string,
	headers: DeviceAuthHeaders,
): string {
	return `${gpioWsUrl(deviceUrl)}?${debugAuthQuery(headers)}`;
}

export const GPIO_RESERVED_PHYSICAL: Record<HardwareId, number[]> = {
	raspberrypi: [27, 28],
	orangepi: [],
};

export type GpioDir = "in" | "out" | "pwm" | "off";

export type GpioTarget = "header" | "arduino-proxy";

export type GpioProxyInfo = {
	connected?: boolean;
	protocol?: string;
	port?: string;
	fqbn?: string;
	name?: string;
	voltage?: string;
	buses?: { i2c?: boolean; spi?: boolean; uart?: string[] };
};

export type HeaderPinType = "power" | "gnd" | "gpio";

export type HeaderPinDef = {
	physical: number;
	name: string;
	type: HeaderPinType;
	bcm?: number | null;
	alt?: string[];
	resolve?: "live";
};

export type GpioPinState = {
	physical: number;
	name: string;
	type: HeaderPinType;
	chip?: string;
	line?: number;
	dir?: GpioDir;
	value?: 0 | 1;
	pwm?: number;
	analog?: number;
	hz?: number;
	alt?: string[];
	adc?: number;
	reserved?: boolean;
	unresolved?: boolean;
	sketch?: boolean;
};

export type GpioSnapshot = {
	hardware: HardwareId;
	pins: GpioPinState[];
	target?: GpioTarget;
	proxy?: GpioProxyInfo;
	sketch?: boolean;
};

export type GpioPatch = {
	hardware: HardwareId;
	patch: GpioPinState[];
	target?: GpioTarget;
	proxy?: GpioProxyInfo;
	sketch?: boolean;
};

export type GpioStreamFrame = GpioSnapshot | GpioPatch;

export type GpioPut = {
	physical: number;
	dir: GpioDir;
	value?: 0 | 1;
	analog?: number;
	target?: GpioTarget;
};

export type GpioWsRefresh = {
	op: "refresh";
	target?: GpioTarget;
};

export type GpioTone = {
	physical: number;
	op: "tone";
	hz: number;
	target?: GpioTarget;
};

export type GpioNoTone = {
	physical: number;
	op: "notone";
	target?: GpioTarget;
};

export type GpioI2cScan = {
	op: "i2c-scan";
	target?: GpioTarget;
};

export type GpioI2cRead = {
	op: "i2c-read";
	address: number;
	length?: number;
	target?: GpioTarget;
};

export type GpioI2cWrite = {
	op: "i2c-write";
	address: number;
	data: number[];
	target?: GpioTarget;
};

export type GpioSpiXfer = {
	op: "spi-xfer";
	data: number[];
	target?: GpioTarget;
};

export type GpioUartWrite = {
	op: "uart-write";
	port?: string;
	data: string;
	target?: GpioTarget;
};

export type GpioBusCommand =
	| GpioI2cScan
	| GpioI2cRead
	| GpioI2cWrite
	| GpioSpiXfer
	| GpioUartWrite;

export type GpioWsCommand =
	| GpioPut
	| GpioWsRefresh
	| GpioTone
	| GpioNoTone
	| GpioBusCommand;

export type GpioApply = Exclude<GpioWsCommand, GpioWsRefresh | GpioBusCommand>;

export class GpioError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "GpioError";
	}
}

const RASPBERRYPI_PINS: HeaderPinDef[] = [
	{ physical: 1, name: "3V3", type: "power" },
	{ physical: 2, name: "5V", type: "power" },
	{ physical: 3, name: "GPIO2", type: "gpio", bcm: 2, alt: ["I2C1_SDA"] },
	{ physical: 4, name: "5V", type: "power" },
	{ physical: 5, name: "GPIO3", type: "gpio", bcm: 3, alt: ["I2C1_SCL"] },
	{ physical: 6, name: "GND", type: "gnd" },
	{ physical: 7, name: "GPIO4", type: "gpio", bcm: 4, alt: ["GPCLK0"] },
	{ physical: 8, name: "GPIO14", type: "gpio", bcm: 14, alt: ["UART0_TXD"] },
	{ physical: 9, name: "GND", type: "gnd" },
	{ physical: 10, name: "GPIO15", type: "gpio", bcm: 15, alt: ["UART0_RXD"] },
	{ physical: 11, name: "GPIO17", type: "gpio", bcm: 17 },
	{
		physical: 12,
		name: "GPIO18",
		type: "gpio",
		bcm: 18,
		alt: ["PCM_CLK", "PWM0"],
	},
	{ physical: 13, name: "GPIO27", type: "gpio", bcm: 27 },
	{ physical: 14, name: "GND", type: "gnd" },
	{ physical: 15, name: "GPIO22", type: "gpio", bcm: 22 },
	{ physical: 16, name: "GPIO23", type: "gpio", bcm: 23 },
	{ physical: 17, name: "3V3", type: "power" },
	{ physical: 18, name: "GPIO24", type: "gpio", bcm: 24 },
	{ physical: 19, name: "GPIO10", type: "gpio", bcm: 10, alt: ["SPI0_MOSI"] },
	{ physical: 20, name: "GND", type: "gnd" },
	{ physical: 21, name: "GPIO9", type: "gpio", bcm: 9, alt: ["SPI0_MISO"] },
	{ physical: 22, name: "GPIO25", type: "gpio", bcm: 25 },
	{ physical: 23, name: "GPIO11", type: "gpio", bcm: 11, alt: ["SPI0_SCLK"] },
	{ physical: 24, name: "GPIO8", type: "gpio", bcm: 8, alt: ["SPI0_CE0"] },
	{ physical: 25, name: "GND", type: "gnd" },
	{ physical: 26, name: "GPIO7", type: "gpio", bcm: 7, alt: ["SPI0_CE1"] },
	{
		physical: 27,
		name: "GPIO0",
		type: "gpio",
		bcm: 0,
		alt: ["ID_SD", "EEPROM_SDA"],
	},
	{
		physical: 28,
		name: "GPIO1",
		type: "gpio",
		bcm: 1,
		alt: ["ID_SC", "EEPROM_SCL"],
	},
	{ physical: 29, name: "GPIO5", type: "gpio", bcm: 5 },
	{ physical: 30, name: "GND", type: "gnd" },
	{ physical: 31, name: "GPIO6", type: "gpio", bcm: 6 },
	{ physical: 32, name: "GPIO12", type: "gpio", bcm: 12, alt: ["PWM0"] },
	{ physical: 33, name: "GPIO13", type: "gpio", bcm: 13, alt: ["PWM1"] },
	{ physical: 34, name: "GND", type: "gnd" },
	{
		physical: 35,
		name: "GPIO19",
		type: "gpio",
		bcm: 19,
		alt: ["PCM_FS", "SPI1_MISO"],
	},
	{ physical: 36, name: "GPIO16", type: "gpio", bcm: 16, alt: ["SPI1_CE2"] },
	{ physical: 37, name: "GPIO26", type: "gpio", bcm: 26 },
	{
		physical: 38,
		name: "GPIO20",
		type: "gpio",
		bcm: 20,
		alt: ["PCM_DIN", "SPI1_MOSI"],
	},
	{ physical: 39, name: "GND", type: "gnd" },
	{
		physical: 40,
		name: "GPIO21",
		type: "gpio",
		bcm: 21,
		alt: ["PCM_DOUT", "SPI1_SCLK"],
	},
];

const ORANGEPI_PINS: HeaderPinDef[] = [
	{ physical: 1, name: "3V3", type: "power" },
	{ physical: 2, name: "5V", type: "power" },
	{ physical: 3, name: "SDA", type: "gpio", resolve: "live" },
	{ physical: 4, name: "5V", type: "power" },
	{ physical: 5, name: "SCL", type: "gpio", resolve: "live" },
	{ physical: 6, name: "GND", type: "gnd" },
	{ physical: 7, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 8, name: "TXD", type: "gpio", resolve: "live" },
	{ physical: 9, name: "GND", type: "gnd" },
	{ physical: 10, name: "RXD", type: "gpio", resolve: "live" },
	{ physical: 11, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 12, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 13, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 14, name: "GND", type: "gnd" },
	{ physical: 15, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 16, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 17, name: "3V3", type: "power" },
	{ physical: 18, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 19, name: "MOSI", type: "gpio", resolve: "live" },
	{ physical: 20, name: "GND", type: "gnd" },
	{ physical: 21, name: "MISO", type: "gpio", resolve: "live" },
	{ physical: 22, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 23, name: "SCLK", type: "gpio", resolve: "live" },
	{ physical: 24, name: "CE0", type: "gpio", resolve: "live" },
	{ physical: 25, name: "GND", type: "gnd" },
	{ physical: 26, name: "CE1", type: "gpio", resolve: "live" },
	{ physical: 27, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 28, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 29, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 30, name: "GND", type: "gnd" },
	{ physical: 31, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 32, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 33, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 34, name: "GND", type: "gnd" },
	{ physical: 35, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 36, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 37, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 38, name: "GPIO", type: "gpio", resolve: "live" },
	{ physical: 39, name: "GND", type: "gnd" },
	{ physical: 40, name: "GPIO", type: "gpio", resolve: "live" },
];

const HEADER_PINS: Record<HardwareId, HeaderPinDef[]> = {
	raspberrypi: RASPBERRYPI_PINS,
	orangepi: ORANGEPI_PINS,
};

export function headerPins(hardware: HardwareId): HeaderPinDef[] {
	return HEADER_PINS[hardware];
}

export function headerPinsForBoard(
	hardware: HardwareId,
	model?: string,
): HeaderPinDef[] {
	const pins = headerPins(hardware);
	const sku = skuPinout(model);
	if (!sku) {
		return pins;
	}
	return pins
		.filter((pin) => pin.physical <= sku.pinCount)
		.map((pin) => {
			const line = sku.lines.find(
				(skuLine) => skuLine.physical === pin.physical,
			);
			if (!line) {
				return pin;
			}
			return {
				...pin,
				name: line.soc ?? line.name ?? pin.name,
				alt: line.alt ?? pin.alt,
			};
		});
}

export function headerPin(
	hardware: HardwareId,
	physical: number,
): HeaderPinDef | undefined {
	return HEADER_PINS[hardware].find((pin) => pin.physical === physical);
}

export function headerPinPairs(): Array<{ odd: number; even: number }> {
	const pairs: Array<{ odd: number; even: number }> = [];
	for (let physical = 1; physical <= 40; physical += 2) {
		pairs.push({ odd: physical, even: physical + 1 });
	}
	return pairs;
}

export const HEADER_PIN_PAIRS = headerPinPairs();

export function pinByPhysical(
	pins: GpioPinState[],
	physical: number,
): GpioPinState | undefined {
	return pins.find((pin) => pin.physical === physical);
}

export function canDriveGpio(pin: GpioPinState): boolean {
	return pin.type === "gpio" && !pin.reserved && !pin.unresolved;
}

export type GpioPinTone =
	| "power"
	| "gnd"
	| "reserved"
	| "unresolved"
	| "pwm"
	| "tone"
	| "high"
	| "low"
	| "idle";

export function gpioPinTone(pin: GpioPinState): GpioPinTone {
	if (pin.type === "power") {
		return "power";
	}
	if (pin.type === "gnd") {
		return "gnd";
	}
	if (pin.reserved) {
		return "reserved";
	}
	if (pin.unresolved) {
		return "unresolved";
	}
	if (pin.dir === "off") {
		return "idle";
	}
	if (typeof pin.hz === "number") {
		return "tone";
	}
	if (typeof pin.analog === "number" || typeof pin.pwm === "number") {
		return "pwm";
	}
	if (pin.value === 1) {
		return "high";
	}
	if (pin.value === 0) {
		return "low";
	}
	return "idle";
}

export function gpioPinStatusLabel(pin: GpioPinState): string {
	if (pin.reserved) {
		return "Reserved";
	}
	if (pin.unresolved) {
		return "Unresolved";
	}
	if (pin.dir === "off") {
		return "off";
	}
	if (typeof pin.hz === "number") {
		return `tone ${Math.round(pin.hz)} Hz`;
	}
	if (typeof pin.analog === "number") {
		return `PWM ${Math.round(pin.analog)}/255`;
	}
	if (typeof pin.pwm === "number") {
		return `PWM ${Math.round(pin.pwm)}%`;
	}
	if (pin.dir === "in" && typeof pin.adc === "number") {
		return `adc ${pin.adc}`;
	}
	const level = pin.value === 1 ? "high" : pin.value === 0 ? "low" : undefined;
	if (pin.dir === "in" || pin.dir === "out") {
		return level ? `${pin.dir} · ${level}` : pin.dir;
	}
	if (level) {
		return level;
	}
	return "—";
}

export function gpioPinStatusKey(pin: GpioPinState): string {
	return [
		pin.physical,
		pin.dir ?? "",
		pin.value ?? "",
		pin.analog ?? "",
		pin.hz ?? "",
		pin.pwm ?? "",
		pin.adc ?? "",
		pin.unresolved ? 1 : 0,
		pin.reserved ? 1 : 0,
		pin.sketch ? 1 : 0,
	].join(":");
}

export function gpioSnapshotStatusKey(snapshot: GpioSnapshot): string {
	return snapshot.pins.map(gpioPinStatusKey).join("|");
}

export function gpioLiveValues(
	snapshot: GpioSnapshot | null,
): Record<number, 0 | 1> {
	const pins: Record<number, 0 | 1> = {};
	for (const pin of snapshot?.pins ?? []) {
		if (pin.type === "gpio" && (pin.value === 0 || pin.value === 1)) {
			pins[pin.physical] = pin.value;
		}
	}
	return pins;
}

export function asGpioPatch(payload: unknown): GpioPatch | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as GpioPatch;
	if (record.hardware !== "raspberrypi" && record.hardware !== "orangepi") {
		return null;
	}
	if (!Array.isArray(record.patch)) {
		return null;
	}
	return record;
}

export function applyGpioMessage(
	prev: GpioSnapshot | null,
	payload: unknown,
): GpioSnapshot | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as GpioSnapshot & GpioPatch;
	if (record.hardware !== "raspberrypi" && record.hardware !== "orangepi") {
		return null;
	}
	if (Array.isArray(record.pins)) {
		return {
			hardware: record.hardware,
			pins: record.pins,
			target: record.target,
			proxy: record.proxy,
			sketch: record.sketch,
		};
	}
	if (!Array.isArray(record.patch)) {
		return null;
	}
	if (!prev || prev.hardware !== record.hardware) {
		return {
			hardware: record.hardware,
			pins: record.patch,
			target: record.target,
			proxy: record.proxy,
			sketch: record.sketch,
		};
	}
	const byPhysical = new Map(
		prev.pins.map((pin) => [pin.physical, pin] as const),
	);
	for (const pin of record.patch) {
		byPhysical.set(pin.physical, pin);
	}
	return {
		hardware: record.hardware,
		pins: [...byPhysical.values()].sort((a, b) => a.physical - b.physical),
		target: record.target ?? prev.target,
		proxy: record.proxy ?? prev.proxy,
		sketch: record.sketch ?? prev.sketch,
	};
}

export function gpioPatchFrame(
	prev: GpioSnapshot | null,
	next: GpioSnapshot,
): GpioStreamFrame | null {
	if (!prev || prev.hardware !== next.hardware) {
		return next;
	}
	if (gpioSnapshotStatusKey(prev) === gpioSnapshotStatusKey(next)) {
		return null;
	}
	const previous = new Map(
		prev.pins.map((pin) => [pin.physical, gpioPinStatusKey(pin)] as const),
	);
	const patch = next.pins.filter(
		(pin) => previous.get(pin.physical) !== gpioPinStatusKey(pin),
	);
	if (patch.length === 0 || patch.length === next.pins.length) {
		return next;
	}
	return {
		hardware: next.hardware,
		patch,
		target: next.target,
		proxy: next.proxy,
		sketch: next.sketch,
	};
}

export function applyGpioApply(
	snapshot: GpioSnapshot,
	command: GpioApply,
): GpioSnapshot {
	return {
		...snapshot,
		pins: snapshot.pins.map((pin) => {
			if (pin.physical !== command.physical) {
				return pin;
			}
			if (isGpioNoTone(command)) {
				const next = { ...pin, dir: "in" as const };
				delete next.hz;
				delete next.analog;
				delete next.pwm;
				return next;
			}
			if (isGpioTone(command)) {
				const next = { ...pin, dir: "out" as const, hz: command.hz };
				delete next.analog;
				delete next.pwm;
				return next;
			}
			if (command.dir === "pwm") {
				const analog = command.analog ?? 0;
				const next = {
					...pin,
					dir: "pwm" as const,
					analog,
					pwm: analogToPwmPercent(analog),
					value: analog >= 128 ? (1 as const) : (0 as const),
				};
				delete next.hz;
				return next;
			}
			if (command.dir === "off") {
				return gpioPinOff(pin);
			}
			if (command.dir === "in") {
				const next = { ...pin, dir: "in" as const };
				delete next.analog;
				delete next.pwm;
				delete next.hz;
				return next;
			}
			const next = {
				...pin,
				dir: "out" as const,
				value: command.value ?? 0,
			};
			delete next.analog;
			delete next.pwm;
			delete next.hz;
			return next;
		}),
	};
}

export function parseGpioTarget(value: unknown): GpioTarget | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	if (value === "header" || value === "arduino-proxy") {
		return value;
	}
	throw new GpioError("target must be header or arduino-proxy");
}

export function parsePhysicalPin(
	value: unknown,
	options?: { min?: number; max?: number },
): number {
	const min = options?.min ?? 1;
	const max = options?.max ?? 40;
	const physical =
		typeof value === "number"
			? value
			: Number.parseInt(String(value ?? ""), 10);
	if (!Number.isInteger(physical) || physical < min || physical > max) {
		throw new GpioError(`physical pin must be ${min}-${max}`);
	}
	return physical;
}

export function assertGpioDrive(
	hardware: HardwareId,
	physical: number,
): HeaderPinDef {
	const pin = headerPin(hardware, physical);
	if (!pin) {
		throw new GpioError(`unknown physical pin ${physical}`);
	}
	if (pin.type !== "gpio") {
		throw new GpioError(`pin ${physical} is ${pin.type}, not gpio`);
	}
	if (GPIO_RESERVED_PHYSICAL[hardware].includes(physical)) {
		throw new GpioError(`pin ${physical} is reserved`);
	}
	return pin;
}

export function parseGpioPut(input: unknown): GpioPut {
	if (input === null || typeof input !== "object") {
		throw new GpioError("gpio must be an object");
	}
	const record = input as Record<string, unknown>;
	const target = parseGpioTarget(record.target);
	const physical = parsePhysicalPin(
		record.physical,
		target === "arduino-proxy" ? { min: 0, max: 127 } : undefined,
	);
	if (record.dir === "pwm" || record.analog !== undefined) {
		const put: GpioPut = {
			physical,
			dir: "pwm",
			analog: parseAnalog(record.analog ?? record.value),
		};
		if (target) {
			put.target = target;
		}
		return put;
	}
	const dir = parseDir(record.dir, record.value);
	const put: GpioPut = { physical, dir };
	if (target) {
		put.target = target;
	}
	if (record.value !== undefined) {
		put.value = parseValue(record.value);
	} else if (dir === "out") {
		throw new GpioError("value is required for output");
	}
	return put;
}

export function parseGpioWsCommand(input: unknown): GpioWsCommand {
	if (input === null || typeof input !== "object") {
		throw new GpioError("gpio must be an object");
	}
	const record = input as Record<string, unknown>;
	const target = parseGpioTarget(record.target);
	const pinOptions =
		target === "arduino-proxy" ? { min: 0, max: 127 } : undefined;
	if (record.op === "refresh" || record.refresh === true) {
		return target ? { op: "refresh", target } : { op: "refresh" };
	}
	if (record.op === "i2c-scan") {
		return target ? { op: "i2c-scan", target } : { op: "i2c-scan" };
	}
	if (record.op === "i2c-read") {
		const command: GpioI2cRead = {
			op: "i2c-read",
			address: parseByte(record.address, "address"),
		};
		if (record.length !== undefined) {
			command.length = parseByte(record.length, "length");
		}
		if (target) {
			command.target = target;
		}
		return command;
	}
	if (record.op === "i2c-write") {
		const command: GpioI2cWrite = {
			op: "i2c-write",
			address: parseByte(record.address, "address"),
			data: parseByteList(record.data),
		};
		if (target) {
			command.target = target;
		}
		return command;
	}
	if (record.op === "spi-xfer") {
		const command: GpioSpiXfer = {
			op: "spi-xfer",
			data: parseByteList(record.data),
		};
		if (target) {
			command.target = target;
		}
		return command;
	}
	if (record.op === "uart-write") {
		const command: GpioUartWrite = {
			op: "uart-write",
			data: parseUartData(record.data),
		};
		if (typeof record.port === "string" && record.port.trim()) {
			command.port = record.port.trim();
		}
		if (target) {
			command.target = target;
		}
		return command;
	}
	if (record.op === "tone") {
		const command: GpioTone = {
			physical: parsePhysicalPin(record.physical, pinOptions),
			op: "tone",
			hz: parseToneHz(record.hz ?? record.frequency),
		};
		if (target) {
			command.target = target;
		}
		return command;
	}
	if (record.op === "notone") {
		const command: GpioNoTone = {
			physical: parsePhysicalPin(record.physical, pinOptions),
			op: "notone",
		};
		if (target) {
			command.target = target;
		}
		return command;
	}
	return parseGpioPut(input);
}

export function isGpioWsRefresh(
	command: GpioWsCommand,
): command is GpioWsRefresh {
	return "op" in command && command.op === "refresh";
}

export function isGpioTone(command: GpioWsCommand): command is GpioTone {
	return "op" in command && command.op === "tone";
}

export function isGpioNoTone(command: GpioWsCommand): command is GpioNoTone {
	return "op" in command && command.op === "notone";
}

export function isGpioBusCommand(
	command: GpioWsCommand,
): command is GpioBusCommand {
	return (
		"op" in command &&
		(command.op === "i2c-scan" ||
			command.op === "i2c-read" ||
			command.op === "i2c-write" ||
			command.op === "spi-xfer" ||
			command.op === "uart-write")
	);
}

export function analogToPwmPercent(analog: number): number {
	return Math.round((analog / GPIO_ANALOG_MAX) * 1000) / 10;
}

export function asGpioWsError(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const record = payload as {
		error?: unknown;
		hardware?: unknown;
		pins?: unknown;
	};
	if (
		Array.isArray(record.pins) ||
		record.hardware === "raspberrypi" ||
		record.hardware === "orangepi"
	) {
		return null;
	}
	return typeof record.error === "string" && record.error.trim()
		? record.error
		: null;
}

export function gpioNamedLine(bcm: number): string {
	return `GPIO${bcm}`;
}

function parseDir(dir: unknown, value: unknown): GpioDir {
	if (dir === undefined || dir === "") {
		return value === undefined ? "in" : "out";
	}
	if (dir === "in" || dir === "out" || dir === "pwm" || dir === "off") {
		return dir;
	}
	throw new GpioError("dir must be in, out, pwm, or off");
}

export function gpioPinOff(pin: GpioPinState): GpioPinState {
	const next = { ...pin, dir: "off" as const };
	delete next.value;
	delete next.analog;
	delete next.pwm;
	delete next.hz;
	if (typeof next.adc === "number") {
		next.adc = 0;
	}
	return next;
}

function parseValue(value: unknown): 0 | 1 {
	if (value === 0 || value === "0" || value === false) {
		return 0;
	}
	if (value === 1 || value === "1" || value === true) {
		return 1;
	}
	throw new GpioError("value must be 0 or 1");
}

function parseAnalog(value: unknown): number {
	const analog =
		typeof value === "number"
			? value
			: Number.parseInt(String(value ?? ""), 10);
	if (!Number.isInteger(analog) || analog < 0 || analog > GPIO_ANALOG_MAX) {
		throw new GpioError(`analog must be 0-${GPIO_ANALOG_MAX}`);
	}
	return analog;
}

function parseByte(value: unknown, field: string): number {
	const byte =
		typeof value === "number"
			? value
			: Number.parseInt(String(value ?? ""), 10);
	if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
		throw new GpioError(`${field} must be 0-255`);
	}
	return byte;
}

function parseByteList(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GpioError("data is required");
	}
	return value.map((item, index) => parseByte(item, `data[${index}]`));
}

function parseUartData(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new GpioError("data is required");
	}
	return value;
}

function parseToneHz(value: unknown): number {
	const hz =
		typeof value === "number"
			? value
			: Number.parseInt(String(value ?? ""), 10);
	if (!Number.isInteger(hz) || hz < 31 || hz > 65535) {
		throw new GpioError("tone hz must be 31-65535");
	}
	return hz;
}
