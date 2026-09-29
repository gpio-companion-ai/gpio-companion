import type { SignedInIdentity } from "./auth/identity.ts";
import { requireIdentity } from "./session.ts";

export type MobileEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
	JLCPCB_APP_ID?: string;
	JLCPCB_ACCESS_KEY?: string;
	JLCPCB_SECRET_KEY?: string;
};

export type MobileContext = {
	request: Request;
	env: MobileEnv;
};

export function jsonOk(
	data: unknown,
	status = 200,
	headers?: HeadersInit,
): Response {
	return Response.json({ ok: true, data }, { status, headers });
}

export function jsonFail(error: string, status = 400): Response {
	return Response.json({ ok: false, error }, { status });
}

export function errorStatus(caught: unknown): number {
	const message = caught instanceof Error ? caught.message : "request failed";
	if (
		message === "sign in first" ||
		message.startsWith("profile unavailable")
	) {
		return 401;
	}
	if (message === "admin only") {
		return 403;
	}
	if (message === "too many bug reports") {
		return 429;
	}
	if (message === "support email is not configured") {
		return 503;
	}
	if (message.includes("board did not respond in time")) {
		return 502;
	}
	const deviceCode = /^device (\d{3})$/.exec(message);
	if (deviceCode?.[1]) {
		const status = Number(deviceCode[1]);
		if (status >= 400 && status <= 599) {
			return status;
		}
	}
	return 400;
}

export async function requireMobileIdentity(
	ctx: MobileContext,
): Promise<SignedInIdentity> {
	return requireIdentity(ctx);
}

export async function readJsonBody(
	request: Request,
): Promise<Record<string, unknown>> {
	try {
		const body = (await request.json()) as unknown;
		if (!body || typeof body !== "object" || Array.isArray(body)) {
			return {};
		}
		return body as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export async function runMobile(
	ctx: MobileContext,
	handler: (identity: SignedInIdentity) => Promise<unknown>,
): Promise<Response> {
	try {
		const identity = await requireMobileIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return jsonOk(await handler(identity));
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
