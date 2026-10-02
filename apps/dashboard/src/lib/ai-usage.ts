import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
	createDashboardDatabase,
	type DashboardDatabase,
} from "./db/client.ts";
import { type AiUsageKind, aiUsage } from "./db/schema.ts";

export type { AiUsageKind };

export const USAGE_DAY_OPTIONS = [7, 30, 90] as const;
export const DEFAULT_USAGE_DAYS = 30;
const MAX_RECENT_ROWS = 100;

export type AiUsageInsert = {
	userId: string;
	kind: AiUsageKind;
	model: string;
	promptTokens?: number;
	completionTokens?: number;
	cachedTokens?: number;
	audioSeconds?: number;
	chars?: number;
	micros: number;
	createdAt?: string;
};

type UsageQuery = Pick<DashboardDatabase, "insert" | "select">;

/** Best-effort insert: usage history must never break the billing path. */
export async function recordAiUsage(
	database: D1Database | undefined,
	record: AiUsageInsert,
): Promise<void> {
	if (!database) {
		return;
	}
	try {
		await createDashboardDatabase(database)
			.insert(aiUsage)
			.values({
				userId: record.userId,
				createdAt: record.createdAt ?? new Date().toISOString(),
				kind: record.kind,
				model: record.model.trim() || "unknown",
				promptTokens: Math.max(0, Math.floor(record.promptTokens ?? 0)),
				completionTokens: Math.max(0, Math.floor(record.completionTokens ?? 0)),
				cachedTokens: Math.max(0, Math.floor(record.cachedTokens ?? 0)),
				audioSeconds:
					record.audioSeconds == null || !Number.isFinite(record.audioSeconds)
						? null
						: Math.max(0, record.audioSeconds),
				chars:
					record.chars == null || !Number.isFinite(record.chars)
						? null
						: Math.max(0, Math.floor(record.chars)),
				micros: Math.max(0, Math.floor(record.micros)),
			});
	} catch {
		// usage history is advisory; billing already succeeded
	}
}

export function parseUsageDays(value: unknown): number {
	const days = Number(value);
	if (
		Number.isInteger(days) &&
		(USAGE_DAY_OPTIONS as readonly number[]).includes(days)
	) {
		return days;
	}
	return DEFAULT_USAGE_DAYS;
}

export function usageSinceIso(days: number, now = Date.now()): string {
	return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

export type AiUsageByKind = {
	kind: AiUsageKind;
	calls: number;
	micros: number;
	promptTokens: number;
	completionTokens: number;
	audioSeconds: number;
	chars: number;
};

export type AiUsageByModel = {
	model: string;
	kind: AiUsageKind;
	calls: number;
	micros: number;
	promptTokens: number;
	completionTokens: number;
};

export type AiUsageRecent = {
	createdAt: string;
	kind: AiUsageKind;
	model: string;
	promptTokens: number;
	completionTokens: number;
	audioSeconds: number | null;
	chars: number | null;
	micros: number;
};

export type AiUsageDaily = {
	date: string;
	chat: number;
	embedding: number;
	stt: number;
	tts: number;
};

export type AiUsageSummary = {
	days: number;
	since: string;
	calls: number;
	micros: number;
	byKind: AiUsageByKind[];
	byModel: AiUsageByModel[];
	recent: AiUsageRecent[];
	daily: AiUsageDaily[];
};

function toSummaryRow(row: {
	calls?: number | null;
	micros?: number | null;
	promptTokens?: number | null;
	completionTokens?: number | null;
}): {
	calls: number;
	micros: number;
	promptTokens: number;
	completionTokens: number;
} {
	return {
		calls: Number(row.calls ?? 0),
		micros: Number(row.micros ?? 0),
		promptTokens: Number(row.promptTokens ?? 0),
		completionTokens: Number(row.completionTokens ?? 0),
	};
}

export async function getAiUsageSummary(
	db: UsageQuery,
	userId: string,
	days: number,
	now = Date.now(),
): Promise<AiUsageSummary> {
	const id = userId.trim();
	if (!id) {
		throw new Error("sign in first");
	}
	const windowDays = parseUsageDays(days);
	const since = usageSinceIso(windowDays, now);
	const scope = and(eq(aiUsage.userId, id), gte(aiUsage.createdAt, since));

	const [totals, kinds, models, recent, dayRows] = await Promise.all([
		db
			.select({
				calls: sql<number | null>`count(*)`,
				micros: sql<number | null>`coalesce(sum(${aiUsage.micros}), 0)`,
				promptTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.promptTokens}), 0)`,
				completionTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.completionTokens}), 0)`,
			})
			.from(aiUsage)
			.where(scope),
		db
			.select({
				kind: aiUsage.kind,
				calls: sql<number | null>`count(*)`,
				micros: sql<number | null>`coalesce(sum(${aiUsage.micros}), 0)`,
				promptTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.promptTokens}), 0)`,
				completionTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.completionTokens}), 0)`,
				audioSeconds: sql<
					number | null
				>`coalesce(sum(${aiUsage.audioSeconds}), 0)`,
				chars: sql<number | null>`coalesce(sum(${aiUsage.chars}), 0)`,
			})
			.from(aiUsage)
			.where(scope)
			.groupBy(aiUsage.kind),
		db
			.select({
				model: aiUsage.model,
				kind: aiUsage.kind,
				calls: sql<number | null>`count(*)`,
				micros: sql<number | null>`coalesce(sum(${aiUsage.micros}), 0)`,
				promptTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.promptTokens}), 0)`,
				completionTokens: sql<
					number | null
				>`coalesce(sum(${aiUsage.completionTokens}), 0)`,
			})
			.from(aiUsage)
			.where(scope)
			.groupBy(aiUsage.model, aiUsage.kind)
			.orderBy(sql`coalesce(sum(${aiUsage.micros}), 0) desc`),
		db
			.select({
				createdAt: aiUsage.createdAt,
				kind: aiUsage.kind,
				model: aiUsage.model,
				promptTokens: aiUsage.promptTokens,
				completionTokens: aiUsage.completionTokens,
				audioSeconds: aiUsage.audioSeconds,
				chars: aiUsage.chars,
				micros: aiUsage.micros,
			})
			.from(aiUsage)
			.where(scope)
			.orderBy(desc(aiUsage.id))
			.limit(MAX_RECENT_ROWS),
		db
			.select({
				date: sql<string>`substr(${aiUsage.createdAt}, 1, 10)`,
				chat: sql<
					number | null
				>`coalesce(sum(case when ${aiUsage.kind} = 'chat' then ${aiUsage.micros} else 0 end), 0)`,
				embedding: sql<
					number | null
				>`coalesce(sum(case when ${aiUsage.kind} = 'embedding' then ${aiUsage.micros} else 0 end), 0)`,
				stt: sql<
					number | null
				>`coalesce(sum(case when ${aiUsage.kind} = 'stt' then ${aiUsage.micros} else 0 end), 0)`,
				tts: sql<
					number | null
				>`coalesce(sum(case when ${aiUsage.kind} = 'tts' then ${aiUsage.micros} else 0 end), 0)`,
			})
			.from(aiUsage)
			.where(scope)
			.groupBy(sql`substr(${aiUsage.createdAt}, 1, 10)`),
	]);
	const total = toSummaryRow(totals[0] ?? {});
	return {
		days: windowDays,
		since,
		calls: total.calls,
		micros: total.micros,
		byKind: kinds.map((row) => ({
			kind: row.kind as AiUsageKind,
			...toSummaryRow(row),
			audioSeconds: Number(row.audioSeconds ?? 0),
			chars: Number(row.chars ?? 0),
		})),
		byModel: models.map((row) => ({
			model: row.model,
			kind: row.kind as AiUsageKind,
			...toSummaryRow(row),
		})),
		recent: recent.map((row) => ({
			createdAt: row.createdAt,
			kind: row.kind as AiUsageKind,
			model: row.model,
			promptTokens: Number(row.promptTokens ?? 0),
			completionTokens: Number(row.completionTokens ?? 0),
			audioSeconds: row.audioSeconds,
			chars: row.chars,
			micros: Number(row.micros ?? 0),
		})),
		daily: fillDaily(windowDays, since, now, dayRows),
	};
}

function toDayIso(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function fillDaily(
	windowDays: number,
	since: string,
	now: number,
	rows: {
		date: string;
		chat: number | null;
		embedding: number | null;
		stt: number | null;
		tts: number | null;
	}[],
): AiUsageDaily[] {
	const byDate = new Map(
		rows.map((row) => [
			row.date,
			{
				chat: Number(row.chat ?? 0),
				embedding: Number(row.embedding ?? 0),
				stt: Number(row.stt ?? 0),
				tts: Number(row.tts ?? 0),
			},
		]),
	);
	const startDay = toDayIso(Date.parse(since));
	const endDay = toDayIso(now);
	const out: AiUsageDaily[] = [];
	for (
		let day = startDay;
		day <= endDay;
		day = toDayIso(Date.parse(day) + 86_400_000)
	) {
		const entry = byDate.get(day) ?? { chat: 0, embedding: 0, stt: 0, tts: 0 };
		out.push({ date: day, ...entry });
		if (out.length > windowDays + 1) {
			break;
		}
	}
	return out;
}
