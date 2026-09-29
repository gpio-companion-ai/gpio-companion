import { eq } from "drizzle-orm";
import type { JlcpcbOrderBundle } from "gpio-companion";
import { parseJlcpcbDraft } from "gpio-companion";
import {
	createDashboardDatabase,
	type DashboardDatabase,
} from "./db/client.ts";
import {
	jlcpcbDraftAssemblyLines,
	jlcpcbDraftParts,
	jlcpcbDraftPrints,
	jlcpcbDrafts,
} from "./db/schema.ts";

export const DRAFT_INVALID = "order draft is invalid";
export const DRAFT_STORE_UNAVAILABLE = "jlcpcb draft store unavailable";

type DraftQuery = Pick<DashboardDatabase, "delete" | "insert" | "select">;

export function requireDashboardDatabase(
	database: D1Database | undefined,
): DashboardDatabase {
	if (!database) {
		throw new Error(DRAFT_STORE_UNAVAILABLE);
	}
	return createDashboardDatabase(database);
}

export async function loadJlcpcbDraft(
	db: DraftQuery,
	userId: string,
): Promise<JlcpcbOrderBundle | null> {
	const id = requireUser(userId);
	const [row] = await db
		.select()
		.from(jlcpcbDrafts)
		.where(eq(jlcpcbDrafts.userId, id))
		.limit(1);
	if (!row) {
		return null;
	}
	const [parts, prints, lines] = await Promise.all([
		db
			.select()
			.from(jlcpcbDraftParts)
			.where(eq(jlcpcbDraftParts.userId, id))
			.orderBy(jlcpcbDraftParts.sort),
		db
			.select()
			.from(jlcpcbDraftPrints)
			.where(eq(jlcpcbDraftPrints.userId, id))
			.orderBy(jlcpcbDraftPrints.sort),
		db
			.select()
			.from(jlcpcbDraftAssemblyLines)
			.where(eq(jlcpcbDraftAssemblyLines.userId, id))
			.orderBy(jlcpcbDraftAssemblyLines.sort),
	]);
	const draft: JlcpcbOrderBundle = {
		version: 1,
		repo: row.repo,
		parts: parts.map((part) => {
			const next: JlcpcbOrderBundle["parts"][number] = {
				componentCode: part.componentCode,
				qty: part.qty,
			};
			if (part.name) next.name = part.name;
			if (part.package) next.package = part.package;
			const stock = scalarFrom(part.stock);
			const price = scalarFrom(part.price);
			if (stock !== undefined) next.stock = stock;
			if (price !== undefined) next.price = price;
			return next;
		}),
		prints: prints.map((print) => {
			const next: JlcpcbOrderBundle["prints"][number] = {
				name: print.name,
				file: print.file,
			};
			if (print.fileAccessId) next.fileAccessId = print.fileAccessId;
			if (print.itemCount) next.itemCount = print.itemCount;
			return next;
		}),
		assembly: {
			lines: lines.map((line) => {
				const next: JlcpcbOrderBundle["assembly"]["lines"][number] = {
					componentCode: line.componentCode,
					qty: line.qty,
				};
				if (line.ref) next.ref = line.ref;
				return next;
			}),
		},
		updatedAt: row.updatedAt,
	};
	if (row.assemblyNote) draft.assembly.note = row.assemblyNote;
	const pcb = pcbFrom(row);
	if (pcb) draft.pcb = pcb;
	return parseJlcpcbDraft(draft);
}

export async function saveJlcpcbDraft(
	db: DraftQuery & { batch?: DashboardDatabase["batch"] },
	userId: string,
	body: unknown,
): Promise<JlcpcbOrderBundle> {
	const id = requireUser(userId);
	const draft = draftFrom(body);
	if (!draft) {
		throw new Error(DRAFT_INVALID);
	}
	const stored: JlcpcbOrderBundle = {
		...draft,
		updatedAt: new Date().toISOString(),
	};
	const parent = {
		userId: id,
		repo: stored.repo,
		pcbFile: stored.pcb?.file ?? null,
		pcbFileKey: stored.pcb?.fileKey ?? null,
		pcbLayer: stored.pcb?.layer ?? null,
		pcbQty: stored.pcb?.qty ?? null,
		pcbThickness: stored.pcb?.thickness ?? null,
		pcbOrderType: stored.pcb?.orderType ?? null,
		assemblyNote: stored.assembly.note ?? null,
		updatedAt: stored.updatedAt,
	};
	const parts = stored.parts.map((part, sort) => ({
		userId: id,
		sort,
		componentCode: part.componentCode,
		qty: part.qty,
		name: part.name ?? null,
		package: part.package ?? null,
		stock: part.stock === undefined ? null : String(part.stock),
		price: part.price === undefined ? null : String(part.price),
	}));
	const prints = stored.prints.map((print, sort) => ({
		userId: id,
		sort,
		name: print.name,
		file: print.file,
		fileAccessId: print.fileAccessId ?? null,
		itemCount: print.itemCount ?? null,
	}));
	const lines = stored.assembly.lines.map((line, sort) => ({
		userId: id,
		sort,
		componentCode: line.componentCode,
		qty: line.qty,
		ref: line.ref ?? null,
	}));
	const clear = [
		db.delete(jlcpcbDraftParts).where(eq(jlcpcbDraftParts.userId, id)),
		db.delete(jlcpcbDraftPrints).where(eq(jlcpcbDraftPrints.userId, id)),
		db
			.delete(jlcpcbDraftAssemblyLines)
			.where(eq(jlcpcbDraftAssemblyLines.userId, id)),
		db.delete(jlcpcbDrafts).where(eq(jlcpcbDrafts.userId, id)),
	];
	const insert = [
		db.insert(jlcpcbDrafts).values(parent),
		...(parts.length ? [db.insert(jlcpcbDraftParts).values(parts)] : []),
		...(prints.length ? [db.insert(jlcpcbDraftPrints).values(prints)] : []),
		...(lines.length
			? [db.insert(jlcpcbDraftAssemblyLines).values(lines)]
			: []),
	];
	if (db.batch) {
		await db.batch([...clear, ...insert]);
	} else {
		for (const query of [...clear, ...insert]) {
			await query;
		}
	}
	return stored;
}

export async function handleJlcpcbDraftRead(input: {
	db: DraftQuery;
	userId: string;
}): Promise<{ draft: JlcpcbOrderBundle | null }> {
	return { draft: await loadJlcpcbDraft(input.db, input.userId) };
}

export async function handleJlcpcbDraftSave(input: {
	db: DraftQuery & { batch?: DashboardDatabase["batch"] };
	userId: string;
	body: unknown;
}): Promise<{ draft: JlcpcbOrderBundle }> {
	return {
		draft: await saveJlcpcbDraft(input.db, input.userId, input.body),
	};
}

function pcbFrom(
	row: typeof jlcpcbDrafts.$inferSelect,
): JlcpcbOrderBundle["pcb"] {
	const pcb: NonNullable<JlcpcbOrderBundle["pcb"]> = {};
	if (row.pcbFile) pcb.file = row.pcbFile;
	if (row.pcbFileKey) pcb.fileKey = row.pcbFileKey;
	if (row.pcbLayer) pcb.layer = row.pcbLayer;
	if (row.pcbQty) pcb.qty = row.pcbQty;
	if (row.pcbThickness) pcb.thickness = row.pcbThickness;
	if (row.pcbOrderType) pcb.orderType = row.pcbOrderType;
	return Object.keys(pcb).length ? pcb : undefined;
}

function draftFrom(body: unknown): JlcpcbOrderBundle | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	const record = body as Record<string, unknown>;
	const source =
		record.draft && typeof record.draft === "object" ? record.draft : record;
	return parseJlcpcbDraft(source);
}

function requireUser(userId: string): string {
	const id = userId.trim();
	if (!id || id !== userId) {
		throw new Error("sign in first");
	}
	return id;
}

function scalarFrom(value: string | null): string | number | undefined {
	if (!value) return undefined;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return value;
}
