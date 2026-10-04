import { ARDUINO_PROXY_PATH } from "./arduino-proxy.ts";
import {
	createSignedEnvelope,
	parseSignedEnvelope,
	type SignedDeviceEnvelope,
} from "./ble.ts";
import {
	CONSOLE_PATH,
	CONSOLE_USB_PATH,
	CONSOLE_USB_STOP_PATH,
} from "./console.ts";
import {
	DEVICE_AUTH_HEADERS,
	DeviceAuthError,
	generateDeviceKeyPair,
	signEd25519Message,
	verifyDeviceRequest,
	verifyEd25519Message,
} from "./device-auth.ts";
import { INFO_PATH } from "./device-info.ts";
import {
	FLASH_PATH,
	FLASH_PORTS_PATH,
	FLASH_PROXY_PATH,
	FLASH_SKETCHES_PATH,
} from "./flash.ts";
import { GPIO_PATH } from "./gpio.ts";
import { RUN_PATH, RUN_SKETCHES_PATH, RUN_STOP_PATH } from "./run.ts";
import { VERIFY_PATH, VERIFY_STOP_PATH } from "./verify.ts";

export const OFFLINE_GRANT_VERSION = "gpio-offline-v1";
export const OFFLINE_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_GRANT_REFRESH_MS = 60 * 60 * 1000;
export const WIFI_PATH = "/v1/config/wifi";

export const OFFLINE_GRANT_SCOPE = [
	`PUT ${WIFI_PATH}`,
	`GET ${INFO_PATH}`,
	`GET ${GPIO_PATH}`,
	`PUT ${GPIO_PATH}`,
	`GET ${FLASH_PATH}`,
	`POST ${FLASH_PATH}`,
	`GET ${FLASH_PORTS_PATH}`,
	`GET ${FLASH_SKETCHES_PATH}`,
	`POST ${FLASH_PROXY_PATH}`,
	`GET ${ARDUINO_PROXY_PATH}`,
	`GET ${RUN_PATH}`,
	`GET ${RUN_SKETCHES_PATH}`,
	`POST ${RUN_PATH}`,
	`POST ${RUN_STOP_PATH}`,
	`GET ${VERIFY_PATH}`,
	`POST ${VERIFY_PATH}`,
	`POST ${VERIFY_STOP_PATH}`,
	`GET ${CONSOLE_PATH}`,
	`POST ${CONSOLE_USB_PATH}`,
	`POST ${CONSOLE_USB_STOP_PATH}`,
] as const;

export type OfflineGrantScope = (typeof OFFLINE_GRANT_SCOPE)[number];

export type OfflineGrant = {
	v: typeof OFFLINE_GRANT_VERSION;
	uuid: string;
	userId: string;
	keyId: string;
	pub: string;
	iat: number;
	exp: number;
	scope: OfflineGrantScope[];
	sig: string;
};

export type OfflineGrantBundle = {
	privateKeyPem: string;
	grant: OfflineGrant;
	exp: number;
};

export function offlineScopeKey(method: string, path: string): string {
	const url = path.includes("://")
		? new URL(path)
		: new URL(path.startsWith("/") ? path : `/${path}`, "http://device.local");
	const normalized = url.pathname.replace(/\/+$/, "") || "/";
	return `${method.toUpperCase()} ${normalized}`;
}

export function isOfflineGrantScope(method: string, path: string): boolean {
	const key = offlineScopeKey(method, path);
	return (OFFLINE_GRANT_SCOPE as readonly string[]).includes(key);
}

export function offlineGrantNeedsRefresh(
	grant: OfflineGrant,
	now = Date.now(),
): boolean {
	return grant.exp - now <= OFFLINE_GRANT_REFRESH_MS;
}

export function canonicalOfflineGrant(
	grant: Omit<OfflineGrant, "sig">,
): string {
	return [
		OFFLINE_GRANT_VERSION,
		grant.uuid.trim(),
		grant.userId.trim(),
		grant.keyId.trim(),
		grant.pub.trim(),
		String(grant.iat),
		String(grant.exp),
		[...grant.scope].join("\n"),
	].join("\n");
}

export async function mintOfflineGrant(options: {
	masterPrivateKeyPem: string;
	uuid: string;
	userId: string;
	now?: number;
}): Promise<OfflineGrantBundle> {
	const uuid = options.uuid.trim();
	const userId = options.userId.trim();
	if (!uuid) {
		throw new Error("uuid is required");
	}
	if (!userId) {
		throw new Error("sign in first");
	}
	const iat = options.now ?? Date.now();
	const exp = iat + OFFLINE_GRANT_TTL_MS;
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const keyId = `gpio-offline-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
	const session = await generateDeviceKeyPair(keyId);
	const unsigned: Omit<OfflineGrant, "sig"> = {
		v: OFFLINE_GRANT_VERSION,
		uuid,
		userId,
		keyId: session.keyId,
		pub: session.publicKeyPem,
		iat,
		exp,
		scope: [...OFFLINE_GRANT_SCOPE],
	};
	const signature = await signEd25519Message(
		options.masterPrivateKeyPem,
		new TextEncoder().encode(canonicalOfflineGrant(unsigned)),
	);
	const grant: OfflineGrant = {
		...unsigned,
		sig: bytesToBase64(signature),
	};
	return { privateKeyPem: session.privateKeyPem, grant, exp };
}

export function parseOfflineGrant(input: unknown): OfflineGrant {
	const record =
		typeof input === "string"
			? (JSON.parse(input) as Record<string, unknown>)
			: input;
	if (record === null || typeof record !== "object") {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	const value = record as Record<string, unknown>;
	if (value.v !== OFFLINE_GRANT_VERSION) {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	const uuid = requiredString(value.uuid, "uuid");
	const userId = requiredString(value.userId, "userId");
	const keyId = requiredString(value.keyId, "keyId");
	const pub = requiredString(value.pub, "pub");
	const sig = requiredString(value.sig, "sig");
	const iat = Number(value.iat);
	const exp = Number(value.exp);
	if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	if (!Array.isArray(value.scope) || value.scope.length === 0) {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	const scope: OfflineGrantScope[] = [];
	for (const item of value.scope) {
		if (typeof item !== "string") {
			throw new DeviceAuthError("invalid offline grant", 403);
		}
		if (!(OFFLINE_GRANT_SCOPE as readonly string[]).includes(item)) {
			throw new DeviceAuthError("invalid offline grant", 403);
		}
		scope.push(item as OfflineGrantScope);
	}
	return {
		v: OFFLINE_GRANT_VERSION,
		uuid,
		userId,
		keyId,
		pub,
		iat,
		exp,
		scope,
		sig,
	};
}

export async function verifyOfflineGrant(options: {
	masterPublicKeyPem: string;
	grant: unknown;
	uuid: string;
	method: string;
	path: string;
	now?: number;
	enforceExpiry?: boolean;
}): Promise<OfflineGrant> {
	const grant = parseOfflineGrant(options.grant);
	if (grant.uuid !== options.uuid.trim()) {
		throw new DeviceAuthError("offline grant device mismatch", 403);
	}
	if (!isOfflineGrantScope(options.method, options.path)) {
		throw new DeviceAuthError("offline grant scope mismatch", 403);
	}
	const key = offlineScopeKey(options.method, options.path);
	if (!grant.scope.includes(key as OfflineGrantScope)) {
		throw new DeviceAuthError("offline grant scope mismatch", 403);
	}
	let signature: Uint8Array;
	try {
		signature = base64ToBytes(grant.sig);
	} catch {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	const ok = await verifyEd25519Message(
		options.masterPublicKeyPem,
		new TextEncoder().encode(canonicalOfflineGrant(grant)),
		signature,
	);
	if (!ok) {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	const now = options.now ?? Date.now();
	if ((options.enforceExpiry ?? true) && now > grant.exp) {
		throw new DeviceAuthError("expired offline grant", 403);
	}
	return grant;
}

export async function signOfflineEnvelope(options: {
	bundle: OfflineGrantBundle;
	method: string;
	path: string;
	body?: string;
	now?: number;
	nonce?: string;
}): Promise<SignedDeviceEnvelope> {
	const grant = options.bundle.grant;
	const grantHeader = JSON.stringify(grant);
	return createSignedEnvelope({
		privateKeyPem: options.bundle.privateKeyPem,
		keyId: grant.keyId,
		method: options.method,
		path: options.path,
		body: options.body,
		now: options.now,
		nonce: options.nonce,
		grantHeader,
		grant,
	});
}

export async function verifyOfflineEnvelope(options: {
	masterPublicKeyPem: string;
	uuid: string;
	method: string;
	path: string;
	body?: string;
	headers: Headers | Record<string, string | null | undefined>;
	now?: number;
	enforceExpiry?: boolean;
}) {
	const grantRaw = grantHeaderValue(options.headers);
	if (!grantRaw) {
		throw new DeviceAuthError("missing offline grant", 401);
	}
	const grant = await verifyOfflineGrant({
		masterPublicKeyPem: options.masterPublicKeyPem,
		grant: grantRaw,
		uuid: options.uuid,
		method: options.method,
		path: options.path,
		now: options.now,
		enforceExpiry: options.enforceExpiry,
	});
	const verified = await verifyDeviceRequest({
		publicKeyPem: grant.pub,
		keyId: grant.keyId,
		method: options.method,
		path: options.path,
		body: options.body,
		headers: options.headers,
		now: options.now,
		enforceSkew: false,
	});
	if (verified.issued < grant.iat || verified.issued > grant.exp) {
		throw new DeviceAuthError("expired device signature", 403);
	}
	return { grant, verified };
}

export function grantHeaderValue(
	headers: Headers | Record<string, string | null | undefined>,
): string {
	if (headers instanceof Headers) {
		return headers.get(DEVICE_AUTH_HEADERS.grant)?.trim() ?? "";
	}
	for (const [key, value] of Object.entries(headers)) {
		if (
			key.toLowerCase() === DEVICE_AUTH_HEADERS.grant &&
			typeof value === "string"
		) {
			return value.trim();
		}
	}
	return "";
}

export function envelopeGrant(
	envelope: SignedDeviceEnvelope,
): OfflineGrant | null {
	if (envelope.grant) {
		return parseOfflineGrant(envelope.grant);
	}
	const raw = envelope.headers["X-Gpio-Grant"];
	if (!raw) {
		return null;
	}
	return parseOfflineGrant(raw);
}

export function parseOfflineEnvelope(input: unknown): SignedDeviceEnvelope {
	const envelope = parseSignedEnvelope(input);
	if (!envelope.grant && envelope.headers["X-Gpio-Grant"]) {
		envelope.grant = parseOfflineGrant(envelope.headers["X-Gpio-Grant"]);
	}
	return envelope;
}

function requiredString(value: unknown, _field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new DeviceAuthError("invalid offline grant", 403);
	}
	return value.trim();
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
