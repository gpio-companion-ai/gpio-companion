import { describe, expect, test } from "bun:test";
import {
	MODEL_EMBED_MESSAGE_TYPE,
	mobileModelEmbedUrl,
	modelEmbedScript,
} from "./model-embed.ts";

describe("mobile model embed", () => {
	test("builds the dashboard embed url", () => {
		expect(
			mobileModelEmbedUrl("https://gpio-companion.com", {
				locale: "fr",
				theme: "dark",
			}),
		).toBe("https://gpio-companion.com/embed/model?locale=fr&theme=dark");
	});

	test("injects the gpio-model payload", () => {
		const script = modelEmbedScript({
			type: MODEL_EMBED_MESSAGE_TYPE,
			glbBase64: "AAAA",
		});
		expect(script).toContain("window.__gpioModelPending");
		expect(script).toContain("window.__gpioModelEmbed");
		expect(script).toContain(MODEL_EMBED_MESSAGE_TYPE);
		expect(script.endsWith("true;")).toBe(true);
	});
});
