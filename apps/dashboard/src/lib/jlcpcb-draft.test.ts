import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { DashboardDatabase } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { loadJlcpcbDraft, saveJlcpcbDraft } from "./jlcpcb-draft.ts";

function memoryDb(): DashboardDatabase {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON");
	const migration = sqlText();
	for (const statement of migration.split("--> statement-breakpoint")) {
		sqlite.exec(statement);
	}
	return drizzle(sqlite, { schema }) as unknown as DashboardDatabase;
}

function sqlText(): string {
	const path = new URL("../../drizzle/0000_groovy_spirit.sql", import.meta.url);
	return readFileSync(path, "utf8");
}

describe("jlcpcb draft store", () => {
	test("replaces one user draft in sqlite", async () => {
		const db = memoryDb();
		const saved = await saveJlcpcbDraft(db, "user-1", {
			version: 1,
			repo: "ada/blink",
			parts: [{ componentCode: "C2040", qty: 2, name: "10k", stock: 4 }],
			pcb: { file: "pcb/board.zip" },
			prints: [{ name: "clip", file: "model/clip.stl" }],
			assembly: {
				lines: [{ componentCode: "C2040", qty: 2, ref: "R1" }],
				note: "hand place",
			},
			updatedAt: "2026-09-29T00:00:00.000Z",
		});
		const loaded = await loadJlcpcbDraft(db, "user-1");
		expect(loaded?.repo).toBe("ada/blink");
		expect(loaded?.parts).toEqual([
			{ componentCode: "C2040", qty: 2, name: "10k", stock: 4 },
		]);
		expect(loaded?.prints).toEqual([{ name: "clip", file: "model/clip.stl" }]);
		expect(loaded?.assembly.lines).toEqual([
			{ componentCode: "C2040", qty: 2, ref: "R1" },
		]);
		expect(loaded?.assembly.note).toBe("hand place");
		expect(loaded?.pcb).toEqual({ file: "pcb/board.zip" });
		expect(loaded?.updatedAt).toBe(saved.updatedAt);
		expect(await loadJlcpcbDraft(db, "user-2")).toBeNull();
	});
});
