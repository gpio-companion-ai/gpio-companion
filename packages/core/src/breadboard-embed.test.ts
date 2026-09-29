import { describe, expect, test } from "bun:test";
import {
	BREADBOARD_EMBED_BRIDGE_KEY,
	BREADBOARD_EMBED_MESSAGE_TYPE,
	BREADBOARD_EMBED_PATH,
	BREADBOARD_EMBED_PENDING_KEY,
	type BreadboardEmbedPayload,
	breadboardEmbedInjectSource,
	breadboardEmbedUrl,
	isEmbedPath,
	parseBreadboardEmbedMessage,
} from "./breadboard-embed.ts";

describe("breadboard embed path", () => {
	test("matches embed routes", () => {
		expect(isEmbedPath("/embed/breadboard")).toBe(true);
		expect(isEmbedPath("/embed")).toBe(true);
		expect(isEmbedPath("/embed/breadboard/")).toBe(true);
		expect(isEmbedPath("/project")).toBe(false);
		expect(isEmbedPath("/devices/code")).toBe(false);
	});
});

describe("breadboard embed url", () => {
	test("builds the dashboard embed origin", () => {
		expect(breadboardEmbedUrl("https://gpio-companion.com")).toBe(
			`https://gpio-companion.com${BREADBOARD_EMBED_PATH}`,
		);
		expect(
			breadboardEmbedUrl("https://gpio-companion.com/", {
				locale: "fr",
				theme: "dark",
			}),
		).toBe("https://gpio-companion.com/embed/breadboard?locale=fr&theme=dark");
	});
});

describe("breadboard embed inject", () => {
	test("stashes the payload until the bridge exists", () => {
		const script = breadboardEmbedInjectSource({
			type: BREADBOARD_EMBED_MESSAGE_TYPE,
			diagramText: "</script>",
		});
		expect(script).toContain(`window.${BREADBOARD_EMBED_PENDING_KEY}=`);
		expect(script).toContain(`window.${BREADBOARD_EMBED_BRIDGE_KEY}`);
		expect(script).not.toContain("</script>");
		expect(script.endsWith("true;")).toBe(true);
	});
});

describe("parseBreadboardEmbedMessage", () => {
	test("accepts object and JSON payloads", () => {
		const payload: BreadboardEmbedPayload = {
			type: BREADBOARD_EMBED_MESSAGE_TYPE,
			diagramText: '{"version":1}',
			previewUrl: null,
			livePins: { 7: 1, 11: 0 },
			arduinoLivePins: { 13: 1 },
			verifyResults: [
				{ id: "net-1", status: "pass", partIds: ["led1"], connections: [0] },
			],
			boardModel: "Orange Pi 3 LTS",
		};
		expect(parseBreadboardEmbedMessage(payload)).toEqual(payload);
		expect(parseBreadboardEmbedMessage(JSON.stringify(payload))).toEqual(
			payload,
		);
	});

	test("rejects other messages", () => {
		expect(parseBreadboardEmbedMessage({ type: "other" })).toBeNull();
		expect(parseBreadboardEmbedMessage("not json")).toBeNull();
		expect(parseBreadboardEmbedMessage(null)).toBeNull();
	});
});
