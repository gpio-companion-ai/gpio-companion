import {
	deliverSupportEmail,
	redactSecrets,
	SUPPORT_FROM,
	SUPPORT_TO,
} from "gpio-companion";
import { errorStatus, jsonFail, jsonOk } from "./mobile-http.ts";

export { SUPPORT_FROM, SUPPORT_TO };
export const SUPPORT_RATE_MAX = 5;
export const SUPPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

const TEXT_MAX = 4000;
const MODEL_MAX = 120;
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupportSurface = "web" | "desktop" | "mobile";

export function stripSecrets(value: string): string {
	return redactSecrets(value);
}

export type SupportEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_EMAIL_API_TOKEN?: string;
	SUPPORT_FROM_EMAIL?: string;
};

type SupportFetch = typeof fetch;

export type SupportBody = {
	text?: unknown;
	surface?: unknown;
	boardUuid?: unknown;
	boardModel?: unknown;
};

export function supportAccepted(
	result: { sent?: boolean } | null | undefined,
): boolean {
	return result?.sent === true;
}

function asTrimmed(value: unknown, max: number): string {
	if (typeof value !== "string") {
		return "";
	}
	return stripSecrets(value).trim().slice(0, max);
}

function configuredValue(
	explicit: string | undefined,
	fallback: string | undefined,
): string {
	if (explicit !== undefined) {
		return explicit.trim();
	}
	return fallback?.trim() || "";
}

function cloudflareAccountId(env: SupportEnv): string {
	return configuredValue(
		env.CLOUDFLARE_ACCOUNT_ID,
		process.env.CLOUDFLARE_ACCOUNT_ID,
	);
}

function cloudflareEmailToken(env: SupportEnv): string {
	return configuredValue(
		env.CLOUDFLARE_EMAIL_API_TOKEN,
		process.env.CLOUDFLARE_EMAIL_API_TOKEN,
	);
}

function emailConfigured(env: SupportEnv): boolean {
	return Boolean(cloudflareAccountId(env) && cloudflareEmailToken(env));
}

async function sendSupportMail(
	env: SupportEnv,
	message: {
		to: string;
		from: { address: string; name?: string };
		replyTo?: string;
		subject: string;
		text: string;
		html: string;
	},
	fetchImpl: SupportFetch,
): Promise<void> {
	await deliverSupportEmail(
		cloudflareAccountId(env),
		cloudflareEmailToken(env),
		message,
		fetchImpl,
	);
}

function fromAddress(env: SupportEnv): string {
	const raw = env.SUPPORT_FROM_EMAIL?.trim() || SUPPORT_FROM;
	if (!/^[^@\s]+@gpio-companion\.com$/i.test(raw)) {
		throw new Error("support email is not configured");
	}
	return raw;
}

function replyTo(email: string | null): string | undefined {
	const raw = email?.trim() ?? "";
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
		return undefined;
	}
	if (stripSecrets(raw) !== raw) {
		return undefined;
	}
	return raw;
}

function boardUuid(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	return UUID_RE.test(raw) ? raw.toLowerCase() : "";
}

function surfaceOf(value: unknown): SupportSurface {
	if (value === "web" || value === "desktop" || value === "mobile") {
		return value;
	}
	throw new Error("surface is required");
}

async function readStamps(kv: KVNamespace, userId: string): Promise<number[]> {
	const raw = await kv.get(`support-rate:${userId}`);
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((item) => typeof item === "number");
	} catch {
		return [];
	}
}

async function writeStamps(kv: KVNamespace, userId: string, stamps: number[]) {
	await kv.put(`support-rate:${userId}`, JSON.stringify(stamps), {
		expirationTtl: Math.ceil(SUPPORT_RATE_WINDOW_MS / 1000),
	});
}

async function consumeRate(kv: KVNamespace, userId: string, now: number) {
	const stamps = (await readStamps(kv, userId)).filter(
		(stamp) => now - stamp < SUPPORT_RATE_WINDOW_MS,
	);
	if (stamps.length >= SUPPORT_RATE_MAX) {
		throw new Error("too many bug reports");
	}
	stamps.push(now);
	await writeStamps(kv, userId, stamps);
}

async function releaseRate(kv: KVNamespace, userId: string, now: number) {
	const stamps = (await readStamps(kv, userId)).filter(
		(stamp) => stamp !== now,
	);
	await writeStamps(kv, userId, stamps);
}

export async function takeSupportSlot(
	env: SupportEnv,
	userId: string,
	now = Date.now(),
): Promise<number> {
	await consumeRate(env.DYNAMIC_PAGE_KV, userId, now);
	return now;
}

export async function refundSupportSlot(
	env: SupportEnv,
	userId: string,
	stamp: number,
): Promise<void> {
	await releaseRate(env.DYNAMIC_PAGE_KV, userId, stamp);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export async function handleSupport(input: {
	env: SupportEnv;
	userId: string;
	userEmail: string | null;
	body: SupportBody;
	now?: number;
	fetch?: SupportFetch;
}): Promise<{ sent: true }> {
	if (!emailConfigured(input.env)) {
		throw new Error("support email is not configured");
	}
	const from = fromAddress(input.env);
	const surface = surfaceOf(input.body.surface);
	const text = asTrimmed(input.body.text, TEXT_MAX);
	if (!text) {
		throw new Error("describe the bug");
	}
	if (
		typeof input.body.text === "string" &&
		stripSecrets(input.body.text).trim().length > TEXT_MAX
	) {
		throw new Error("bug report is too long");
	}
	const uuid = boardUuid(input.body.boardUuid);
	const model = asTrimmed(input.body.boardModel, MODEL_MAX);
	const userId = stripSecrets(input.userId).trim();
	if (!userId || userId !== input.userId.trim()) {
		throw new Error("sign in first");
	}
	const now = input.now ?? Date.now();
	await consumeRate(input.env.DYNAMIC_PAGE_KV, userId, now);
	const lines = [
		`User: ${userId}`,
		`Surface: ${surface}`,
		uuid ? `Board: ${uuid}${model ? ` ${model}` : ""}` : "Board: none",
		"",
		text,
	];
	const plain = lines.join("\n");
	const html = `<pre>${escapeHtml(plain)}</pre>`;
	const userReply = replyTo(input.userEmail);
	try {
		await sendSupportMail(
			input.env,
			{
				to: SUPPORT_TO,
				from: { address: from, name: "gpio-companion" },
				...(userReply ? { replyTo: userReply } : {}),
				subject: "gpio-companion bug report",
				text: plain,
				html,
			},
			input.fetch ?? fetch,
		);
	} catch {
		await releaseRate(input.env.DYNAMIC_PAGE_KV, userId, now);
		throw new Error("support email is not configured");
	}
	return { sent: true };
}

export async function supportResponse(
	handler: () => Promise<{ sent: true }>,
): Promise<Response> {
	try {
		return jsonOk(await handler());
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
