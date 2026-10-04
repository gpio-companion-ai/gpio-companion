import type { EventContext } from "@cloudflare/workers-types";
import { createOpenAuthsterClient } from "openauthster-shared/client/user";

export type UserRole = "user" | "admin";

export type PublicSession = {
	id?: string;
	email?: string;
	name?: string;
	role?: UserRole;
};

type TokenClient = {
	token: string | null;
	isAuthenticated: boolean;
	userInfo?: { role?: unknown; email?: unknown; name?: unknown };
	userMeta?: { role?: unknown };
};

const memoryCache = new Map<string, unknown>();

function truncateKey(key: string) {
	return key.length > 100 ? key.slice(0, 100) : key;
}

export function authRedirectURI(): string {
	if (typeof window !== "undefined") {
		return `${window.location.origin}/callback`;
	}
	return (
		process.env.PUBLIC_AUTH_REDIRECT_URI ??
		"https://marketplace.gpio-companion.com/callback"
	);
}

export function createClient(ctx?: EventContext<Env, string, unknown> | null) {
	return createOpenAuthsterClient<
		PublicSession,
		Record<string, never>,
		UserRole
	>({
		issuerURI: process.env.PUBLIC_AUTH_ISSUER as string,
		clientID: process.env.PUBLIC_AUTH_CLIENT_ID as string,
		redirectURI: authRedirectURI(),
		secret: process.env.AUTH_SECRET as string,
		cache_provider: {
			async get(key) {
				if (!ctx) return memoryCache.get(key) ?? null;
				const raw = await ctx.env.DYNAMIC_PAGE_KV.get(truncateKey(key));
				return raw ? JSON.parse(raw) : null;
			},
			async set(key, value, ttl) {
				if (!ctx) {
					memoryCache.set(key, value);
					return;
				}
				await ctx.env.DYNAMIC_PAGE_KV.put(
					truncateKey(key),
					JSON.stringify(value),
					{
						expirationTtl: Math.max(
							60,
							Math.floor((ttl.getTime() - Date.now()) / 1000),
						),
					},
				);
			},
			async delete(key) {
				if (!ctx) {
					memoryCache.delete(key);
					return;
				}
				await ctx.env.DYNAMIC_PAGE_KV.delete(truncateKey(key));
			},
		},
	});
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function pickString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function parseRole(...values: unknown[]): UserRole {
	for (const value of values) {
		if (value === "admin" || value === "user") return value;
	}
	return "user";
}

export function authConfigured(): boolean {
	return Boolean(
		process.env.PUBLIC_AUTH_ISSUER && process.env.PUBLIC_AUTH_CLIENT_ID,
	);
}

export async function readSession(
	ctx: EventContext<Env, string, unknown>,
): Promise<PublicSession | null> {
	const hostname = new URL(ctx.request.url).hostname;
	const local =
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "[::1]";
	if (!process.env.AUTH_SECRET || !authConfigured()) {
		if (local && !process.env.MARKETPLACE_ADMIN_TOKEN) {
			return {
				id: "local",
				email: "local@localhost",
				name: "Local admin",
				role: "admin",
			};
		}
		return null;
	}
	const auth = createClient(ctx);
	try {
		await auth.setTokenFromRequest(ctx.request as unknown as Request);
	} catch {
		return null;
	}
	if (!auth.getToken()) return null;
	const client = auth as unknown as TokenClient;
	let sessionResult: unknown = null;
	try {
		sessionResult = await auth.getUserSession("public");
	} catch {
		sessionResult = null;
	}
	if (sessionResult instanceof Error) sessionResult = null;
	const payload = asRecord(sessionResult);
	const publicSession = asRecord(payload?.public ?? payload);
	const userInfo = asRecord(payload?.userInfo) ?? asRecord(client.userInfo);
	const id = pickString(payload?.user_id, publicSession?.id);
	if (!id) return null;
	return {
		id,
		email: pickString(publicSession?.email, userInfo?.email),
		name: pickString(publicSession?.name, userInfo?.name),
		role: parseRole(userInfo?.role, client.userMeta?.role, publicSession?.role),
	};
}
