import { describe, expect, test } from "bun:test";
import {
	capFlashLog,
	FLASH_LOG_MAX,
	FlashError,
	isFlashPath,
	isUsbArduinoPort,
	parseArduinoBoardList,
	parseFlashPut,
	pickArduinoProxyFqbn,
	pickFlashTarget,
	pickProxyFlashPort,
} from "./flash.ts";

describe("parseFlashPut", () => {
	test("requires fqbn and absolute dir", () => {
		expect(
			parseFlashPut({ fqbn: "arduino:avr:uno", dir: "/home/gpio/blink" }),
		).toEqual({
			fqbn: "arduino:avr:uno",
			dir: "/home/gpio/blink",
		});
	});

	test("optional port", () => {
		expect(
			parseFlashPut({
				fqbn: "arduino:avr:uno",
				dir: "/tmp/sketch",
				port: "/dev/ttyUSB0",
			}).port,
		).toBe("/dev/ttyUSB0");
	});

	test("rejects relative dir and traversal", () => {
		expect(() =>
			parseFlashPut({ fqbn: "arduino:avr:uno", dir: "blink" }),
		).toThrow(FlashError);
		expect(() =>
			parseFlashPut({ fqbn: "arduino:avr:uno", dir: "/tmp/../etc" }),
		).toThrow("absolute");
	});

	test("rejects empty fqbn", () => {
		expect(() => parseFlashPut({ dir: "/tmp/sketch" })).toThrow("fqbn");
	});
});

describe("pickFlashTarget", () => {
	const ports = [
		{
			address: "/dev/ttyUSB0",
			fqbn: "arduino:avr:uno",
			name: "Arduino Uno",
		},
		{
			address: "/dev/ttyACM0",
			fqbn: "arduino:avr:nano",
			name: "Arduino Nano",
		},
	];

	test("uses the connected proxy port and fqbn", () => {
		expect(
			pickFlashTarget(ports, {
				connected: true,
				port: "/dev/ttyACM0",
				fqbn: "arduino:avr:nano",
				baud: 57600,
			}),
		).toEqual({
			port: "/dev/ttyACM0",
			fqbn: "arduino:avr:nano",
			baud: 57600,
		});
	});

	test("falls back to the first detected port when nothing is connected", () => {
		expect(pickFlashTarget(ports, { connected: false })).toEqual({
			port: "/dev/ttyUSB0",
			fqbn: "arduino:avr:uno",
		});
	});
});

describe("parseArduinoBoardList", () => {
	test("reads detected_ports json", () => {
		expect(
			parseArduinoBoardList({
				detected_ports: [
					{
						port: { address: "/dev/ttyUSB0", protocol: "serial" },
						matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
					},
				],
			}),
		).toEqual([
			{
				address: "/dev/ttyUSB0",
				protocol: "serial",
				fqbn: "arduino:avr:uno",
				name: "Arduino Uno",
			},
		]);
	});

	test("prefers mega when uno is listed first", () => {
		expect(
			parseArduinoBoardList({
				detected_ports: [
					{
						port: {
							address: "/dev/ttyACM0",
							protocol: "serial",
							properties: { vid: "0x2341", pid: "0x0042" },
						},
						matching_boards: [
							{ name: "Arduino Uno", fqbn: "arduino:avr:uno" },
							{
								name: "Arduino Mega or Mega 2560",
								fqbn: "arduino:avr:mega",
							},
						],
					},
				],
			}),
		).toEqual([
			{
				address: "/dev/ttyACM0",
				protocol: "serial",
				fqbn: "arduino:avr:mega",
				name: "Arduino Mega or Mega 2560",
			},
		]);
	});

	test("does not assume uno when the port is ambiguous", () => {
		expect(
			pickArduinoProxyFqbn({
				boards: [
					{ name: "Arduino Uno", fqbn: "arduino:avr:uno" },
					{ name: "Arduino Nano", fqbn: "arduino:avr:nano" },
				],
			}),
		).toEqual({});
		expect(
			parseArduinoBoardList({
				detected_ports: [{ port: { address: "/dev/ttyUSB0" } }],
			})[0]?.fqbn,
		).toBeUndefined();
	});

	test("drops the onboard debug uart", () => {
		expect(isUsbArduinoPort("/dev/ttyACM0")).toBe(true);
		expect(isUsbArduinoPort("/dev/ttyUSB0")).toBe(true);
		expect(isUsbArduinoPort("/dev/ttyS0")).toBe(false);
		expect(
			parseArduinoBoardList({
				detected_ports: [
					{ port: { address: "/dev/ttyS0", protocol: "serial" } },
					{
						port: { address: "/dev/ttyACM0", protocol: "serial" },
						matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }],
					},
				],
			}).map((port) => port.address),
		).toEqual(["/dev/ttyACM0"]);
	});

	test("proxy flash ignores ttyS0", () => {
		const ports = [
			{ address: "/dev/ttyS0" },
			{ address: "/dev/ttyACM0", fqbn: "arduino:avr:uno" },
		];
		expect(pickProxyFlashPort(ports)).toBe("/dev/ttyACM0");
		expect(pickProxyFlashPort(ports, "/dev/ttyS0")).toBe("/dev/ttyACM0");
		expect(pickProxyFlashPort([{ address: "/dev/ttyS0" }])).toBeUndefined();
		expect(pickProxyFlashPort(ports, "/dev/ttyACM0")).toBe("/dev/ttyACM0");
	});

	test("parses json string", () => {
		expect(
			parseArduinoBoardList(
				JSON.stringify({
					detected_ports: [{ port: { address: "/dev/ttyACM0" } }],
				}),
			)[0]?.address,
		).toBe("/dev/ttyACM0");
	});
});

describe("flash helpers", () => {
	test("path match", () => {
		expect(isFlashPath("/v1/flash")).toBe(true);
		expect(isFlashPath("/v1/flash/ports")).toBe(true);
		expect(isFlashPath("/v1/flash/sketches")).toBe(true);
		expect(isFlashPath("/v1/flash/proxy")).toBe(true);
		expect(isFlashPath("/v1/flash/stop")).toBe(true);
		expect(isFlashPath("/v1/gpio")).toBe(false);
	});

	test("caps log", () => {
		expect(capFlashLog("ok")).toBe("ok");
		const log = "x".repeat(FLASH_LOG_MAX + 10);
		expect(capFlashLog(log).length).toBe(FLASH_LOG_MAX);
	});
});
