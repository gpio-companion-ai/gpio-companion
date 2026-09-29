import { describe, expect, test } from "bun:test";
import {
	OPENCODE_LOOPBACK_URL,
	OPENCODE_PROXY_PATH,
	opencodeProxyTarget,
	opencodeUpstreamUrl,
} from "./opencode-server.ts";

describe("opencode server proxy target", () => {
	test("maps signed health onto loopback and keeps the query", () => {
		expect(
			opencodeProxyTarget(
				`${OPENCODE_PROXY_PATH}/global/health`,
				"?directory=%2Fhome%2Fcompanion%2Fprojects%2Fdemo",
			),
		).toBe(
			"http://127.0.0.1:4096/global/health?directory=%2Fhome%2Fcompanion%2Fprojects%2Fdemo",
		);
	});

	test("refuses a public upstream and the device API port", () => {
		expect(() => opencodeUpstreamUrl("http://0.0.0.0:4096")).toThrow(
			"loopback",
		);
		expect(() =>
			opencodeUpstreamUrl("https://code-abc.gpio-companion.com"),
		).toThrow("loopback");
		expect(() => opencodeUpstreamUrl("http://127.0.0.1:4150")).toThrow(
			"loopback",
		);
		expect(opencodeUpstreamUrl()).toBe(OPENCODE_LOOPBACK_URL);
	});
});
