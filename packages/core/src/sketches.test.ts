import { describe, expect, test } from "bun:test";
import {
	findSketchByName,
	parseBoardSketchList,
	sketchKindDir,
	sketchNameFromPath,
} from "./sketches.ts";

describe("board sketches", () => {
	test("kind dirs", () => {
		expect(sketchKindDir("host")).toBe("host");
		expect(sketchKindDir("firmware")).toBe("firmware");
	});

	test("sketch name from path", () => {
		expect(sketchNameFromPath("host", "host/blink/blink.c")).toBe("blink");
		expect(sketchNameFromPath("host", "host/blink/src/main.c")).toBe("blink");
		expect(sketchNameFromPath("host", "host/arduino-proxy-uno/main.c")).toBe(
			"arduino-proxy-uno",
		);
		expect(sketchNameFromPath("host", "host/main.c")).toBe("host");
		expect(sketchNameFromPath("firmware", "firmware/uno/uno.c")).toBe("uno");
		expect(sketchNameFromPath("firmware", "host/blink/blink.c")).toBeNull();
		expect(sketchNameFromPath("host", "firmware/uno/uno.c")).toBeNull();
		expect(sketchNameFromPath("host", "host/blink/blink.h")).toBeNull();
		expect(sketchNameFromPath("host", "host/blink/main.c.txt")).toBeNull();
		expect(sketchNameFromPath("host", "host/blink")).toBeNull();
		expect(sketchNameFromPath("host", "host")).toBeNull();
		expect(sketchNameFromPath("host", "host/.hidden/sketch.c")).toBeNull();
		expect(sketchNameFromPath("host", "pcb/circuit.json")).toBeNull();
		expect(sketchNameFromPath("host", "")).toBeNull();
	});

	test("find sketch by name", () => {
		const { sketches } = parseBoardSketchList({
			sketches: [
				{
					project: "blink-led",
					name: "blink",
					dir: "/home/companion/projects/blink-led/host/blink",
					files: ["blink.c"],
				},
				{
					project: "other",
					name: "blink",
					dir: "/home/companion/projects/other/host/blink",
					files: ["blink.c"],
				},
			],
		});
		expect(findSketchByName(sketches, "blink-led", "blink")?.dir).toBe(
			"/home/companion/projects/blink-led/host/blink",
		);
		expect(findSketchByName(sketches, "missing", "blink")).toBeNull();
	});

	test("parses a list", () => {
		expect(
			parseBoardSketchList({
				sketches: [
					{
						project: "blink-led",
						name: "blink",
						dir: "/home/companion/projects/blink-led/host/blink",
						files: ["blink.c"],
					},
				],
			}),
		).toEqual({
			sketches: [
				{
					project: "blink-led",
					name: "blink",
					dir: "/home/companion/projects/blink-led/host/blink",
					files: ["blink.c"],
				},
			],
		});
	});

	test("rejects relative dir", () => {
		expect(() =>
			parseBoardSketchList({
				sketches: [
					{
						project: "blink",
						name: "blink",
						dir: "host/blink",
						files: ["blink.c"],
					},
				],
			}),
		).toThrow("absolute");
	});
});
