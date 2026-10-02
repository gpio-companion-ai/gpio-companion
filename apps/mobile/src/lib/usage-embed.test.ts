import { describe, expect, test } from "bun:test";
import {
	mobileUsageEmbedUrl,
	USAGE_EMBED_MESSAGE_TYPE,
	usageEmbedScript,
} from "./usage-embed.ts";

describe("mobile usage embed", () => {
	test("builds the dashboard embed url", () => {
		expect(
			mobileUsageEmbedUrl("https://gpio-companion.com", {
				locale: "fr",
				theme: "dark",
			}),
		).toBe("https://gpio-companion.com/embed/usage?locale=fr&theme=dark");
	});

	test("injects the gpio-usage payload", () => {
		const script = usageEmbedScript({
			type: USAGE_EMBED_MESSAGE_TYPE,
			days: 30,
			since: "",
			calls: 0,
			micros: 0,
			byKind: [],
			byModel: [],
			daily: [],
		});
		expect(script).toContain("window.__gpioUsagePending");
		expect(script).toContain("window.__gpioUsageEmbed");
		expect(script).toContain(USAGE_EMBED_MESSAGE_TYPE);
		expect(script.endsWith("true;")).toBe(true);
	});
});
