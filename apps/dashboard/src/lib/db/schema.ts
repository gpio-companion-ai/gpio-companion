import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
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
