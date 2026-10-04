import type { EventContext } from "@cloudflare/workers-types";
import { type PublicSession, readSession } from "./auth.ts";
import { createCommerceDatabase } from "./db/client.ts";

export function commerceDb(ctx: EventContext<Env, string, unknown>) {
	const db = (ctx.env as Env).MARKETPLACE_DB;
	if (!db) throw new Error("MARKETPLACE_DB binding is missing");
	return createCommerceDatabase(db);
}

export function assertSameOrigin(
	ctx: EventContext<Env, string, unknown>,
): void {
	const origin = ctx.request.headers.get("origin");
	if (!origin) return;
	if (origin !== new URL(ctx.request.url).origin) {
		throw new Error("Cross-origin request rejected");
	}
}

export async function requireAdmin(
	ctx: EventContext<Env, string, unknown>,
): Promise<PublicSession | null> {
	assertSameOrigin(ctx);
	const session = await readSession(ctx);
	if (session?.role === "admin") return session;
	const configured = (ctx.env as Env & { MARKETPLACE_ADMIN_TOKEN?: string })
		.MARKETPLACE_ADMIN_TOKEN;
	if (configured && ctx.request.headers.get("x-admin-token") === configured) {
		return null;
	}
	throw new Error("Admin access required");
}

export async function requireUser(
	ctx: EventContext<Env, string, unknown>,
): Promise<PublicSession> {
	assertSameOrigin(ctx);
	const session = await readSession(ctx);
	if (!session?.id) throw new Error("Sign in required");
	return session;
}
