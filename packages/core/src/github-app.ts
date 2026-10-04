export const GITHUB_APP_TOKEN_PREFIX = "ghs_";
export const GITHUB_GIT_USER = "x-access-token";
export const GITHUB_API = "https://api.github.com";

export function isGithubAppToken(token: string): boolean {
	return token.startsWith(GITHUB_APP_TOKEN_PREFIX);
}

export function gitHttpsUsername(token: string, login: string): string {
	return isGithubAppToken(token) ? GITHUB_GIT_USER : login;
}

export function timingSafeEqualString(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const a = encoder.encode(left);
	const b = encoder.encode(right);
	const len = Math.max(a.length, b.length, 1);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i += 1) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0 && a.length === b.length && a.length > 0;
}

function derLength(length: number): Uint8Array<ArrayBuffer> {
	if (length < 128) {
		return Uint8Array.of(length);
	}
	if (length < 256) {
		return Uint8Array.of(0x81, length);
	}
	return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
}

function derSeq(tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
	const len = derLength(body.length);
	const out = new Uint8Array(1 + len.length + body.length);
	out[0] = tag;
	out.set(len, 1);
	out.set(body, 1 + len.length);
	return out;
}

export function rsaPkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
	const version = Uint8Array.of(0x02, 0x01, 0x00);
	const alg = Uint8Array.of(
		0x30,
		0x0d,
		0x06,
		0x09,
		0x2a,
		0x86,
		0x48,
		0x86,
		0xf7,
		0x0d,
		0x01,
		0x01,
		0x01,
		0x05,
		0x00,
	);
	const octet = derSeq(0x04, pkcs1);
	const body = new Uint8Array(version.length + alg.length + octet.length);
	body.set(version, 0);
	body.set(alg, version.length);
	body.set(octet, version.length + alg.length);
	return derSeq(0x30, body);
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
	const body = pem
		.replace(/-----BEGIN [^-]+-----/g, "")
		.replace(/-----END [^-]+-----/g, "")
		.replace(/\s+/g, "");
	const bin = atob(body);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) {
		bytes[i] = bin.charCodeAt(i);
	}
	return bytes;
}

export async function importGithubAppPrivateKey(
	pem: string,
): Promise<CryptoKey> {
	const trimmed = pem.trim();
	if (!trimmed) {
		throw new Error("github app private key is missing");
	}
	const raw = pemBody(trimmed);
	const pkcs8 = trimmed.includes("BEGIN RSA PRIVATE KEY")
		? rsaPkcs1ToPkcs8(raw)
		: raw;
	return crypto.subtle.importKey(
		"pkcs8",
		pkcs8,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
}

function base64Url(data: ArrayBuffer | Uint8Array | string): string {
	const bytes =
		typeof data === "string"
			? new TextEncoder().encode(data)
			: data instanceof Uint8Array
				? data
				: new Uint8Array(data);
	let bin = "";
	for (const byte of bytes) {
		bin += String.fromCharCode(byte);
	}
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createGithubAppJwt(
	appId: string,
	privateKeyPem: string,
	now = Date.now(),
): Promise<string> {
	const id = appId.trim();
	if (!id) {
		throw new Error("github app id is missing");
	}
	const key = await importGithubAppPrivateKey(privateKeyPem);
	const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const iat = Math.floor(now / 1000) - 30;
	const exp = iat + 540;
	const payload = base64Url(JSON.stringify({ iat, exp, iss: id }));
	const signingInput = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${base64Url(signature)}`;
}
