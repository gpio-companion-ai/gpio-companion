import { JLCPCBClient } from "@community-jlcpcb/client";
import { partsQueryKind, type ShippingAddress } from "gpio-companion";
import { errorStatus, jsonFail, jsonOk } from "./mobile-http.ts";

export const JLCPCB_CREDENTIALS_REQUIRED = "jlcpcb credentials required";
export const JLCPCB_CODE_REQUIRED = "component code is required";
export const JLCPCB_CODE_INVALID = "component code is invalid";
export const JLCPCB_REQUEST_FAILED = "jlcpcb request failed";
export const ADDRESS_REQUIRED = "address is required";
export const CONFIRM_REQUIRED = "confirm is required";
export const ORDER_KIND_INVALID = "order kind is invalid";

const CODE_RE = /^C\d{1,12}$/i;
const MAX_CODES = 20;
const MAX_SECRET = 1024;
const CATALOG_PAGE_SIZE = 20;

export type JlcpcbEnv = {
	JLCPCB_APP_ID?: string;
	JLCPCB_ACCESS_KEY?: string;
	JLCPCB_SECRET_KEY?: string;
};

export type JlcpcbCredentials = {
	appId: string;
	accessKey: string;
	secretKey: string;
};

export type JlcpcbPart = {
	componentCode: string;
	name?: string;
	package?: string;
	stock?: string | number;
	price?: string | number;
};

export type JlcpcbPartsClient = {
	components: {
		getDetailsByCode(body: {
			componentCodes: string[];
		}): Promise<{ raiseForStatus(): void; data: unknown }>;
	};
};

export type JlcpcbClientFactory = (
	credentials: JlcpcbCredentials,
) => JlcpcbPartsClient;

export type JlcpcbOrderResponse = {
	raiseForStatus(): void;
	data: unknown;
};

export type JlcpcbOrderClient = {
	pcb: {
		quote(body: Record<string, unknown>): Promise<JlcpcbOrderResponse>;
		createOrder(body: Record<string, unknown>): Promise<JlcpcbOrderResponse>;
	};
	tdp: {
		quote(body: Record<string, unknown>): Promise<JlcpcbOrderResponse>;
		createOrder(body: Record<string, unknown>): Promise<JlcpcbOrderResponse>;
	};
};

export type JlcpcbOrderClientFactory = (
	credentials: JlcpcbCredentials,
) => JlcpcbOrderClient;

export function jlcpcbConfigured(
	credentials: JlcpcbCredentials | null | undefined,
): credentials is JlcpcbCredentials {
	return Boolean(
		credentials?.appId && credentials.accessKey && credentials.secretKey,
	);
}

export function loadJlcpcbCredentials(
	env: JlcpcbEnv | null | undefined,
): JlcpcbCredentials | null {
	return credentialsFrom({
		appId: env?.JLCPCB_APP_ID,
		accessKey: env?.JLCPCB_ACCESS_KEY,
		secretKey: env?.JLCPCB_SECRET_KEY,
	});
}

export function jlcpcbCredentialStatus(env: JlcpcbEnv | null | undefined): {
	configured: boolean;
} {
	return { configured: jlcpcbConfigured(loadJlcpcbCredentials(env)) };
}

export async function searchJlcpcbParts(
	env: JlcpcbEnv,
	codes: readonly string[],
	clientFor: JlcpcbClientFactory = partsClient,
): Promise<JlcpcbPart[]> {
	const stored = requireCredentials(env);
	const componentCodes = normalizeCodes(codes);
	let response: { raiseForStatus(): void; data: unknown };
	try {
		const client = clientFor(stored);
		response = await client.components.getDetailsByCode({ componentCodes });
		response.raiseForStatus();
	} catch (caught) {
		throw redact(caught, stored);
	}
	return partsFrom(response.data);
}

export async function handleJlcpcbSearch(input: {
	env: JlcpcbEnv;
	userId: string;
	body: Record<string, unknown>;
	clientFor?: JlcpcbClientFactory;
	searchParts?: PartsSearch;
}): Promise<{ parts: JlcpcbPart[] }> {
	requireUserId(input.userId);
	const kind = searchKind(input.body);
	if (kind.kind === "keyword") {
		return {
			parts: await searchJlcpcbCatalog(kind.query, input.searchParts),
		};
	}
	const parts = input.clientFor
		? await searchJlcpcbParts(input.env, kind.codes, input.clientFor)
		: await searchJlcpcbParts(input.env, kind.codes);
	return { parts };
}

type PartsSearch = (body: {
	keyword: string;
	currentPage?: number;
	pageSize?: number;
}) => Promise<{ raiseForStatus(): void; data: unknown }>;

export async function searchJlcpcbCatalog(
	query: string,
	search: PartsSearch = (body) => JLCPCBClient.searchParts(body),
): Promise<JlcpcbPart[]> {
	const keyword = query.trim();
	if (partsQueryKind(keyword) !== "keyword") {
		throw new Error(JLCPCB_CODE_INVALID);
	}
	try {
		const response = await search({
			keyword,
			currentPage: 1,
			pageSize: CATALOG_PAGE_SIZE,
		});
		response.raiseForStatus();
		return partsFrom(response.data);
	} catch (caught) {
		if (caught instanceof Error && caught.message === JLCPCB_CODE_INVALID) {
			throw caught;
		}
		throw new Error(JLCPCB_REQUEST_FAILED);
	}
}

export async function jlcpcbResponse(
	handler: () => Promise<unknown>,
): Promise<Response> {
	try {
		return jsonOk(await handler());
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : JLCPCB_REQUEST_FAILED,
			errorStatus(caught),
		);
	}
}

function partsClient(credentials: JlcpcbCredentials): JlcpcbPartsClient {
	return new JLCPCBClient({
		appId: credentials.appId,
		accessKey: credentials.accessKey,
		secretKey: credentials.secretKey,
	});
}

function requireUserId(userId: string): string {
	const trimmed = userId.trim();
	if (!trimmed || trimmed !== userId) {
		throw new Error("sign in first");
	}
	return trimmed;
}

function secretField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function credentialsFrom(
	value: Partial<JlcpcbCredentials> | null | undefined,
): JlcpcbCredentials | null {
	const appId = secretField(value?.appId);
	const accessKey = secretField(value?.accessKey);
	const secretKey = secretField(value?.secretKey);
	if (!appId || !accessKey || !secretKey) {
		return null;
	}
	if (
		appId.length > MAX_SECRET ||
		accessKey.length > MAX_SECRET ||
		secretKey.length > MAX_SECRET
	) {
		return null;
	}
	return { appId, accessKey, secretKey };
}

function searchKind(
	body: Record<string, unknown>,
): { kind: "codes"; codes: string[] } | { kind: "keyword"; query: string } {
	const raw = body.componentCodes ?? body.query;
	if (typeof raw === "string") {
		const kind = partsQueryKind(raw);
		if (kind === "keyword") {
			return { kind: "keyword", query: raw.trim() };
		}
		if (kind === "codes") {
			return { kind: "codes", codes: raw.split(/[\s,]+/) };
		}
		throw new Error(raw.trim() ? JLCPCB_CODE_INVALID : JLCPCB_CODE_REQUIRED);
	}
	if (Array.isArray(raw)) {
		return {
			kind: "codes",
			codes: raw.filter((item): item is string => typeof item === "string"),
		};
	}
	throw new Error(JLCPCB_CODE_REQUIRED);
}

function normalizeCodes(codes: readonly string[]): string[] {
	const trimmed = [
		...new Set(codes.map((code) => code.trim()).filter(Boolean)),
	];
	if (trimmed.length === 0) {
		throw new Error(JLCPCB_CODE_REQUIRED);
	}
	if (
		trimmed.length > MAX_CODES ||
		trimmed.some((code) => !CODE_RE.test(code))
	) {
		throw new Error(JLCPCB_CODE_INVALID);
	}
	return trimmed.map((code) => `C${code.slice(1)}`);
}

function redact(caught: unknown, credentials: JlcpcbCredentials): Error {
	const message =
		caught instanceof Error && caught.message.trim()
			? caught.message
			: JLCPCB_REQUEST_FAILED;
	const secrets = [
		credentials.appId,
		credentials.accessKey,
		credentials.secretKey,
	];
	if (secrets.some((secret) => secret && message.includes(secret))) {
		return new Error(JLCPCB_REQUEST_FAILED);
	}
	return new Error(message);
}

function partsFrom(data: unknown): JlcpcbPart[] {
	if (!Array.isArray(data)) {
		return [];
	}
	const parts: JlcpcbPart[] = [];
	for (const row of data) {
		const part = partFrom(row);
		if (part) {
			parts.push(part);
		}
	}
	return parts;
}

function partFrom(value: unknown): JlcpcbPart | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const componentCode = text(record.componentCode);
	if (!componentCode) {
		return null;
	}
	const part: JlcpcbPart = { componentCode };
	const name = text(record.name) ?? text(record.componentName);
	const pack =
		text(record.package) ??
		text(record.componentSpecification) ??
		text(record.componentSpecificationEn);
	const stock = scalar(record.stock) ?? scalar(record.stockCount);
	const price = priceOf(record);
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

function priceOf(record: Record<string, unknown>): string | number | undefined {
	const direct = scalar(record.price) ?? scalar(record.productPrice);
	if (direct !== undefined) {
		return direct;
	}
	if (!Array.isArray(record.componentPrices)) {
		return undefined;
	}
	for (const row of record.componentPrices) {
		if (!row || typeof row !== "object" || Array.isArray(row)) {
			continue;
		}
		const price = scalar((row as Record<string, unknown>).productPrice);
		if (price !== undefined) {
			return price;
		}
	}
	return undefined;
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

export async function handleJlcpcbOrder(input: {
	env: JlcpcbEnv;
	userId: string;
	address: ShippingAddress | null;
	body: Record<string, unknown>;
	clientFor?: JlcpcbOrderClientFactory;
}): Promise<{ order: unknown }> {
	if (input.body.confirm !== true) {
		throw new Error(CONFIRM_REQUIRED);
	}
	const kind = orderKind(input.body.kind);
	const stored = requireCredentials(input.env);
	requireUserId(input.userId);
	const address = input.address;
	if (!address) {
		throw new Error(ADDRESS_REQUIRED);
	}
	const client = (input.clientFor ?? orderClient)(stored);
	const payload =
		kind === "pcb"
			? pcbCreateBody(input.body, address)
			: tdpCreateBody(input.body, address);
	let response: JlcpcbOrderResponse;
	try {
		response =
			kind === "pcb"
				? await client.pcb.createOrder(payload)
				: await client.tdp.createOrder(payload);
		response.raiseForStatus();
	} catch (caught) {
		throw redact(caught, stored);
	}
	return { order: response.data ?? null };
}

export async function handleJlcpcbQuote(input: {
	env: JlcpcbEnv;
	userId: string;
	address: ShippingAddress | null;
	body: Record<string, unknown>;
	clientFor?: JlcpcbOrderClientFactory;
}): Promise<{ quote: unknown }> {
	const kind = orderKind(input.body.kind);
	const stored = requireCredentials(input.env);
	requireUserId(input.userId);
	const address = input.address;
	const client = (input.clientFor ?? orderClient)(stored);
	const payload =
		kind === "pcb"
			? pcbQuoteBody(input.body, address)
			: tdpQuoteBody(input.body, address);
	let response: JlcpcbOrderResponse;
	try {
		response =
			kind === "pcb"
				? await client.pcb.quote(payload)
				: await client.tdp.quote(payload);
		response.raiseForStatus();
	} catch (caught) {
		throw redact(caught, stored);
	}
	return { quote: response.data ?? null };
}

function requireCredentials(env: JlcpcbEnv): JlcpcbCredentials {
	const stored = loadJlcpcbCredentials(env);
	if (!jlcpcbConfigured(stored)) {
		throw new Error(JLCPCB_CREDENTIALS_REQUIRED);
	}
	return stored;
}

function orderKind(value: unknown): "pcb" | "tdp" {
	if (value === "pcb" || value === "tdp") {
		return value;
	}
	throw new Error(ORDER_KIND_INVALID);
}

function orderClient(credentials: JlcpcbCredentials): JlcpcbOrderClient {
	return new JLCPCBClient({
		appId: credentials.appId,
		accessKey: credentials.accessKey,
		secretKey: credentials.secretKey,
	});
}

function pcbCreateBody(
	body: Record<string, unknown>,
	address: ShippingAddress,
): Record<string, unknown> {
	const request: Record<string, unknown> = {
		shippingAddress: pcbAddress(address),
	};
	const fileKey = fieldText(body.fileKey);
	const orderType = finite(body.orderType);
	const pcbParam = pcbParamFrom(body);
	if (fileKey) request.fileKey = fileKey;
	if (orderType !== undefined) request.orderType = orderType;
	if (pcbParam) request.pcbParam = pcbParam;
	return request;
}

function pcbQuoteBody(
	body: Record<string, unknown>,
	address: ShippingAddress | null,
): Record<string, unknown> {
	const request = pcbCreateBody(body, address ?? emptyAddress());
	if (!address) {
		delete request.shippingAddress;
		return request;
	}
	delete request.shippingAddress;
	request.country = address.country;
	request.postCode = address.postalCode;
	request.city = address.city;
	return request;
}

function tdpCreateBody(
	body: Record<string, unknown>,
	address: ShippingAddress,
): Record<string, unknown> {
	const request: Record<string, unknown> = {
		shippingAddress: tdpAddress(address),
		billingUseShippingAddressFlag: true,
	};
	const fileAccessId = fieldText(body.fileAccessId);
	const itemCount = finite(body.itemCount);
	if (fileAccessId) request.fileAccessId = fileAccessId;
	if (itemCount !== undefined) request.itemCount = itemCount;
	return request;
}

function tdpQuoteBody(
	body: Record<string, unknown>,
	address: ShippingAddress | null,
): Record<string, unknown> {
	const request: Record<string, unknown> = {};
	const fileAccessId = fieldText(body.fileAccessId);
	const itemCount = finite(body.itemCount);
	if (fileAccessId) request.fileAccessId = fileAccessId;
	if (itemCount !== undefined) request.itemCount = itemCount;
	if (address) request.shippingAddress = tdpAddress(address);
	return request;
}

function pcbParamFrom(
	body: Record<string, unknown>,
): Record<string, number> | undefined {
	const pcbParam: Record<string, number> = {};
	const layer = finite(body.layer);
	const qty = finite(body.qty);
	const thickness = finite(body.thickness);
	if (layer !== undefined) pcbParam.layer = layer;
	if (qty !== undefined) pcbParam.qty = qty;
	if (thickness !== undefined) pcbParam.thickness = thickness;
	return Object.keys(pcbParam).length ? pcbParam : undefined;
}

function pcbAddress(address: ShippingAddress): Record<string, string> {
	const { firstName, lastName } = splitName(address.name);
	const next: Record<string, string> = {
		firstName,
		lastName,
		streetAddress: address.line1,
		city: address.city,
		country: address.country,
		postalCode: address.postalCode,
	};
	if (address.line2) next.addressLine2 = address.line2;
	if (address.region) next.province = address.region;
	return next;
}

function tdpAddress(address: ShippingAddress): Record<string, string> {
	const { firstName, lastName } = splitName(address.name);
	const next: Record<string, string> = {
		firstName,
		lastName,
		street: address.line1,
		city: address.city,
		country: address.country,
		postcode: address.postalCode,
	};
	if (address.line2) next.street2 = address.line2;
	if (address.region) next.state = address.region;
	return next;
}

function splitName(name: string): { firstName: string; lastName: string } {
	const trimmed = name.trim();
	const space = trimmed.indexOf(" ");
	if (space === -1) {
		return { firstName: trimmed, lastName: trimmed };
	}
	const lastName = trimmed.slice(space + 1).trim();
	return { firstName: trimmed.slice(0, space), lastName: lastName || trimmed };
}

function emptyAddress(): ShippingAddress {
	return {
		name: "unused",
		line1: "unused",
		city: "unused",
		postalCode: "unused",
		country: "unused",
	};
}

function fieldText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string" || !value.trim()) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
