import { redactSecrets } from "./redact.ts";
import { SUPPORT_FROM, SUPPORT_TO } from "./support-mail.ts";

export const SUPPORT_CHAT_TEXT_MAX = 4000;
export const SUPPORT_CHAT_MODEL_MAX = 120;
export const SUPPORT_CHAT_MESSAGE_CAP = 20;
export const SUPPORT_OV_ROOT = "viking://resources/gpio-companion";
export const SUPPORT_OV_EXCERPT_MAX = 4000;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupportSurface = "web" | "desktop" | "mobile";
export type SupportChatRole = "user" | "agent" | "tool";
export type SupportChatStatus = "idle" | "chatting" | "completed";
export type SupportSeverity = "low" | "medium" | "high";

export type SupportChatMessage = {
	id: string;
	role: SupportChatRole;
	text: string;
	tool?: string;
};

export type SupportChatSummary = {
	title: string;
	description: string;
	steps: string[];
	expected: string;
	actual: string;
	surface: SupportSurface;
	board: string;
	severity: SupportSeverity;
	incomplete: boolean;
};

export type SupportChatToolStatus = "running" | "done" | "error";

export type SupportChatLiveTool = {
	id: string;
	name: string;
	text: string;
	status: SupportChatToolStatus;
};

export type SupportChatLive = {
	draft: string;
	tools: SupportChatLiveTool[];
};

export type SupportChatState = {
	status: SupportChatStatus;
	messages: SupportChatMessage[];
	summary?: SupportChatSummary;
	live?: SupportChatLive;
};

export type SupportChatTurn = {
	text?: string;
	surface: SupportSurface;
	locale: "en" | "fr";
	userId?: string;
	boardUuid?: string;
	boardModel?: string;
	restart?: boolean;
	mail?: {
		accountId: string;
		token: string;
		replyTo?: string;
		from?: string;
	};
};

type Listener = () => void;
const openListeners = new Set<Listener>();
let supportChatPending = false;

export function openSupportChat(): void {
	supportChatPending = true;
	for (const listener of openListeners) {
		listener();
	}
}

export function consumeSupportChatOpen(): void {
	supportChatPending = false;
}

export function onOpenSupportChat(listener: Listener): () => void {
	openListeners.add(listener);
	if (supportChatPending) {
		listener();
	}
	return () => {
		openListeners.delete(listener);
	};
}

export function supportSurface(value: unknown): SupportSurface {
	if (value === "web" || value === "desktop" || value === "mobile") {
		return value;
	}
	throw new Error("surface is required");
}

export function supportLocale(value: unknown): "en" | "fr" {
	return value === "fr" ? "fr" : "en";
}

export function supportBoardUuid(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	return UUID_RE.test(raw) ? raw.toLowerCase() : "";
}

export function supportText(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	const stripped = redactSecrets(value).trim();
	if (stripped.length > SUPPORT_CHAT_TEXT_MAX) {
		throw new Error("bug report is too long");
	}
	return stripped;
}

export function assertOvUri(value: string): string {
	const uri = value.trim().replace(/\/+$/, "");
	const root = SUPPORT_OV_ROOT;
	if (uri !== root && !uri.startsWith(`${root}/`)) {
		throw new Error("project lookup is outside gpio-companion");
	}
	if (uri.includes("..") || uri.includes("://", root.length)) {
		throw new Error("project lookup is outside gpio-companion");
	}
	return uri;
}

export type OvCall =
	| { op: "find"; query: string }
	| { op: "grep"; pattern: string; uri?: string }
	| { op: "read"; uri: string };

export function ovRequest(call: OvCall): {
	method: "GET" | "POST";
	path: string;
	body?: Record<string, unknown>;
} {
	if (call.op === "find") {
		const query = call.query.trim().slice(0, 500);
		if (!query) {
			throw new Error("project lookup needs a query");
		}
		return {
			method: "POST",
			path: "/api/v1/search/find",
			body: {
				query,
				target_uri: SUPPORT_OV_ROOT,
				limit: 5,
			},
		};
	}
	if (call.op === "grep") {
		const pattern = call.pattern.trim().slice(0, 200);
		if (!pattern) {
			throw new Error("project lookup needs a pattern");
		}
		return {
			method: "POST",
			path: "/api/v1/search/grep",
			body: {
				uri: assertOvUri(call.uri?.trim() || SUPPORT_OV_ROOT),
				pattern,
				case_insensitive: true,
				node_limit: 20,
			},
		};
	}
	return {
		method: "GET",
		path: `/api/v1/content/read?uri=${encodeURIComponent(assertOvUri(call.uri))}`,
	};
}

export function clipExcerpt(value: string): string {
	const text = redactSecrets(value).trim();
	if (text.length <= SUPPORT_OV_EXCERPT_MAX) {
		return text;
	}
	return `${text.slice(0, SUPPORT_OV_EXCERPT_MAX)}\n[truncated]`;
}

function asText(value: unknown, max: number): string {
	if (typeof value !== "string") {
		return "";
	}
	return redactSecrets(value).trim().slice(0, max);
}

function asSteps(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => asText(item, 400))
		.filter(Boolean)
		.slice(0, 12);
}

export function parseSupportSummary(
	value: unknown,
	fallback: { surface: SupportSurface; board: string },
): SupportChatSummary {
	const record =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const severity = record.severity;
	const title = asText(record.title, 120) || "gpio-companion bug report";
	const description = asText(record.description, 2000);
	if (!description) {
		throw new Error("describe the bug");
	}
	return {
		title,
		description,
		steps: asSteps(record.steps),
		expected: asText(record.expected, 800),
		actual: asText(record.actual, 800),
		surface: fallback.surface,
		board: fallback.board,
		severity:
			severity === "low" || severity === "high" || severity === "medium"
				? severity
				: "medium",
		incomplete: record.incomplete === true,
	};
}

export function supportReportId(summary: SupportChatSummary): string {
	const raw = [
		summary.title,
		summary.description,
		summary.steps.join("\n"),
		summary.expected,
		summary.actual,
		summary.surface,
		summary.board,
	].join("\n");
	let hash = 2166136261;
	for (let i = 0; i < raw.length; i++) {
		hash ^= raw.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function supportReportMail(
	summary: SupportChatSummary,
	messages: SupportChatMessage[],
	meta: { userId: string; replyTo?: string; from?: string },
): {
	to: string;
	from: { address: string; name: string };
	replyTo?: string;
	subject: string;
	text: string;
	html: string;
} {
	const id = supportReportId(summary);
	const lines = [
		`Report: ${id}`,
		`User: ${redactSecrets(meta.userId)}`,
		`Surface: ${summary.surface}`,
		`Board: ${summary.board || "none"}`,
		`Severity: ${summary.severity}`,
		summary.incomplete ? "Status: incomplete" : "Status: complete",
		"",
		`Title: ${summary.title}`,
		summary.description,
		summary.steps.length
			? `Steps:\n${summary.steps.map((step) => `- ${step}`).join("\n")}`
			: "",
		summary.expected ? `Expected: ${summary.expected}` : "",
		summary.actual ? `Actual: ${summary.actual}` : "",
		"",
		"Transcript:",
		...messages.map((message) => {
			const who = message.tool ? `tool:${message.tool}` : message.role;
			return `${who}: ${message.text}`;
		}),
	].filter((line) => line !== "");
	const text = lines.join("\n");
	const from = meta.from?.trim() || SUPPORT_FROM;
	return {
		to: SUPPORT_TO,
		from: { address: from, name: "gpio-companion" },
		...(meta.replyTo ? { replyTo: meta.replyTo } : {}),
		subject: `gpio-companion bug report: ${summary.title} [${id}]`,
		text,
		html: `<pre>${escapeHtml(text)}</pre>`,
	};
}

export function partialSummary(
	messages: SupportChatMessage[],
	fallback: { surface: SupportSurface; board: string },
): SupportChatSummary {
	const user = messages
		.filter((message) => message.role === "user")
		.map((message) => message.text)
		.join("\n\n");
	return parseSupportSummary(
		{
			title: "Incomplete bug report",
			description:
				user || "The user started a bug report and hit the message cap.",
			incomplete: true,
		},
		fallback,
	);
}

export function userMessageCount(messages: SupportChatMessage[]): number {
	return messages.filter((message) => message.role === "user").length;
}
