export const DEVICE_AUTH_VERSION = "gpio-companion-device-v1";
export const DEFAULT_DEVICE_MAX_SKEW_MS = 60_000;

export const DEVICE_AUTH_HEADERS = {
	keyId: "x-gpio-key-id",
	timestamp: "x-gpio-timestamp",
	nonce: "x-gpio-nonce",
	signature: "x-gpio-signature",
	grant: "x-gpio-grant",
} as const;

export type DeviceKeyPair = {
	keyId: string;
	privateKeyPem: string;
	publicKeyPem: string;
};

export type DeviceAuthHeaders = {
	"X-Gpio-Key-Id": string;
	"X-Gpio-Timestamp": string;
	"X-Gpio-Nonce": string;
	"X-Gpio-Signature": string;
	"X-Gpio-Grant"?: string;
};

export class DeviceAuthError extends Error {
	readonly status: 401 | 403;

	constructor(message: string, status: 401 | 403) {
		super(message);
		this.name = "DeviceAuthError";
		this.status = status;
	}
}

export async function publicKeyPemFromPrivateKey(
	privateKeyPem: string,
): Promise<string> {
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		asBufferSource(pemToBytes(privateKeyPem)),
		"Ed25519",
		true,
		["sign"],
	);
	const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as {
		kty?: string;
		crv?: string;
		x?: string;
	};
	if (!jwk.x || jwk.kty !== "OKP" || jwk.crv !== "Ed25519") {
		throw new Error("invalid ed25519 private key");
	}
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{ kty: "OKP", crv: "Ed25519", x: jwk.x },
		"Ed25519",
		true,
		["verify"],
	);
	const spki = new Uint8Array(
		(await crypto.subtle.exportKey("spki", publicKey)) as ArrayBuffer,
	);
	return bytesToPem(spki, "PUBLIC KEY");
}

export async function generateDeviceKeyPair(
	keyId = "gpio-companion-v1",
): Promise<DeviceKeyPair> {
	const pair = (await crypto.subtle.generateKey("Ed25519", true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const privateDer = new Uint8Array(
		(await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
	);
	const publicDer = new Uint8Array(
		(await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer,
	);
	return {
		keyId,
		privateKeyPem: bytesToPem(privateDer, "PRIVATE KEY"),
		publicKeyPem: bytesToPem(publicDer, "PUBLIC KEY"),
	};
}

export async function signDeviceRequest(options: {
	privateKeyPem: string;
	keyId: string;
	method: string;
	path: string;
	body?: string;
	now?: number;
	nonce?: string;
	grantHeader?: string;
}): Promise<DeviceAuthHeaders> {
	const timestamp = String(options.now ?? Date.now());
	const nonce = options.nonce ?? randomNonce();
	const body = options.body ?? "";
	const payload = await canonicalDevicePayload({
		method: options.method,
		path: options.path,
		timestamp,
		nonce,
		body,
	});
	const key = await importPrivateKey(options.privateKeyPem);
	const signature = new Uint8Array(
		await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(payload)),
	);
	const headers: DeviceAuthHeaders = {
		"X-Gpio-Key-Id": options.keyId,
		"X-Gpio-Timestamp": timestamp,
		"X-Gpio-Nonce": nonce,
		"X-Gpio-Signature": bytesToBase64(signature),
	};
	if (options.grantHeader) {
		headers["X-Gpio-Grant"] = options.grantHeader;
	}
	return headers;
}

export type DeviceVerifyResult = {
	issued: number;
	nonce: string;
	clockBehind: boolean;
};

export async function verifyDeviceRequest(options: {
	publicKeyPem: string;
	keyId: string;
	method: string;
	path: string;
	body?: string;
	headers: Headers | Record<string, string | null | undefined>;
	now?: number;
	maxSkewMs?: number;
	enforceSkew?: boolean;
}): Promise<DeviceVerifyResult> {
	const keyId = headerValue(options.headers, DEVICE_AUTH_HEADERS.keyId);
	const timestamp = headerValue(options.headers, DEVICE_AUTH_HEADERS.timestamp);
	const nonce = headerValue(options.headers, DEVICE_AUTH_HEADERS.nonce);
	const signature = headerValue(options.headers, DEVICE_AUTH_HEADERS.signature);
	if (!hasDeviceSignature(options.headers)) {
		throw new DeviceAuthError("missing device signature", 401);
	}
	if (!keyId || !timestamp || !nonce || !signature) {
		throw new DeviceAuthError("missing device signature", 401);
	}
	if (keyId !== options.keyId) {
		throw new DeviceAuthError("unknown device key", 403);
	}
	const issued = Number(timestamp);
	if (!Number.isFinite(issued)) {
		throw new DeviceAuthError("invalid device signature", 403);
	}
	const payload = await canonicalDevicePayload({
		method: options.method,
		path: options.path,
		timestamp,
		nonce,
		body: options.body ?? "",
	});
	let signatureBytes: Uint8Array;
	try {
		signatureBytes = base64ToBytes(signature);
	} catch {
		throw new DeviceAuthError("invalid device signature", 403);
	}
	const key = await importPublicKey(options.publicKeyPem);
	const ok = await crypto.subtle.verify(
		"Ed25519",
		key,
		asBufferSource(signatureBytes),
		new TextEncoder().encode(payload),
	);
	if (!ok) {
		throw new DeviceAuthError("invalid device signature", 403);
	}
	const now = options.now ?? Date.now();
	const maxSkewMs = options.maxSkewMs ?? DEFAULT_DEVICE_MAX_SKEW_MS;
	const enforceSkew = options.enforceSkew ?? true;
	if (enforceSkew && now - issued > maxSkewMs) {
		throw new DeviceAuthError("expired device signature", 403);
	}
	return {
		issued,
		nonce,
		clockBehind: issued - now > maxSkewMs,
	};
}

export async function canonicalDevicePayload(input: {
	method: string;
	path: string;
	timestamp: string;
	nonce: string;
	body: string;
}): Promise<string> {
	const hash = await sha256Hex(input.body);
	return [
		DEVICE_AUTH_VERSION,
		input.method.toUpperCase(),
		normalizeDevicePath(input.path),
		input.timestamp,
		input.nonce,
		hash,
	].join("\n");
}

export function hasDeviceSignature(
	headers: Headers | Record<string, string | null | undefined>,
): boolean {
	return headerValue(headers, DEVICE_AUTH_HEADERS.signature).length > 0;
}

export function normalizeDevicePath(path: string): string {
	const url = path.includes("://")
		? new URL(path)
		: new URL(path.startsWith("/") ? path : `/${path}`, "http://device.local");
	return url.pathname.replace(/\/+$/, "") || "/";
}

function randomNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return bytesToHex(bytes);
}

async function sha256Hex(body: string): Promise<string> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(body),
	);
	return bytesToHex(new Uint8Array(hash));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"pkcs8",
		asBufferSource(pemToBytes(pem)),
		"Ed25519",
		false,
		["sign"],
	);
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"spki",
		asBufferSource(pemToBytes(pem)),
		"Ed25519",
		false,
		["verify"],
	);
}

export async function signEd25519Message(
	privateKeyPem: string,
	message: Uint8Array,
): Promise<Uint8Array> {
	const key = await importPrivateKey(privateKeyPem);
	return new Uint8Array(
		await crypto.subtle.sign("Ed25519", key, asBufferSource(message)),
	);
}

export async function verifyEd25519Message(
	publicKeyPem: string,
	message: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const key = await importPublicKey(publicKeyPem);
	return crypto.subtle.verify(
		"Ed25519",
		key,
		asBufferSource(signature),
		asBufferSource(message),
	);
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

function pemToBytes(pem: string): Uint8Array {
	const b64 = pem
		.replace(/-----BEGIN [^-]+-----/, "")
		.replace(/-----END [^-]+-----/, "")
		.replace(/\s+/g, "");
	if (!b64) {
		throw new Error("invalid pem");
	}
	return base64ToBytes(b64);
}

function bytesToPem(
	bytes: Uint8Array,
	label: "PRIVATE KEY" | "PUBLIC KEY",
): string {
	const b64 = bytesToBase64(bytes);
	const lines = b64.match(/.{1,64}/g) ?? [b64];
	return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function headerValue(
	headers: Headers | Record<string, string | null | undefined>,
	name: string,
): string {
	if (headers instanceof Headers) {
		return headers.get(name)?.trim() ?? "";
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name && typeof value === "string") {
			return value.trim();
		}
	}
	return "";
}
