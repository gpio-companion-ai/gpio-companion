import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { opencodePromptWrite } from "gpio-companion";
import migrationSql from "../drizzle/0000_gifted_pride.sql" with {
	type: "text",
};
import { opencodePrompts } from "./db/schema.ts";

export const DEFAULT_OPENCODE_DB_PATH = "/etc/gpio-companion/opencode.sqlite";

const MIGRATION_ID = "0000_gifted_pride";

export type PromptKind = "question" | "permission";

export type PromptStore = {
	save(repo: string, event: unknown): void;
	drop(id: string): void;
	sync(repo: string, kind: PromptKind, value: unknown): void;
	list(repo: string, kind: PromptKind): unknown[];
	close(): void;
};

export function opencodePromptDbPath(): string {
	return process.env.GPIO_COMPANION_DB?.trim() || DEFAULT_OPENCODE_DB_PATH;
}

export function openPromptStore(path: string): PromptStore {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new Database(path);
	sqlite.exec("PRAGMA journal_mode = WAL");
	applyMigration(sqlite);
	const db = drizzle(sqlite, { schema: { opencodePrompts } });
	return {
		save(repo, event) {
			const write = opencodePromptWrite(event);
			if (!write || !repo.trim()) {
				return;
			}
			if (write.op === "drop") {
				db.delete(opencodePrompts)
					.where(eq(opencodePrompts.id, write.id))
					.run();
				return;
			}
			db.insert(opencodePrompts)
				.values({
					id: write.id,
					repo,
					sessionId: write.sessionID,
					kind: write.kind,
					body: JSON.stringify(write.body),
					updatedAt: Date.now(),
				})
				.onConflictDoUpdate({
					target: opencodePrompts.id,
					set: {
						repo,
						sessionId: write.sessionID,
						kind: write.kind,
						body: JSON.stringify(write.body),
						updatedAt: Date.now(),
					},
				})
				.run();
		},
		drop(id) {
			if (!id) {
				return;
			}
			db.delete(opencodePrompts).where(eq(opencodePrompts.id, id)).run();
		},
		sync(repo, kind, value) {
			if (!repo.trim()) {
				return;
			}
			for (const record of promptRecords(value)) {
				db.insert(opencodePrompts)
					.values({
						id: String(record.id),
						repo,
						sessionId: String(record.sessionID),
						kind,
						body: JSON.stringify(record),
						updatedAt: Date.now(),
					})
					.onConflictDoUpdate({
						target: opencodePrompts.id,
						set: {
							repo,
							sessionId: String(record.sessionID),
							kind,
							body: JSON.stringify(record),
							updatedAt: Date.now(),
						},
					})
					.run();
			}
		},
		list(repo, kind) {
			return db
				.select()
				.from(opencodePrompts)
				.where(eq(opencodePrompts.repo, repo))
				.all()
				.flatMap((row) => {
					if (row.kind !== kind) {
						return [];
					}
					try {
						return [JSON.parse(row.body) as unknown];
					} catch {
						return [];
					}
				});
		},
		close() {
			sqlite.close();
		},
	};
}

export function promptListKind(
	path: string,
	method: string,
): PromptKind | null {
	if (method !== "GET") {
		return null;
	}
	if (path === "/v1/opencode/question") {
		return "question";
	}
	if (path === "/v1/opencode/permission") {
		return "permission";
	}
	return null;
}

export function promptDropId(path: string, method: string): string | null {
	if (method !== "POST") {
		return null;
	}
	const question =
		/^\/v1\/opencode\/question\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/(?:reply|reject)$/.exec(
			path,
		);
	if (question?.[1]) {
		return question[1];
	}
	const permission =
		/^\/v1\/opencode\/session\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/permissions\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(
			path,
		);
	return permission?.[1] ?? null;
}

function applyMigration(sqlite: Database): void {
	sqlite.exec(
		"CREATE TABLE IF NOT EXISTS __gpio_migration (id text primary key)",
	);
	const applied = sqlite
		.query("SELECT id FROM __gpio_migration WHERE id = ?")
		.get(MIGRATION_ID);
	if (applied) {
		return;
	}
	const apply = sqlite.transaction(() => {
		for (const statement of migrationSql.split("--> statement-breakpoint")) {
			const sqlText = statement.trim();
			if (sqlText) {
				sqlite.exec(sqlText);
			}
		}
		sqlite
			.query("INSERT INTO __gpio_migration (id) VALUES (?)")
			.run(MIGRATION_ID);
	});
	apply();
}

function promptRecords(value: unknown): Record<string, unknown>[] {
	const list = Array.isArray(value)
		? value
		: value &&
				typeof value === "object" &&
				Array.isArray((value as { data?: unknown }).data)
			? (value as { data: unknown[] }).data
			: [];
	const records: Record<string, unknown>[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (typeof record.id !== "string" || typeof record.sessionID !== "string") {
			continue;
		}
		records.push(record);
	}
	return records;
}
