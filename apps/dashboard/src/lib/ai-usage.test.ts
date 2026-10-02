import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
	getAiUsageSummary,
	parseUsageDays,
	recordAiUsage,
	usageSinceIso,
} from "./ai-usage.ts";
import type { DashboardDatabase } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { aiUsage } from "./db/schema.ts";

function memoryDb(): DashboardDatabase {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON");
	const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");
	for (const file of readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		const migration = readFileSync(join(dir, file), "utf8");
		for (const statement of migration.split("--> statement-breakpoint")) {
			sqlite.exec(statement);
		}
	}
	return drizzle(sqlite, { schema }) as unknown as DashboardDatabase;
}

describe("ai usage history", () => {
	test("parses day windows", () => {
		expect(parseUsageDays(7)).toBe(7);
		expect(parseUsageDays("90")).toBe(90);
		expect(parseUsageDays(14)).toBe(30);
		expect(parseUsageDays("nope")).toBe(30);
		expect(usageSinceIso(7, Date.parse("2026-10-02T00:00:00.000Z"))).toBe(
			"2026-09-25T00:00:00.000Z",
		);
	});

	test("record without a database is a no-op", async () => {
		await recordAiUsage(undefined, {
			userId: "user-1",
			kind: "chat",
			model: "@cf/zai-org/glm-5.3",
			micros: 10,
		});
	});

	test("summarizes by kind, model, and recent calls", async () => {
		const db = memoryDb();
		const now = Date.parse("2026-10-02T12:00:00.000Z");
		await db.insert(aiUsage).values([
			{
				userId: "user-1",
				createdAt: "2026-10-02T10:00:00.000Z",
				kind: "chat",
				model: "@cf/zai-org/glm-5.3",
				promptTokens: 100,
				completionTokens: 50,
				cachedTokens: 10,
				micros: 100,
			},
			{
				userId: "user-1",
				createdAt: "2026-10-02T11:00:00.000Z",
				kind: "chat",
				model: "@cf/zai-org/glm-5.3",
				promptTokens: 200,
				completionTokens: 20,
				micros: 80,
			},
			{
				userId: "user-1",
				createdAt: "2026-10-01T11:00:00.000Z",
				kind: "stt",
				model: "@cf/openai/whisper-large-v3-turbo",
				audioSeconds: 30,
				micros: 5,
			},
			{
				userId: "user-1",
				createdAt: "2026-01-01T00:00:00.000Z",
				kind: "tts",
				model: "@cf/myshell-ai/melotts",
				chars: 900,
				micros: 2,
			},
			{
				userId: "user-2",
				createdAt: "2026-10-02T11:00:00.000Z",
				kind: "chat",
				model: "@cf/zai-org/glm-5.3",
				promptTokens: 999,
				completionTokens: 999,
				micros: 999,
			},
		]);

		const summary = await getAiUsageSummary(db, "user-1", 30, now);
		expect(summary.days).toBe(30);
		expect(summary.calls).toBe(3);
		expect(summary.micros).toBe(185);
		expect(summary.byKind).toHaveLength(2);
		const chat = summary.byKind.find((entry) => entry.kind === "chat");
		expect(chat).toMatchObject({
			calls: 2,
			micros: 180,
			promptTokens: 300,
			completionTokens: 70,
		});
		const models = summary.byModel.map((entry) => entry.model);
		expect(models).toEqual([
			"@cf/zai-org/glm-5.3",
			"@cf/openai/whisper-large-v3-turbo",
		]);
		expect(summary.recent).toHaveLength(3);
		expect(summary.recent[0]?.kind).toBe("stt");
		expect(summary.recent[0]?.model).toBe(
			"@cf/openai/whisper-large-v3-turbo",
		);

		const week = await getAiUsageSummary(db, "user-1", 7, now);
		expect(week.calls).toBe(3);
		const empty = await getAiUsageSummary(db, "user-9", 30, now);
		expect(empty.calls).toBe(0);
		expect(empty.byKind).toEqual([]);
	});
});
