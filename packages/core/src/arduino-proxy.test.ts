import { describe, expect, test } from "bun:test";
import {
	ArduinoProxyError,
	arduinoCoreForFqbn,
	arduinoProxyBoard,
	arduinoProxyBoardFromProbe,
	arduinoProxyPins,
	arduinoProxySketchName,
	emptyArduinoProxyStatus,
	isArduinoProxyFqbn,
	isArduinoProxyPath,
	isArduinoProxySketchName,
	normalizeFqbn,
	parseArduinoCoreList,
	parseFlashProxyPut,
} from "./arduino-proxy.ts";
import { arduinoProxyHeaderLayout } from "./arduino-proxy-layout.ts";
import {
	encodeAnalogMappingQuery,
	encodeAnalogWrite,
	encodeCapabilityQuery,
	encodeDigitalPin,
	encodeQueryFirmware,
	encodeReportAnalog,
	encodeSetPinMode,
	encodeSysex,
	encodeSystemReset,
	parseFirmataBytes,
	SYSEX_CAPABILITY_RESPONSE,
	SYSEX_REPORT_FIRMWARE,
} from "./firmata.ts";
import { FLASH_PROXY_PATH } from "./flash.ts";
import { parseGpioPut, parseGpioWsCommand } from "./gpio.ts";

describe("arduino proxy boards", () => {
	test("maps uno nano mega samd esp32 fqbns", () => {
		expect(arduinoProxyBoard("arduino:avr:uno")?.id).toBe("uno");
		expect(arduinoProxyBoard("arduino:avr:mega:cpu=atmega2560")?.id).toBe(
			"mega",
		);
		expect(arduinoProxyBoard("arduino:samd:nano_33_iot")?.voltage).toBe("3v3");
		expect(arduinoProxyBoard("esp32:esp32:esp32")?.family).toBe("esp32");
		expect(isArduinoProxyFqbn("arduino:avr:uno")).toBe(true);
		expect(isArduinoProxyFqbn("arduino:avr:leonardo")).toBe(false);
		expect(normalizeFqbn("arduino:avr:mega:cpu=atmega2560")).toBe(
			"arduino:avr:mega",
		);
		expect(arduinoCoreForFqbn("arduino:avr:uno")).toBe("arduino:avr");
		expect(arduinoCoreForFqbn("arduino:samd:nano_33_iot")).toBe("arduino:samd");
		expect(arduinoCoreForFqbn("esp32:esp32:esp32s3")).toBe("esp32:esp32");
		expect(
			parseArduinoCoreList({ platforms: [{ id: "arduino:avr" }] }),
		).toEqual(["arduino:avr"]);
	});

	test("capability pin count identifies a mega mislabeled as uno", () => {
		expect(arduinoProxyBoardFromProbe({ pinCount: 70 })?.id).toBe("mega");
		const map = Array.from({ length: 70 }, () => 127);
		map[54] = 0;
		expect(arduinoProxyBoardFromProbe({ analogMap: map })?.fqbn).toBe(
			"arduino:avr:mega",
		);
		expect(arduinoProxyBoardFromProbe({ pinCount: 20 })).toBeUndefined();
	});

	test("uno reserves D0/D1 and exposes A0 as 14", () => {
		const uno = arduinoProxyBoard("uno");
		if (!uno) {
			throw new Error("missing uno");
		}
		const pins = arduinoProxyPins(uno);
		expect(pins.find((pin) => pin.physical === 0)?.reserved).toBe(true);
		expect(pins.find((pin) => pin.physical === 13)?.name).toBe("D13");
		expect(pins.find((pin) => pin.physical === 14)?.name).toBe("A0");
	});

	test("uno header layout matches the board USB-at-top", () => {
		const uno = arduinoProxyBoard("uno");
		if (!uno) {
			throw new Error("missing uno");
		}
		const layout = arduinoProxyHeaderLayout(arduinoProxyPins(uno), "uno");
		expect(layout.right[0]).toEqual({ kind: "gpio", physical: 13 });
		expect(layout.right[13]).toEqual({ kind: "gpio", physical: 0 });
		expect(
			layout.left.some((seat) => seat.kind === "gpio" && seat.physical === 14),
		).toBe(true);
		expect(layout.extra).toEqual([]);
	});
});

describe("sketch names", () => {
	test("prefixes kebab names", () => {
		expect(arduinoProxySketchName("blink")).toBe("arduino-proxy-blink");
		expect(arduinoProxySketchName("arduino-proxy-fade")).toBe(
			"arduino-proxy-fade",
		);
		expect(isArduinoProxySketchName("arduino-proxy-blink")).toBe(true);
		expect(isArduinoProxySketchName("blink")).toBe(false);
		expect(() => arduinoProxySketchName("")).toThrow(ArduinoProxyError);
	});
});

describe("flash proxy put", () => {
	test("optional fqbn and port", () => {
		expect(parseFlashProxyPut({})).toEqual({});
		expect(
			parseFlashProxyPut({
				fqbn: "arduino:avr:uno",
				port: "/dev/ttyACM0",
			}),
		).toEqual({ fqbn: "arduino:avr:uno", port: "/dev/ttyACM0" });
		expect(() => parseFlashProxyPut({ fqbn: "arduino:avr:leonardo" })).toThrow(
			"unsupported fqbn",
		);
	});

	test("paths", () => {
		expect(isArduinoProxyPath("/v1/arduino-proxy")).toBe(true);
		expect(isArduinoProxyPath(FLASH_PROXY_PATH)).toBe(true);
		expect(isArduinoProxyPath("/v1/flash")).toBe(false);
	});
});

describe("firmata", () => {
	test("encodes queries and pin writes", () => {
		expect([...encodeQueryFirmware()]).toEqual([0xf0, 0x79, 0xf7]);
		expect([...encodeCapabilityQuery()]).toEqual([0xf0, 0x6c, 0xf7]);
		expect([...encodeSetPinMode(13, "output")]).toEqual([0xf4, 13, 1]);
		expect([...encodeSetPinMode(9, "pwm")]).toEqual([0xf4, 9, 3]);
		expect([...encodeDigitalPin(13, 1)]).toEqual([0xf5, 13, 1]);
		expect([...encodeAnalogWrite(9, 64)]).toEqual([0xe9, 64, 0]);
		expect([...encodeSetPinMode(14, "analog")]).toEqual([0xf4, 14, 2]);
		expect([...encodeSetPinMode(14, "ignore")]).toEqual([0xf4, 14, 0x7f]);
		expect([...encodeReportAnalog(0, true)]).toEqual([0xc0, 1]);
		expect([...encodeSystemReset()]).toEqual([0xff]);
		expect([...encodeAnalogMappingQuery()]).toEqual([0xf0, 0x69, 0xf7]);
	});

	test("parses firmware and capability sysex", () => {
		const name = encodeSysex(SYSEX_REPORT_FIRMWARE, [2, 5, 0x43, 0, 0x46, 0]);
		const events = parseFirmataBytes(name);
		expect(events[0]).toMatchObject({ type: "firmware", major: 2, minor: 5 });
		const capability = encodeSysex(
			SYSEX_CAPABILITY_RESPONSE,
			[0, 1, 1, 1, 0x7f, 0, 1, 1, 1, 0x7f],
		);
		expect(parseFirmataBytes(capability)[0]).toMatchObject({
			type: "capability",
		});
		const analogMap = encodeSysex(0x6a, [127, 127, 0, 1]);
		expect(parseFirmataBytes(analogMap)[0]).toMatchObject({
			type: "analog-map",
			map: [127, 127, 0, 1],
		});
		expect(parseFirmataBytes([0xe0, 0x7b, 0x03])[0]).toMatchObject({
			type: "analog",
			pin: 0,
			value: 507,
		});
	});
});

describe("gpio target", () => {
	test("parses arduino-proxy pin 0", () => {
		expect(
			parseGpioPut({
				target: "arduino-proxy",
				physical: 13,
				dir: "out",
				value: 1,
			}),
		).toEqual({
			target: "arduino-proxy",
			physical: 13,
			dir: "out",
			value: 1,
		});
		expect(
			parseGpioWsCommand({ op: "refresh", target: "arduino-proxy" }),
		).toEqual({ op: "refresh", target: "arduino-proxy" });
		expect(
			parseGpioWsCommand({ op: "i2c-scan", target: "arduino-proxy" }),
		).toEqual({ op: "i2c-scan", target: "arduino-proxy" });
	});
});

describe("empty status", () => {
	test("disconnected", () => {
		expect(emptyArduinoProxyStatus()).toMatchObject({
			connected: false,
			protocol: "firmata",
			pins: [],
		});
	});
});
