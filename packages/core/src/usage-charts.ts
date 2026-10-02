import { formatUsd } from "./ai-pricing.ts";

export const USAGE_EMBED_MESSAGE_TYPE = "gpio-usage";
export const USAGE_EMBED_READY_TYPE = "gpio-usage-ready";
export const USAGE_EMBED_BRIDGE_KEY = "__gpioUsageEmbed";
export const USAGE_EMBED_PENDING_KEY = "__gpioUsagePending";
export const USAGE_EMBED_PATH = "/embed/usage";

export type UsageChartKind = "chat" | "embedding" | "stt" | "tts";

export const USAGE_CHART_KINDS: readonly UsageChartKind[] = [
	"chat",
	"embedding",
	"stt",
	"tts",
];

export type UsageChartByKind = {
	kind: UsageChartKind;
	calls: number;
	micros: number;
	promptTokens: number;
	completionTokens: number;
	audioSeconds: number;
	chars: number;
};

export type UsageChartByModel = {
	model: string;
	kind: UsageChartKind;
	calls: number;
	micros: number;
	promptTokens: number;
	completionTokens: number;
};

export type UsageChartDaily = {
	date: string;
	chat: number;
	embedding: number;
	stt: number;
	tts: number;
};

export type UsageChartSummary = {
	days: number;
	since: string;
	calls: number;
	micros: number;
	byKind: UsageChartByKind[];
	byModel: UsageChartByModel[];
	daily: UsageChartDaily[];
};

export type UsageEmbedPayload = UsageChartSummary & {
	type: typeof USAGE_EMBED_MESSAGE_TYPE;
};

export function usageEmbedUrl(
	origin: string,
	opts?: { locale?: string; theme?: string },
): string {
	const base = origin.replace(/\/+$/, "");
	const url = new URL(`${base}${USAGE_EMBED_PATH}`);
	if (opts?.locale === "en" || opts?.locale === "fr") {
		url.searchParams.set("locale", opts.locale);
	}
	if (opts?.theme === "dark" || opts?.theme === "light") {
		url.searchParams.set("theme", opts.theme);
	}
	return url.toString();
}

export function usageEmbedInjectSource(payload: UsageEmbedPayload): string {
	const json = JSON.stringify(payload).replace(/</g, "\\u003c");
	return `window.${USAGE_EMBED_PENDING_KEY}=${json};if(window.${USAGE_EMBED_BRIDGE_KEY}){window.${USAGE_EMBED_BRIDGE_KEY}(window.${USAGE_EMBED_PENDING_KEY});}true;`;
}

export function parseUsageEmbedMessage(
	data: unknown,
): UsageEmbedPayload | null {
	const record = asRecord(data);
	if (!record || record.type !== USAGE_EMBED_MESSAGE_TYPE) {
		return null;
	}
	const byKind = asByKindList(record.byKind);
	const byModel = asByModelList(record.byModel);
	const daily = asDailyList(record.daily);
	if (!byKind || !byModel || !daily) {
		return null;
	}
	return {
		type: USAGE_EMBED_MESSAGE_TYPE,
		days: asNumber(record.days, 30),
		since: typeof record.since === "string" ? record.since : "",
		calls: asNumber(record.calls, 0),
		micros: asNumber(record.micros, 0),
		byKind,
		byModel,
		daily,
	};
}

/** "@cf/zai-org/glm-5.3" -> "glm-5.3"; "xai-tts" stays as-is. */
export function usageModelShort(id: string): string {
	const trimmed = id.trim();
	if (!trimmed) {
		return "unknown";
	}
	const parts = trimmed.split("/");
	return parts[parts.length - 1] || trimmed;
}

export function usageKindMicros(
	summary: UsageChartSummary,
	kind: UsageChartKind,
): number {
	return summary.byKind.find((entry) => entry.kind === kind)?.micros ?? 0;
}

export type UsageChartTheme = { dark: boolean };

type Palette = {
	text: string;
	muted: string;
	grid: string;
	track: string;
	kind: Record<UsageChartKind, string>;
	tooltipBg: string;
	tooltipBorder: string;
};

const DARK: Palette = {
	text: "#cbd5e1",
	muted: "#7c8db0",
	grid: "#1a2745",
	track: "#1c2a4d",
	kind: {
		chat: "#38bdf8",
		embedding: "#a78bfa",
		stt: "#34d399",
		tts: "#fbbf24",
	},
	tooltipBg: "#111c33",
	tooltipBorder: "#1e2d4d",
};

const LIGHT: Palette = {
	text: "#1a2233",
	muted: "#6b7689",
	grid: "#e5e8ee",
	track: "#e5e8ee",
	kind: {
		chat: "#2563eb",
		embedding: "#7c3aed",
		stt: "#059669",
		tts: "#d97706",
	},
	tooltipBg: "#ffffff",
	tooltipBorder: "#e5e8ee",
};

function palette(theme: UsageChartTheme): Palette {
	return theme.dark ? DARK : LIGHT;
}

function dayLabel(iso: string): string {
	return iso.length >= 10 ? iso.slice(5, 10).replace("-", "/") : iso;
}

/** V6 hero: cumulative daily spend stacked by kind (values in micros). */
export function buildUsageAreaOption(
	summary: UsageChartSummary,
	theme: UsageChartTheme = { dark: true },
): Record<string, unknown> {
	const pal = palette(theme);
	return {
		textStyle: { color: pal.text },
		tooltip: {
			trigger: "axis",
			backgroundColor: pal.tooltipBg,
			borderColor: pal.tooltipBorder,
			textStyle: { color: pal.text },
		},
		legend: { textStyle: { color: pal.muted } },
		grid: { left: 56, right: 16, top: 36, bottom: 28 },
		xAxis: {
			type: "category",
			boundaryGap: false,
			data: summary.daily.map((row) => dayLabel(row.date)),
			axisLabel: { color: pal.muted, interval: "auto" },
		},
		yAxis: {
			type: "value",
			splitLine: { lineStyle: { color: pal.grid } },
		},
		series: USAGE_CHART_KINDS.map((kind) => ({
			name: kind,
			type: "line",
			stack: "spend",
			smooth: true,
			symbol: "none",
			data: summary.daily.map((row) => row[kind]),
			itemStyle: { color: pal.kind[kind] },
			areaStyle: { opacity: theme.dark ? 0.5 : 0.25, color: pal.kind[kind] },
		})),
	};
}

/** V6 leaderboard: horizontal cost bars per model, colored by kind. */
export function buildUsageLeaderboardOption(
	summary: UsageChartSummary,
	theme: UsageChartTheme = { dark: true },
): Record<string, unknown> {
	const pal = palette(theme);
	const rows = [...summary.byModel].sort((a, b) => b.micros - a.micros);
	return {
		textStyle: { color: pal.text },
		tooltip: {
			trigger: "item",
			backgroundColor: pal.tooltipBg,
			borderColor: pal.tooltipBorder,
			textStyle: { color: pal.text },
			formatter: (params: { dataIndex: number }) => {
				const row = rows[params.dataIndex];
				if (!row) {
					return "";
				}
				return `${row.model}<br>${row.kind} · ${row.calls} calls · ${formatUsd(row.micros)}`;
			},
		},
		grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
		xAxis: {
			type: "value",
			splitLine: { lineStyle: { color: pal.grid } },
		},
		yAxis: {
			type: "category",
			inverse: true,
			data: rows.map((row) => usageModelShort(row.model)),
			axisLabel: { color: pal.muted },
		},
		series: [
			{
				type: "bar",
				data: rows.map((row) => ({
					value: row.micros,
					itemStyle: {
						color: pal.kind[row.kind],
						borderRadius: [0, 6, 6, 0],
					},
				})),
				label: {
					show: true,
					position: "right",
					color: pal.muted,
					formatter: (params: { dataIndex: number }) => {
						const row = rows[params.dataIndex];
						return row ? `${formatUsd(row.micros)} · ${row.calls} calls` : "";
					},
				},
			},
		],
	};
}

/** V6 voice rings: STT minutes and TTS chars as spend-share progress rings. */
export function buildUsageVoiceOption(
	summary: UsageChartSummary,
	theme: UsageChartTheme = { dark: true },
): Record<string, unknown> {
	const pal = palette(theme);
	const stt = summary.byKind.find((entry) => entry.kind === "stt");
	const tts = summary.byKind.find((entry) => entry.kind === "tts");
	const sttMicros = stt?.micros ?? 0;
	const ttsMicros = tts?.micros ?? 0;
	const voiceTotal = sttMicros + ttsMicros;
	const sttMinutes = (stt?.audioSeconds ?? 0) / 60;
	const ttsChars = tts?.chars ?? 0;
	function ring(
		name: string,
		value: number,
		color: string,
		center: [string, string],
	) {
		return {
			name,
			type: "pie",
			radius: ["58%", "76%"],
			center,
			label: { show: false },
			emphasis: { scale: false },
			data: [
				{ value: Math.max(value, 0.0001), name, itemStyle: { color } },
				{
					value: Math.max(voiceTotal - value, 0),
					name: "rest",
					itemStyle: { color: pal.track },
				},
			],
		};
	}
	return {
		textStyle: { color: pal.text },
		tooltip: {
			backgroundColor: pal.tooltipBg,
			borderColor: pal.tooltipBorder,
			textStyle: { color: pal.text },
			formatter: (params: { name: string; value: number }) =>
				params.name === "rest"
					? ""
					: `${params.name}: ${formatUsd(params.value)}`,
		},
		legend: { bottom: 0, textStyle: { color: pal.muted } },
		series: [
			ring("stt", sttMicros, pal.kind.stt, ["27%", "42%"]),
			ring("tts", ttsMicros, pal.kind.tts, ["73%", "42%"]),
		],
		graphic: [
			{
				type: "text",
				left: "27%",
				top: "36%",
				style: {
					text: `${sttMinutes.toFixed(1)} min\nSTT · ${formatUsd(sttMicros)}`,
					textAlign: "center",
					fill: pal.text,
					fontSize: 12,
				},
			},
			{
				type: "text",
				left: "73%",
				top: "36%",
				style: {
					text: `${formatCompact(ttsChars)} chars\nTTS · ${formatUsd(ttsMicros)}`,
					textAlign: "center",
					fill: pal.text,
					fontSize: 12,
				},
			},
		],
	};
}

function formatCompact(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}K`;
	}
	return String(Math.round(value));
}

function asRecord(data: unknown): Record<string, unknown> | null {
	if (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			return null;
		}
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return null;
	}
	return data as Record<string, unknown>;
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asKind(value: unknown): UsageChartKind | null {
	return value === "chat" ||
		value === "embedding" ||
		value === "stt" ||
		value === "tts"
		? value
		: null;
}

function asByKindList(value: unknown): UsageChartByKind[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const items: UsageChartByKind[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const kind = asKind(record.kind);
		if (!kind) {
			continue;
		}
		items.push({
			kind,
			calls: asNumber(record.calls, 0),
			micros: asNumber(record.micros, 0),
			promptTokens: asNumber(record.promptTokens, 0),
			completionTokens: asNumber(record.completionTokens, 0),
			audioSeconds: asNumber(record.audioSeconds, 0),
			chars: asNumber(record.chars, 0),
		});
	}
	return items;
}

function asByModelList(value: unknown): UsageChartByModel[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const items: UsageChartByModel[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const kind = asKind(record.kind);
		if (!kind || typeof record.model !== "string") {
			continue;
		}
		items.push({
			model: record.model,
			kind,
			calls: asNumber(record.calls, 0),
			micros: asNumber(record.micros, 0),
			promptTokens: asNumber(record.promptTokens, 0),
			completionTokens: asNumber(record.completionTokens, 0),
		});
	}
	return items;
}

function asDailyList(value: unknown): UsageChartDaily[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const items: UsageChartDaily[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.date !== "string") {
			continue;
		}
		items.push({
			date: record.date,
			chat: asNumber(record.chat, 0),
			embedding: asNumber(record.embedding, 0),
			stt: asNumber(record.stt, 0),
			tts: asNumber(record.tts, 0),
		});
	}
	return items;
}
