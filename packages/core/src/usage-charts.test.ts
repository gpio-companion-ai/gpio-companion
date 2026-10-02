import { describe, expect, test } from "bun:test";
import {
	buildUsageAreaOption,
	buildUsageLeaderboardOption,
	buildUsageVoiceOption,
	parseUsageEmbedMessage,
	USAGE_EMBED_MESSAGE_TYPE,
	USAGE_EMBED_PATH,
	type UsageChartSummary,
	usageEmbedInjectSource,
	usageEmbedUrl,
	usageKindMicros,
	usageModelShort,
} from "./usage-charts.ts";

function sample(): UsageChartSummary {
	return {
		days: 30,
		since: "2026-09-02T00:00:00.000Z",
		calls: 5,
		micros: 1000,
		byKind: [
			{
				kind: "chat",
				calls: 3,
				micros: 900,
				promptTokens: 300,
				completionTokens: 70,
				audioSeconds: 0,
				chars: 0,
			},
			{
				kind: "stt",
				calls: 2,
				micros: 100,
				promptTokens: 0,
				completionTokens: 0,
				audioSeconds: 120,
				chars: 0,
			},
		],
		byModel: [
			{
				model: "@cf/zai-org/glm-5.3",
				kind: "chat",
				calls: 3,
				micros: 900,
				promptTokens: 300,
				completionTokens: 70,
			},
		],
		daily: [
			{ date: "2026-09-02", chat: 100, embedding: 0, stt: 10, tts: 0 },
			{ date: "2026-09-03", chat: 800, embedding: 0, stt: 90, tts: 0 },
		],
	};
}

describe("usage charts", () => {
	test("shortens model ids", () => {
		expect(usageModelShort("@cf/zai-org/glm-5.3")).toBe("glm-5.3");
		expect(usageModelShort("xai-tts")).toBe("xai-tts");
		expect(usageModelShort("")).toBe("unknown");
	});

	test("sums kind spend", () => {
		expect(usageKindMicros(sample(), "chat")).toBe(900);
		expect(usageKindMicros(sample(), "tts")).toBe(0);
	});

	test("builds embed url", () => {
		expect(
			usageEmbedUrl("https://gpio-companion.com/", { theme: "dark" }),
		).toBe(`https://gpio-companion.com${USAGE_EMBED_PATH}?theme=dark`);
	});

	test("inject and parse round-trips", () => {
		const payload = { ...sample(), type: USAGE_EMBED_MESSAGE_TYPE } as const;
		const source = usageEmbedInjectSource(payload);
		expect(source).toContain("__gpioUsagePending");
		const parsed = parseUsageEmbedMessage(
			JSON.parse(JSON.stringify(payload)) as unknown,
		);
		expect(parsed?.calls).toBe(5);
		expect(parsed?.byKind).toHaveLength(2);
		expect(parsed?.daily[1]?.chat).toBe(800);
		expect(parseUsageEmbedMessage({ type: "nope" })).toBeNull();
		expect(
			parseUsageEmbedMessage({ type: USAGE_EMBED_MESSAGE_TYPE }),
		).toBeNull();
	});

	test("builders emit matching series", () => {
		const area = buildUsageAreaOption(sample(), { dark: true });
		expect((area.series as unknown[]).length).toBe(4);
		const board = buildUsageLeaderboardOption(sample(), { dark: false });
		const boardSeries = board.series as { data: unknown[] }[];
		expect(boardSeries[0]?.data.length).toBe(1);
		const voice = buildUsageVoiceOption(sample(), { dark: true });
		expect((voice.series as unknown[]).length).toBe(2);
		expect((voice.graphic as unknown[]).length).toBe(2);
		const empty: UsageChartSummary = {
			days: 30,
			since: "",
			calls: 0,
			micros: 0,
			byKind: [],
			byModel: [],
			daily: [],
		};
		expect(() => buildUsageVoiceOption(empty, { dark: true })).not.toThrow();
	});
});
