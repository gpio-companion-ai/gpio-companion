import {
	publicKeyPemFromPrivateKey,
	signEd25519Message,
	verifyEd25519Message,
} from "./device-auth.ts";
import {
	HUB_TOKEN_PREFIX,
	HUB_TOKEN_TTL_MS,
	type HubRole,
	hubOrigin,
	hubWsUrl,
	isHubRole,
} from "./hub-message.ts";

export {
	asArduinoProxyStatus,
	asFlashStatus,
	asRunStatus,
	encodeHubMessage,
	HUB_FLASH_MS,
	HUB_LIVE_TTL_SEC,
	HUB_PATH,
	HUB_PING_MS,
	HUB_PROXY_MS,
	HUB_RUN_MS,
	HUB_TOKEN_PREFIX,
	HUB_TOKEN_TTL_MS,
	type HubChannel,
	type HubMessage,
	type HubMessageType,
	type HubRole,
	hubOrigin,
	hubWsUrl,
	isHubChannel,
	isHubRole,
	parseHubMessage,
} from "./hub-message.ts";

export type HubTicketClaims = {
	uuid: string;
	role: HubRole;
	exp: number;
};

export type HubTicket = {
	token: string;
	expiresAt: string;
	exp: number;
	wsUrl: string;
};

export function isHubAccessToken(token: string): boolean {
	return token.trim().startsWith(HUB_TOKEN_PREFIX);
}

export async function signHubTicket(options: {
	privateKeyPem: string;
	uuid: string;
	role?: HubRole;
	origin?: string;
	now?: number;
	ttlMs?: number;
}): Promise<HubTicket> {
	const uuid = options.uuid.trim();
	if (!uuid) {
		throw new Error("uuid is required");
	}
	const role = options.role ?? "pi";
	const now = options.now ?? Date.now();
	const ttlMs = options.ttlMs ?? HUB_TOKEN_TTL_MS;
	const exp = now + ttlMs;
	const payload = JSON.stringify({ uuid, role, exp } satisfies HubTicketClaims);
	const signature = await signEd25519Message(
		options.privateKeyPem,
		new TextEncoder().encode(payload),
	);
	const token = `${HUB_TOKEN_PREFIX}${bytesToBase64Url(new TextEncoder().encode(payload))}.${bytesToBase64Url(signature)}`;
	return {
		token,
		expiresAt: new Date(exp).toISOString(),
		exp,
		wsUrl: hubWsUrl(hubOrigin(options.origin), uuid, token),
	};
}

export async function verifyHubTicket(options: {
	token: string;
	publicKeyPem?: string;
	privateKeyPem?: string;
	now?: number;
}): Promise<HubTicketClaims> {
	const token = options.token.trim();
	if (!isHubAccessToken(token)) {
		throw new Error("invalid hub token");
	}
	const rest = token.slice(HUB_TOKEN_PREFIX.length);
	const dot = rest.indexOf(".");
	if (dot <= 0 || dot === rest.length - 1) {
		throw new Error("invalid hub token");
	}
	let payloadBytes: Uint8Array;
	let signature: Uint8Array;
	try {
		payloadBytes = base64UrlToBytes(rest.slice(0, dot));
		signature = base64UrlToBytes(rest.slice(dot + 1));
	} catch {
		throw new Error("invalid hub token");
	}
	const publicKeyPem =
		options.publicKeyPem?.trim() ||
		(options.privateKeyPem
			? await publicKeyPemFromPrivateKey(options.privateKeyPem)
			: "");
	if (!publicKeyPem) {
		throw new Error("hub token key is not set");
	}
	const ok = await verifyEd25519Message(publicKeyPem, payloadBytes, signature);
	if (!ok) {
		throw new Error("invalid hub token");
	}
	let claims: HubTicketClaims;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
			uuid?: unknown;
			role?: unknown;
			exp?: unknown;
		};
		const uuid = typeof parsed.uuid === "string" ? parsed.uuid.trim() : "";
		const exp = Number(parsed.exp);
		if (!uuid || !Number.isFinite(exp) || !isHubRole(parsed.role)) {
			throw new Error("invalid hub token");
		}
		claims = { uuid, role: parsed.role, exp };
	} catch {
		throw new Error("invalid hub token");
	}
	const now = options.now ?? Date.now();
	if (now >= claims.exp) {
		throw new Error("expired hub token");
	}
	return claims;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const pad =
		padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	const binary = atob(padded + pad);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
