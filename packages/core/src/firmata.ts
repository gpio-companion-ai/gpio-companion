export const START_SYSEX = 0xf0;
export const END_SYSEX = 0xf7;
export const SET_PIN_MODE = 0xf4;
export const SET_DIGITAL_PIN = 0xf5;
export const DIGITAL_MESSAGE = 0x90;
export const ANALOG_MESSAGE = 0xe0;
export const REPORT_ANALOG = 0xc0;
export const REPORT_DIGITAL = 0xd0;
export const REPORT_VERSION = 0xf9;
export const SYSTEM_RESET = 0xff;

export const SYSEX_REPORT_FIRMWARE = 0x79;
export const SYSEX_CAPABILITY_QUERY = 0x6c;
export const SYSEX_CAPABILITY_RESPONSE = 0x6c;
export const SYSEX_ANALOG_MAPPING_QUERY = 0x69;
export const SYSEX_ANALOG_MAPPING_RESPONSE = 0x6a;
export const SYSEX_I2C_REQUEST = 0x76;
export const SYSEX_I2C_REPLY = 0x77;
export const SYSEX_I2C_CONFIG = 0x78;
export const SYSEX_SERIAL = 0x60;
export const SYSEX_SPI_DATA = 0x80;

export const PIN_MODE_INPUT = 0;
export const PIN_MODE_OUTPUT = 1;
export const PIN_MODE_ANALOG = 2;
export const PIN_MODE_PWM = 3;
export const PIN_MODE_SERVO = 4;
export const PIN_MODE_I2C = 6;
export const PIN_MODE_SERIAL = 10;
export const PIN_MODE_PULLUP = 11;
export const PIN_MODE_SPI = 12;
export const PIN_MODE_IGNORE = 0x7f;

export const I2C_WRITE = 0;
export const I2C_READ = 1;
export const I2C_READ_CONTINUOUS = 2;
export const I2C_STOP_READING = 3;

export type FirmataPinMode =
	| "input"
	| "output"
	| "analog"
	| "pwm"
	| "servo"
	| "i2c"
	| "serial"
	| "pullup"
	| "spi"
	| "ignore";

export type FirmataEvent =
	| { type: "firmware"; name: string; major: number; minor: number }
	| { type: "version"; major: number; minor: number }
	| { type: "digital"; port: number; value: number }
	| { type: "analog"; pin: number; value: number }
	| { type: "capability"; pins: FirmataPinCapability[] }
	| { type: "analog-map"; map: number[] }
	| { type: "i2c-reply"; address: number; data: number[] }
	| { type: "sysex"; command: number; data: number[] };

export type FirmataPinCapability = {
	pin: number;
	modes: FirmataPinMode[];
};

const MODE_BY_CODE: Record<number, FirmataPinMode> = {
	[PIN_MODE_INPUT]: "input",
	[PIN_MODE_OUTPUT]: "output",
	[PIN_MODE_ANALOG]: "analog",
	[PIN_MODE_PWM]: "pwm",
	[PIN_MODE_SERVO]: "servo",
	[PIN_MODE_I2C]: "i2c",
	[PIN_MODE_SERIAL]: "serial",
	[PIN_MODE_PULLUP]: "pullup",
	[PIN_MODE_SPI]: "spi",
	[PIN_MODE_IGNORE]: "ignore",
};

const CODE_BY_MODE: Record<FirmataPinMode, number> = {
	input: PIN_MODE_INPUT,
	output: PIN_MODE_OUTPUT,
	analog: PIN_MODE_ANALOG,
	pwm: PIN_MODE_PWM,
	servo: PIN_MODE_SERVO,
	i2c: PIN_MODE_I2C,
	serial: PIN_MODE_SERIAL,
	pullup: PIN_MODE_PULLUP,
	spi: PIN_MODE_SPI,
	ignore: PIN_MODE_IGNORE,
};

export function firmataModeCode(mode: FirmataPinMode): number {
	return CODE_BY_MODE[mode];
}

export function encodeSysex(command: number, data: number[] = []): Uint8Array {
	return Uint8Array.from([START_SYSEX, command, ...data, END_SYSEX]);
}

export function encodeQueryFirmware(): Uint8Array {
	return encodeSysex(SYSEX_REPORT_FIRMWARE);
}

export function encodeCapabilityQuery(): Uint8Array {
	return encodeSysex(SYSEX_CAPABILITY_QUERY);
}

export function encodeAnalogMappingQuery(): Uint8Array {
	return encodeSysex(SYSEX_ANALOG_MAPPING_QUERY);
}

export function encodeSetPinMode(
	pin: number,
	mode: FirmataPinMode,
): Uint8Array {
	return Uint8Array.from([SET_PIN_MODE, pin & 0x7f, firmataModeCode(mode)]);
}

export function encodeDigitalPin(pin: number, value: 0 | 1): Uint8Array {
	return Uint8Array.from([SET_DIGITAL_PIN, pin & 0x7f, value]);
}

export function encodeAnalogWrite(pin: number, value: number): Uint8Array {
	const analog = Math.max(0, Math.min(16383, Math.round(value)));
	return Uint8Array.from([
		ANALOG_MESSAGE | (pin & 0x0f),
		analog & 0x7f,
		(analog >> 7) & 0x7f,
	]);
}

export function encodeReportDigital(
	port: number,
	enabled: boolean,
): Uint8Array {
	return Uint8Array.from([REPORT_DIGITAL | (port & 0x0f), enabled ? 1 : 0]);
}

export function encodeReportAnalog(pin: number, enabled: boolean): Uint8Array {
	return Uint8Array.from([REPORT_ANALOG | (pin & 0x0f), enabled ? 1 : 0]);
}

export function encodeSystemReset(): Uint8Array {
	return Uint8Array.from([SYSTEM_RESET]);
}

export function encodeI2cConfig(delayUs = 0): Uint8Array {
	return encodeSysex(SYSEX_I2C_CONFIG, [delayUs & 0x7f, (delayUs >> 7) & 0x7f]);
}

export function encodeI2cWrite(address: number, data: number[]): Uint8Array {
	return encodeSysex(SYSEX_I2C_REQUEST, [
		address & 0x7f,
		I2C_WRITE << 3,
		...to14BitBytes(data),
	]);
}

export function encodeI2cRead(address: number, length: number): Uint8Array {
	return encodeSysex(SYSEX_I2C_REQUEST, [
		address & 0x7f,
		I2C_READ << 3,
		length & 0x7f,
		(length >> 7) & 0x7f,
	]);
}

export function encodeI2cScan(): Uint8Array[] {
	const frames: Uint8Array[] = [encodeI2cConfig()];
	for (let address = 8; address < 120; address++) {
		frames.push(encodeI2cRead(address, 1));
	}
	return frames;
}

export function encodeSpiTransfer(data: number[]): Uint8Array {
	return encodeSysex(SYSEX_SPI_DATA, [0, ...to14BitBytes(data)]);
}

export function encodeSerialWrite(port: number, data: number[]): Uint8Array {
	return encodeSysex(SYSEX_SERIAL, [
		(1 << 4) | (port & 0x0f),
		...to14BitBytes(data),
	]);
}

export function encodeSerialListen(port: number, baud: number): Uint8Array {
	return encodeSysex(SYSEX_SERIAL, [
		0x10 | (port & 0x0f),
		baud & 0x7f,
		(baud >> 7) & 0x7f,
		(baud >> 14) & 0x7f,
	]);
}

export function createFirmataParser(): {
	push(bytes: Uint8Array | number[]): FirmataEvent[];
} {
	const buffer: number[] = [];
	return {
		push(bytes) {
			buffer.push(...bytes);
			return drainFirmata(buffer);
		},
	};
}

export function parseFirmataBytes(
	bytes: Uint8Array | number[],
): FirmataEvent[] {
	return createFirmataParser().push(bytes);
}

function drainFirmata(buffer: number[]): FirmataEvent[] {
	const events: FirmataEvent[] = [];
	while (buffer.length > 0) {
		const first = buffer[0];
		if (first === undefined) {
			break;
		}
		if (first === START_SYSEX) {
			const end = buffer.indexOf(END_SYSEX);
			if (end < 0) {
				break;
			}
			const frame = buffer.splice(0, end + 1);
			const event = parseSysex(frame.slice(1, -1));
			if (event) {
				events.push(event);
			}
			continue;
		}
		if (first === REPORT_VERSION) {
			if (buffer.length < 3) {
				break;
			}
			const major = buffer[1] ?? 0;
			const minor = buffer[2] ?? 0;
			buffer.splice(0, 3);
			events.push({ type: "version", major, minor });
			continue;
		}
		if ((first & 0xf0) === DIGITAL_MESSAGE) {
			if (buffer.length < 3) {
				break;
			}
			const port = first & 0x0f;
			const lsb = buffer[1] ?? 0;
			const msb = buffer[2] ?? 0;
			buffer.splice(0, 3);
			events.push({ type: "digital", port, value: lsb | (msb << 7) });
			continue;
		}
		if ((first & 0xf0) === ANALOG_MESSAGE) {
			if (buffer.length < 3) {
				break;
			}
			const pin = first & 0x0f;
			const lsb = buffer[1] ?? 0;
			const msb = buffer[2] ?? 0;
			buffer.splice(0, 3);
			events.push({ type: "analog", pin, value: lsb | (msb << 7) });
			continue;
		}
		buffer.shift();
	}
	return events;
}

function parseSysex(data: number[]): FirmataEvent | null {
	const command = data[0];
	if (command === undefined) {
		return null;
	}
	const payload = data.slice(1);
	if (command === SYSEX_REPORT_FIRMWARE) {
		const major = payload[0] ?? 0;
		const minor = payload[1] ?? 0;
		return {
			type: "firmware",
			major,
			minor,
			name: from14BitString(payload.slice(2)),
		};
	}
	if (command === SYSEX_CAPABILITY_RESPONSE) {
		return { type: "capability", pins: parseCapabilities(payload) };
	}
	if (command === SYSEX_ANALOG_MAPPING_RESPONSE) {
		return { type: "analog-map", map: payload.map((value) => value) };
	}
	if (command === SYSEX_I2C_REPLY) {
		const address = from14Bit(payload[0] ?? 0, payload[1] ?? 0);
		const register = from14Bit(payload[2] ?? 0, payload[3] ?? 0);
		void register;
		const bytes: number[] = [];
		for (let index = 4; index + 1 < payload.length; index += 2) {
			bytes.push(from14Bit(payload[index] ?? 0, payload[index + 1] ?? 0));
		}
		return { type: "i2c-reply", address, data: bytes };
	}
	return { type: "sysex", command, data: payload };
}

function parseCapabilities(payload: number[]): FirmataPinCapability[] {
	const pins: FirmataPinCapability[] = [];
	let pin = 0;
	let modes: FirmataPinMode[] = [];
	for (let index = 0; index < payload.length; index++) {
		const value = payload[index];
		if (value === 0x7f) {
			pins.push({ pin, modes });
			pin += 1;
			modes = [];
			continue;
		}
		const mode = MODE_BY_CODE[value ?? -1];
		if (mode) {
			modes.push(mode);
		}
		index += 1;
	}
	return pins;
}

function to14BitBytes(data: number[]): number[] {
	const out: number[] = [];
	for (const value of data) {
		const byte = value & 0xff;
		out.push(byte & 0x7f, (byte >> 7) & 0x7f);
	}
	return out;
}

function from14Bit(lsb: number, msb: number): number {
	return (lsb & 0x7f) | ((msb & 0x7f) << 7);
}

function from14BitString(data: number[]): string {
	const chars: string[] = [];
	for (let index = 0; index + 1 < data.length; index += 2) {
		const code = from14Bit(data[index] ?? 0, data[index + 1] ?? 0);
		if (code) {
			chars.push(String.fromCharCode(code));
		}
	}
	return chars.join("");
}
