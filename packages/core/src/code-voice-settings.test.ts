import { describe, expect, test } from "bun:test";
import {
	codeAppendSpeechDirective,
	codeTtsXaiMicros,
	codeVoiceProvider,
	codeVoiceSettings,
} from "./code-attach.ts";

describe("codeVoiceProvider", () => {
	test("defaults to workers-ai", () => {
		expect(codeVoiceProvider(undefined)).toBe("workers-ai");
		expect(codeVoiceProvider("workers-ai")).toBe("workers-ai");
		expect(codeVoiceProvider("xai")).toBe("xai");
		expect(codeVoiceProvider("other")).toBe("workers-ai");
	});
});

describe("codeVoiceSettings", () => {
	test("normalizes xai voice and rejects unknown voices", () => {
		expect(codeVoiceSettings({ provider: "xai", voice: "REX" })).toEqual({
			provider: "xai",
			voice: "rex",
		});
		expect(codeVoiceSettings({ provider: "xai", voice: "nope" })).toEqual({
			provider: "xai",
			voice: "eve",
		});
	});

	test("clears voice for workers-ai provider", () => {
		expect(codeVoiceSettings({ provider: "workers-ai", voice: "eve" })).toEqual(
			{
				provider: "workers-ai",
				voice: "",
			},
		);
		expect(codeVoiceSettings(null)).toEqual({
			provider: "workers-ai",
			voice: "",
		});
	});
});

describe("codeTtsXaiMicros", () => {
	test("bills $15 per million chars times markup", () => {
		expect(codeTtsXaiMicros(0)).toBe(0);
		expect(codeTtsXaiMicros(1000, 1)).toBe(15_000);
		expect(codeTtsXaiMicros(4000, 1)).toBe(60_000);
		expect(codeTtsXaiMicros(4000, 1.25)).toBe(75_000);
	});
});

describe("codeAppendSpeechDirective", () => {
	test("points at the voice skill per provider", () => {
		const base = "Do the thing.";
		const workers = codeAppendSpeechDirective(base, true);
		expect(workers).toContain("speech-mode");
		expect(workers).toContain("Workers AI");
		const xai = codeAppendSpeechDirective(base, true, "xai");
		expect(xai).toContain("xai-voice");
		expect(xai).toContain("[laugh]");
		expect(codeAppendSpeechDirective(base, false)).toBe(base);
	});
});
