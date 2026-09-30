import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const opencodePrompts = sqliteTable(
	"opencode_prompts",
	{
		id: text("id").primaryKey(),
		repo: text("repo").notNull(),
		sessionId: text("session_id").notNull(),
		kind: text("kind").notNull(),
		body: text("body").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("opencode_prompts_repo_session").on(table.repo, table.sessionId),
		check(
			"opencode_prompts_kind_check",
			sql`${table.kind} in ('question', 'permission')`,
		),
		check("opencode_prompts_repo_check", sql`length(${table.repo}) > 0`),
		check(
			"opencode_prompts_session_check",
			sql`length(${table.sessionId}) > 0`,
		),
	],
);
