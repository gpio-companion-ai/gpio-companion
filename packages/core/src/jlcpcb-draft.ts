export type JlcpcbDraftPart = {
	componentCode: string;
	qty: number;
	name?: string;
	package?: string;
	stock?: string | number;
	price?: string | number;
};

export type JlcpcbDraftPcb = {
	file?: string;
	fileKey?: string;
	layer?: string;
	qty?: string;
	thickness?: string;
	orderType?: string;
};

export type JlcpcbDraftPrint = {
	name: string;
	file: string;
	fileAccessId?: string;
	itemCount?: string;
};

export type JlcpcbDraftAssemblyLine = {
	componentCode: string;
	qty: number;
	ref?: string;
};

export type JlcpcbOrderBundle = {
	version: 1;
	repo: string;
	parts: JlcpcbDraftPart[];
	pcb?: JlcpcbDraftPcb;
	prints: JlcpcbDraftPrint[];
	assembly: {
		lines: JlcpcbDraftAssemblyLine[];
		note?: string;
	};
	updatedAt: string;
};

const REPO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;
const CODE = /^C\d{1,12}$/i;
const MAX_PARTS = 40;
const MAX_PRINTS = 20;
const MAX_TEXT = 240;

export function parseJlcpcbDraft(value: unknown): JlcpcbOrderBundle | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.version !== 1) {
		return null;
	}
	const repo = text(record.repo);
	if (!repo || !REPO.test(repo) || repo.includes("..")) {
		return null;
	}
	const parts = partsFrom(record.parts);
	const prints = printsFrom(record.prints);
	const assembly = assemblyFrom(record.assembly);
	if (!parts || !prints || !assembly) {
		return null;
	}
	const pcb = pcbFrom(record.pcb);
	if (record.pcb !== undefined && !pcb) {
		return null;
	}
	const updatedAt = text(record.updatedAt) || new Date(0).toISOString();
	const bundle: JlcpcbOrderBundle = {
		version: 1,
		repo,
		parts,
		prints,
		assembly,
		updatedAt,
	};
	if (pcb) {
		bundle.pcb = pcb;
	}
	return bundle;
}

function partsFrom(value: unknown): JlcpcbDraftPart[] | null {
	if (!Array.isArray(value) || value.length > MAX_PARTS) {
		return null;
	}
	const parts: JlcpcbDraftPart[] = [];
	for (const row of value) {
		const part = partFrom(row);
		if (!part) {
			return null;
		}
		parts.push(part);
	}
	return parts;
}

function partFrom(value: unknown): JlcpcbDraftPart | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const componentCode = code(record.componentCode);
	const qty = quantity(record.qty);
	if (!componentCode || qty === null) {
		return null;
	}
	const part: JlcpcbDraftPart = { componentCode, qty };
	const name = text(record.name);
	const pack = text(record.package);
	const stock = scalar(record.stock);
	const price = scalar(record.price);
	if (name) part.name = name;
	if (pack) part.package = pack;
	if (stock !== undefined) part.stock = stock;
	if (price !== undefined) part.price = price;
	return part;
}

function printsFrom(value: unknown): JlcpcbDraftPrint[] | null {
	if (!Array.isArray(value) || value.length > MAX_PRINTS) {
		return null;
	}
	const prints: JlcpcbDraftPrint[] = [];
	for (const row of value) {
		const print = printFrom(row);
		if (!print) {
			return null;
		}
		prints.push(print);
	}
	return prints;
}

function printFrom(value: unknown): JlcpcbDraftPrint | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const name = text(record.name);
	const file = text(record.file);
	if (!name || !file || file.includes("..")) {
		return null;
	}
	const print: JlcpcbDraftPrint = { name, file };
	const fileAccessId = text(record.fileAccessId);
	const itemCount = text(record.itemCount);
	if (fileAccessId) print.fileAccessId = fileAccessId;
	if (itemCount) print.itemCount = itemCount;
	return print;
}

function pcbFrom(value: unknown): JlcpcbDraftPcb | null {
	if (value === undefined) {
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const pcb: JlcpcbDraftPcb = {};
	const file = text(record.file);
	const fileKey = text(record.fileKey);
	const layer = text(record.layer);
	const qty = text(record.qty);
	const thickness = text(record.thickness);
	const orderType = text(record.orderType);
	if (file) {
		if (file.includes("..")) return null;
		pcb.file = file;
	}
	if (fileKey) pcb.fileKey = fileKey;
	if (layer) pcb.layer = layer;
	if (qty) pcb.qty = qty;
	if (thickness) pcb.thickness = thickness;
	if (orderType) pcb.orderType = orderType;
	return pcb;
}

function assemblyFrom(value: unknown): JlcpcbOrderBundle["assembly"] | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.lines) || record.lines.length > MAX_PARTS) {
		return null;
	}
	const lines: JlcpcbDraftAssemblyLine[] = [];
	for (const row of record.lines) {
		if (!row || typeof row !== "object" || Array.isArray(row)) {
			return null;
		}
		const item = row as Record<string, unknown>;
		const componentCode = code(item.componentCode);
		const qty = quantity(item.qty);
		if (!componentCode || qty === null) {
			return null;
		}
		const line: JlcpcbDraftAssemblyLine = { componentCode, qty };
		const ref = text(item.ref);
		if (ref) line.ref = ref;
		lines.push(line);
	}
	const assembly: JlcpcbOrderBundle["assembly"] = { lines };
	const note = text(record.note);
	if (note) assembly.note = note;
	return assembly;
}

function code(value: unknown): string | null {
	const next = text(value);
	if (!next || !CODE.test(next)) {
		return null;
	}
	return `C${next.slice(1)}`;
}

function quantity(value: unknown): number | null {
	const qty =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
		return null;
	}
	return qty;
}

function text(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	const next = value.trim();
	return next.length > MAX_TEXT ? "" : next;
}

function scalar(value: unknown): string | number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	const next = text(value);
	return next || undefined;
}
