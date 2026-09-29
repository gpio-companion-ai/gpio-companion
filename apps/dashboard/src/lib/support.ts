import { errorStatus, jsonFail, jsonOk } from "./mobile-http.ts";

export const SUPPORT_TO = "support@gpio-companion.com";
export const SUPPORT_FROM = "noreply@gpio-companion.com";
export const SUPPORT_RATE_MAX = 5;
export const SUPPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

const TEXT_MAX = 4000;
const MODEL_MAX = 120;
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
	/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g,
	/\bgpioai\.v1\.[A-Za-z0-9._-]+/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bsk-[A-Za-z0-9_-]{16,}\b/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
	/\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/g,
	/\b(?:password|passwd|psk|api[_-]?key|secret|token|authorization|pairing[_-]?key)\s*[:=]\s*\S+/gi,
	/https?:\/\/[^\s/@]+:[^\s/@]+@/gi,
	/\b[A-Fa-f0-9]{64,}\b/g,
];

export type SupportSurface = "web" | "desktop" | "mobile";

export type SupportEmail = {
	send(message: {
		to: string;
		from: string | { email: string; name?: string };
		replyTo?: string;
		subject: string;
		text: string;
		html: string;
	}): Promise<{ messageId?: string }>;
};

export type SupportEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	EMAIL?: SupportEmail;
	SUPPORT_FROM_EMAIL?: string;
};

export type SupportBody = {
	text?: unknown;
	surface?: unknown;
	boardUuid?: unknown;
	boardModel?: unknown;
};

export function stripSecrets(value: string): string {
	let next = value;
	for (const pattern of SECRET_PATTERNS) {
		next = next.replace(pattern, (match) => {
			const labeled =
				/^((?:password|passwd|psk|api[_-]?key|secret|token|authorization|pairing[_-]?key)\s*[:=]\s*)/i.exec(
					match,
				);
			if (labeled?.[1]) {
				return `${labeled[1]}[redacted]`;
			}
			const envLabeled = /^([A-Z0-9_]+=)/.exec(match);
			if (
				envLabeled?.[1] &&
				/(?:KEY|TOKEN|SECRET|PASSWORD)/.test(envLabeled[1])
			) {
				return `${envLabeled[1]}[redacted]`;
			}
			if (/^https?:\/\//i.test(match)) {
				return match.replace(/:\/\/[^:]+:[^@]+@/, "://[redacted]@");
			}
			return "[redacted]";
		});
	}
	return next;
}

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
}): Promise<{ sent: true }> {
	const email = input.env.EMAIL;
	if (!email || typeof email.send !== "function") {
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
	try {
		await email.send({
			to: SUPPORT_TO,
			from: { email: from, name: "gpio-companion" },
			...(replyTo(input.userEmail)
				? { replyTo: replyTo(input.userEmail) }
				: {}),
			subject: "gpio-companion bug report",
			text: plain,
			html,
		});
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
