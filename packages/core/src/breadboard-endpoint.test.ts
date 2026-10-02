import { describe, expect, test } from "bun:test";
import { parseWokwiDiagram } from "./breadboard.ts";
import {
	breadboardEndpointLabel,
	resolveBreadboardEndpoint,
} from "./breadboard-endpoint.ts";

const diagram = parseWokwiDiagram({
	version: 1,
	parts: [
		{ id: "bb", type: "wokwi-breadboard-half", left: 200 },
		{
			id: "header",
			type: "gpio-companion-header",
			attrs: { hardware: "orangepi" },
		},
		{
			id: "mega",
			type: "gpio-arduino-proxy",
			left: 450,
			attrs: { board: "mega" },
		},
	],
	connections: [],
});
const words = {
	physical: "physical pin",
	hole: "hole",
	leftRail: "left rail",
	rightRail: "right rail",
};

describe("wiring endpoints", () => {
	test("invalid holes and model-specific out-of-range header pins never become guessed connections", () => {
		expect(resolveBreadboardEndpoint(diagram, "bb:31a")).toBeNull();
		expect(
			resolveBreadboardEndpoint(diagram, "header:27", "Orange Pi 3 LTS"),
		).toBeNull();
		expect(resolveBreadboardEndpoint(diagram, "mega:NOT_A_PIN")).toBeNull();
	});
	test("aliases resolve to exactly the same socket", () => {
		expect(resolveBreadboardEndpoint(diagram, "mega:GND")).not.toBeNull();
		expect(resolveBreadboardEndpoint(diagram, "mega:5V")).not.toBeNull();
		expect(resolveBreadboardEndpoint(diagram, "bb:10A")).toEqual(
			resolveBreadboardEndpoint(diagram, "bb:10a"),
		);
		expect(resolveBreadboardEndpoint(diagram, "mega:A0")).toEqual(
			resolveBreadboardEndpoint(diagram, "mega:54"),
		);
		expect(resolveBreadboardEndpoint(diagram, "mega:D13")).toEqual(
			resolveBreadboardEndpoint(diagram, "mega:13"),
		);
	});
	test("labels distinguish physical, Arduino and rail numbering", () => {
		expect(
			breadboardEndpointLabel(diagram, "header:16", "Orange Pi 3 LTS", words),
		).toContain("physical pin 16 (PD15)");
		expect(breadboardEndpointLabel(diagram, "mega:54", null, words)).toContain(
			"A0",
		);
		expect(breadboardEndpointLabel(diagram, "bb:tn.3", null, words)).toBe(
			"bb · left rail − · hole 3",
		);
	});
});
