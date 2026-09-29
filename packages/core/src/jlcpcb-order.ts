import {
	type ShippingAddress,
	shippingAddressFrom,
} from "./shipping-address.ts";

export type JlcpcbOrderKind = "pcb" | "tdp";

export type JlcpcbOrderDraft = {
	kind: string;
	fileKey?: string;
	orderType?: string;
	layer?: string;
	qty?: string;
	thickness?: string;
	fileAccessId?: string;
	itemCount?: string;
};

export type JlcpcbOrderRequest = {
	confirm: true;
	kind: JlcpcbOrderKind;
	fileKey?: string;
	orderType?: string;
	layer?: string;
	qty?: string;
	thickness?: string;
	fileAccessId?: string;
	itemCount?: string;
};

const KINDS = new Set<JlcpcbOrderKind>(["pcb", "tdp"]);

export function orderConfirmBody(
	configured: boolean,
	address: ShippingAddress | null,
	draft: JlcpcbOrderDraft | null,
	confirmed: boolean,
): JlcpcbOrderRequest | null {
	if (!configured || !shippingAddressFrom(address) || confirmed !== true) {
		return null;
	}
	const fields = draftFields(draft);
	if (!fields) {
		return null;
	}
	return { confirm: true, ...fields };
}

export function orderQuoteBody(
	configured: boolean,
	draft: JlcpcbOrderDraft | null,
): Omit<JlcpcbOrderRequest, "confirm"> | null {
	if (!configured) {
		return null;
	}
	return draftFields(draft);
}

function draftFields(
	draft: JlcpcbOrderDraft | null,
): Omit<JlcpcbOrderRequest, "confirm"> | null {
	if (!draft || !KINDS.has(draft.kind as JlcpcbOrderKind)) {
		return null;
	}
	const kind = draft.kind as JlcpcbOrderKind;
	const next: Omit<JlcpcbOrderRequest, "confirm"> = { kind };
	const fileKey = text(draft.fileKey);
	const orderType = text(draft.orderType);
	const layer = text(draft.layer);
	const qty = text(draft.qty);
	const thickness = text(draft.thickness);
	const fileAccessId = text(draft.fileAccessId);
	const itemCount = text(draft.itemCount);
	if (kind === "pcb") {
		if (fileKey) next.fileKey = fileKey;
		if (orderType) next.orderType = orderType;
		if (layer) next.layer = layer;
		if (qty) next.qty = qty;
		if (thickness) next.thickness = thickness;
	} else {
		if (fileAccessId) next.fileAccessId = fileAccessId;
		if (itemCount) next.itemCount = itemCount;
	}
	return next;
}

function text(value: string | undefined): string {
	return value?.trim() ?? "";
}
