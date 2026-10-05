import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const jlcpcbDrafts = sqliteTable(
	"jlcpcb_drafts",
	{
		userId: text("user_id").primaryKey(),
		repo: text("repo").notNull(),
		pcbFile: text("pcb_file"),
		pcbFileKey: text("pcb_file_key"),
		pcbLayer: text("pcb_layer"),
		pcbQty: text("pcb_qty"),
		pcbThickness: text("pcb_thickness"),
		pcbOrderType: text("pcb_order_type"),
		assemblyNote: text("assembly_note"),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		check("jlcpcb_drafts_repo_check", sql`length(${table.repo}) > 0`),
	],
);

export const jlcpcbDraftParts = sqliteTable(
	"jlcpcb_draft_parts",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => jlcpcbDrafts.userId, { onDelete: "cascade" }),
		sort: integer("sort").notNull(),
		componentCode: text("component_code").notNull(),
		qty: integer("qty").notNull(),
		name: text("name"),
		package: text("package"),
		stock: text("stock"),
		price: text("price"),
	},
	(table) => [
		index("jlcpcb_draft_parts_user_idx").on(table.userId, table.sort),
		check("jlcpcb_draft_parts_qty_check", sql`${table.qty} >= 1`),
	],
);

export const jlcpcbDraftPrints = sqliteTable(
	"jlcpcb_draft_prints",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => jlcpcbDrafts.userId, { onDelete: "cascade" }),
		sort: integer("sort").notNull(),
		name: text("name").notNull(),
		file: text("file").notNull(),
		fileAccessId: text("file_access_id"),
		itemCount: text("item_count"),
	},
	(table) => [
		index("jlcpcb_draft_prints_user_idx").on(table.userId, table.sort),
	],
);

export const aiUsage = sqliteTable(
	"ai_usage",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id").notNull(),
		createdAt: text("created_at").notNull(),
		kind: text("kind").notNull(),
		model: text("model").notNull(),
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		cachedTokens: integer("cached_tokens").notNull().default(0),
		audioSeconds: real("audio_seconds"),
		chars: integer("chars"),
		micros: integer("micros").notNull(),
	},
	(table) => [
		index("ai_usage_user_created_idx").on(table.userId, table.createdAt),
		index("ai_usage_user_model_idx").on(table.userId, table.model),
		check("ai_usage_micros_check", sql`${table.micros} >= 0`),
		check(
			"ai_usage_kind_check",
			sql`${table.kind} in ('chat', 'embedding', 'stt', 'tts')`,
		),
	],
);

export type AiUsageKind = "chat" | "embedding" | "stt" | "tts";

export const supportReports = sqliteTable(
	"support_reports",
	{
		reportId: text("report_id").primaryKey(),
		userId: text("user_id").notNull(),
		createdAt: text("created_at").notNull(),
		surface: text("surface").notNull(),
		board: text("board").notNull().default(""),
		subject: text("subject").notNull(),
		bodyText: text("body_text").notNull(),
		bodyHtml: text("body_html").notNull(),
		summaryJson: text("summary_json").notNull(),
		emailedAt: text("emailed_at"),
	},
	(table) => [
		index("support_reports_created_idx").on(table.createdAt),
		check(
			"support_reports_surface_check",
			sql`${table.surface} in ('web', 'desktop', 'mobile')`,
		),
	],
);

export const jlcpcbDraftAssemblyLines = sqliteTable(
	"jlcpcb_draft_assembly_lines",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => jlcpcbDrafts.userId, { onDelete: "cascade" }),
		sort: integer("sort").notNull(),
		componentCode: text("component_code").notNull(),
		qty: integer("qty").notNull(),
		ref: text("ref"),
	},
	(table) => [
		index("jlcpcb_draft_assembly_user_idx").on(table.userId, table.sort),
		check("jlcpcb_draft_assembly_qty_check", sql`${table.qty} >= 1`),
	],
);
