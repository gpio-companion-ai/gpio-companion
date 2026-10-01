import { describe, expect, test } from "bun:test";
import { codeVoiceUtterance } from "./code-attach.ts";

describe("codeVoiceUtterance", () => {
	test("drops empty and whitespace-only", () => {
		expect(codeVoiceUtterance("")).toBe("");
		expect(codeVoiceUtterance("   \n\t ")).toBe("");
	});

	test("drops punctuation-only transcripts", () => {
		expect(codeVoiceUtterance(".")).toBe("");
		expect(codeVoiceUtterance("...")).toBe("");
		expect(codeVoiceUtterance("– ?! . ,")).toBe("");
	});

	test("drops noise words and fillers", () => {
		expect(codeVoiceUtterance("You")).toBe("");
		expect(codeVoiceUtterance("hmm")).toBe("");
		expect(codeVoiceUtterance("Uh, mhm...")).toBe("");
		expect(codeVoiceUtterance("Euh…")).toBe("");
		expect(codeVoiceUtterance("Mm-hmm.")).toBe("");
	});

	test("drops single very short words", () => {
		expect(codeVoiceUtterance("Hi")).toBe("");
		expect(codeVoiceUtterance("Ok")).toBe("");
	});

	test("keeps real utterances and trims them", () => {
		expect(codeVoiceUtterance("  blink the led on pin seven ")).toBe(
			"blink the led on pin seven",
		);
		expect(codeVoiceUtterance("C'est bon, allume la DEL.")).toBe(
			"C'est bon, allume la DEL.",
		);
		expect(codeVoiceUtterance("You should add a resistor here")).toBe(
			"You should add a resistor here",
		);
	});
});
