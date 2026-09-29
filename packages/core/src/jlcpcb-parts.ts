export {
	type JlcpcbDraftAssemblyLine,
	type JlcpcbDraftPart,
	type JlcpcbDraftPcb,
	type JlcpcbDraftPrint,
	type JlcpcbOrderBundle,
	parseJlcpcbDraft,
} from "./jlcpcb-draft.ts";
export {
	type JlcpcbOrderDraft,
	type JlcpcbOrderKind,
	type JlcpcbOrderRequest,
	orderConfirmBody,
	orderQuoteBody,
} from "./jlcpcb-order.ts";
export {
	formatShippingAddress,
	type ShippingAddress,
	shippingAddressFrom,
	validateShippingAddress,
} from "./shipping-address.ts";

export type JlcpcbPartView = {
	componentCode: string;
	name?: string;
	package?: string;
	stock?: string | number;
	price?: string | number;
};

const LCSC_CODE = /^C\d{1,12}$/i;
const MAX_QUERY = 80;

export function partsQueryKind(query: string): "codes" | "keyword" | null {
	const trimmed = query.trim();
	if (!trimmed || trimmed.length > MAX_QUERY) {
		return null;
	}
	const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
	if (tokens.length === 0) {
		return null;
	}
	if (tokens.every((token) => LCSC_CODE.test(token))) {
		return "codes";
	}
	return "keyword";
}

export function partsSearchBody(
	configured: boolean,
	query: string,
): { query: string } | null {
	const kind = partsQueryKind(query);
	if (!kind) {
		return null;
	}
	if (kind === "codes" && !configured) {
		return null;
	}
	return { query: query.trim() };
}

export function partsFromSearch(data: unknown): JlcpcbPartView[] {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return [];
	}
	const parts = (data as { parts?: unknown }).parts;
	if (!Array.isArray(parts)) {
		return [];
	}
	const next: JlcpcbPartView[] = [];
	for (const row of parts) {
		const part = partFrom(row);
		if (part) {
			next.push(part);
		}
	}
	return next;
}

function partFrom(value: unknown): JlcpcbPartView | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (
		typeof record.componentCode !== "string" ||
		!record.componentCode.trim()
	) {
		return null;
	}
	const part: JlcpcbPartView = { componentCode: record.componentCode.trim() };
	const name = text(record.name);
	const pack = text(record.package);
	const stock = scalar(record.stock);
	const price = scalar(record.price);
	if (name) {
		part.name = name;
	}
	if (pack) {
		part.package = pack;
	}
	if (stock !== undefined) {
		part.stock = stock;
	}
	if (price !== undefined) {
		part.price = price;
	}
	return part;
}

function text(value: unknown): string | undefined {
	const next = scalar(value);
	return typeof next === "string" ? next : undefined;
}

function scalar(value: unknown): string | number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	return undefined;
}
