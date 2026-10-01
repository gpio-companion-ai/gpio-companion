import {
	DEFAULT_AI_MODEL,
	opencodeProviderModels,
	type ReasoningEffort,
} from "./ai-pricing.ts";
import { debugAuthQuery } from "./debug.ts";
import type { DeviceAuthHeaders } from "./device-auth.ts";
import { isOpencodeProxyPath, OPENCODE_PROXY_PATH } from "./opencode-server.ts";

export const OPENCODE_REPO_HEADER = "x-gpio-opencode-repo";
export const OPENCODE_EVENT_PREFIX = "/v1/opencode/event/";
export const OPENCODE_PROVIDER_ID = "gpio-companion";
export const OPENCODE_MODEL_KEY = "gpio-companion-code-model";
export const OPENCODE_EFFORT_KEY = "gpio-companion-code-effort";
export const OPENCODE_PERMISSION_MODE_KEY = "gpio-companion-code-permission";
export const CODE_DEFAULT_MODEL = "muse-spark-1.3-contributor-free";
export const CODE_NAV_STATE = "gpio-code";

export type CodeNav = {
	mode: "home" | "draft" | "session";
	sessionID: string;
};

export function readCodeNav(search: string): CodeNav {
	const session = new URLSearchParams(search).get("session") ?? "";
	if (session === "draft") {
		return { mode: "draft", sessionID: "" };
	}
	if (session) {
		return { mode: "session", sessionID: session };
	}
	return { mode: "home", sessionID: "" };
}

export function codeNavHref(current: string, nav: CodeNav): string {
	const url = new URL(current, "http://gpio-companion.local");
	if (nav.mode === "session" && nav.sessionID) {
		url.searchParams.set("session", nav.sessionID);
	} else if (nav.mode === "draft") {
		url.searchParams.set("session", "draft");
	} else {
		url.searchParams.delete("session");
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

function browserHistory(): History | null {
	if (
		typeof window === "undefined" ||
		typeof window.addEventListener !== "function" ||
		typeof window.history?.pushState !== "function"
	) {
		return null;
	}
	return window.history;
}

export function pushCodeNav(nav: CodeNav): void {
	const history = browserHistory();
	if (!history) {
		return;
	}
	const href = codeNavHref(window.location.href, nav);
	const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	if (href === here) {
		return;
	}
	history.pushState({ [CODE_NAV_STATE]: true }, "", href);
}

export function replaceCodeNav(nav: CodeNav): void {
	const history = browserHistory();
	if (!history) {
		return;
	}
	history.replaceState(
		nav.mode === "home" ? null : { [CODE_NAV_STATE]: true },
		"",
		codeNavHref(window.location.href, nav),
	);
}

export function codeNavBack(): boolean {
	const history = browserHistory();
	if (!history || typeof history.back !== "function") {
		return false;
	}
	const state = history.state as { [CODE_NAV_STATE]?: boolean } | null;
	if (!state?.[CODE_NAV_STATE]) {
		return false;
	}
	history.back();
	return true;
}

const CODE_ZEN_MODELS: Record<
	string,
	{ name: string; reasoning: boolean; providerID: string }
> = {
	[CODE_DEFAULT_MODEL]: {
		name: "Muse Spark 1.3 Free",
		reasoning: true,
		providerID: "opencode",
	},
};

export type { ReasoningEffort };
export { DEFAULT_AI_MODEL };

export type OpencodeModelChoice = {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type OpencodePermissionResponse = "once" | "always" | "reject";

export type OpencodePermissionMode = "ask" | "full";

export const OPENCODE_PERMISSION_MODES: readonly OpencodePermissionMode[] = [
	"ask",
	"full",
];

export function opencodePermissionMode(value: unknown): OpencodePermissionMode {
	return value === "full" ? "full" : "ask";
}

export type OpencodeClientCall = {
	uuid: string;
	repo: string;
	op:
		| "sessions"
		| "create"
		| "messages"
		| "prompt"
		| "abort"
		| "delete"
		| "permission"
		| "permissions"
		| "permission-mode"
		| "question"
		| "questions";
	sessionID?: string;
	permissionID?: string;
	requestID?: string;
	text?: string;
	model?: string;
	variant?: ReasoningEffort;
	response?: OpencodePermissionResponse;
	answers?: string[][];
	reject?: boolean;
	mode?: OpencodePermissionMode;
};

export type OpencodeUpstreamCall = {
	method: "GET" | "POST" | "DELETE";
	path: string;
	body?: unknown;
};

export type OpencodeSessionSummary = {
	id: string;
	title: string;
	updated: number;
};

export type OpencodeToolStatus = "running" | "done" | "error";

export type OpencodePart = {
	id: string;
	type: "text" | "tool";
	text: string;
	tool: string;
	status: OpencodeToolStatus;
	input?: string;
	output?: string;
};

export type OpencodeTurnBlock =
	| { type: "text"; id: string; text: string }
	| { type: "tools"; id: string; parts: OpencodePart[] };

export type OpencodeTurn = {
	id: string;
	role: "user" | "assistant";
	pending?: boolean;
	parts: OpencodePart[];
	text: string;
};

export type {
	OpencodeInline,
	OpencodeListItem,
	OpencodeMarkdown,
} from "./opencode-markdown.ts";
export { parseOpencodeMarkdown } from "./opencode-markdown.ts";

export type OpencodeSessionBucket = "today" | "yesterday" | "earlier";

export type OpencodePermission = {
	id: string;
	sessionID: string;
	callID?: string;
	title: string;
	detail: string;
};

export type OpencodeQuestionPrompt = {
	header: string;
	question: string;
	options: string[];
};

export type OpencodeQuestion = {
	id: string;
	sessionID: string;
	callID?: string;
	prompts: OpencodeQuestionPrompt[];
};

export type OpencodeView = {
	sessions: OpencodeSessionSummary[];
	sessionID: string;
	turns: OpencodeTurn[];
	busy: boolean;
	permissions: OpencodePermission[];
	questions: OpencodeQuestion[];
};

export type OpencodeSseEvent = {
	id: string;
	data: unknown;
};

function modelProviderLabel(id: string): string {
	if (CODE_ZEN_MODELS[id]) {
		return "OpenCode";
	}
	const org = id.split("/")[1] ?? "";
	if (!org) {
		return "Workers AI";
	}
	return org
		.split("-")
		.map((part) =>
			part.toLowerCase() === "ai"
				? "AI"
				: part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join(" ");
}

export function opencodeModelChoices(): OpencodeModelChoice[] {
	const zen = Object.entries(CODE_ZEN_MODELS).map(([id, model]) => ({
		id,
		name: model.name,
		provider: modelProviderLabel(id),
		reasoning: model.reasoning,
	}));
	const workers = Object.entries(opencodeProviderModels()).map(
		([id, model]) => ({
			id,
			name: model.name,
			provider: modelProviderLabel(id),
			reasoning: model.reasoning === true,
		}),
	);
	return [...zen, ...workers].sort(
		(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
	);
}

export function opencodeStoredModel(raw: string | null | undefined): string {
	const id = raw?.trim() ?? "";
	if (CODE_ZEN_MODELS[id] || opencodeProviderModels()[id]) {
		return id;
	}
	return CODE_DEFAULT_MODEL;
}

export function opencodeStoredEffort(
	raw: string | null | undefined,
): ReasoningEffort {
	if (raw === "low" || raw === "medium" || raw === "high") {
		return raw;
	}
	return "medium";
}

export function opencodeStoredPermissionMode(
	raw: string | null | undefined,
): OpencodePermissionMode {
	return raw === "full" ? "full" : "ask";
}

export function opencodePromptFields(
	model: string,
	variant: ReasoningEffort,
): { model: string; variant?: ReasoningEffort } {
	const id = opencodeStoredModel(model);
	if (!codeModelReasoning(id)) {
		return { model: id };
	}
	return { model: id, variant: opencodeStoredEffort(variant) };
}

function opencodePromptModel(call: OpencodeClientCall): {
	model?: { providerID: string; modelID: string };
	variant?: ReasoningEffort;
} {
	const id = call.model?.trim() ?? "";
	if (!id) {
		return {};
	}
	if (!CODE_ZEN_MODELS[id] && !opencodeProviderModels()[id]) {
		throw new Error("invalid model");
	}
	const model = { providerID: codeModelProvider(id), modelID: id };
	if (!codeModelReasoning(id) || call.variant === undefined) {
		return { model };
	}
	if (
		call.variant !== "low" &&
		call.variant !== "medium" &&
		call.variant !== "high"
	) {
		throw new Error("invalid effort");
	}
	return { model, variant: call.variant };
}

function codeModelProvider(id: string): string {
	return CODE_ZEN_MODELS[id]?.providerID ?? OPENCODE_PROVIDER_ID;
}

function codeModelReasoning(id: string): boolean {
	return (
		CODE_ZEN_MODELS[id]?.reasoning === true ||
		opencodeProviderModels()[id]?.reasoning === true
	);
}

export function opencodeRepoName(raw: string): string {
	const name = raw.trim();
	if (
		!REPO.test(name) ||
		name.includes("..") ||
		name === "." ||
		name === ".."
	) {
		throw new Error("invalid project");
	}
	return name;
}

export function opencodeRepoNameFromSelection(stored: string): string {
	const trimmed = stored.trim();
	const name = trimmed.includes("/")
		? trimmed.slice(trimmed.lastIndexOf("/") + 1)
		: trimmed;
	return opencodeRepoName(name);
}

export function opencodeProjectDirectory(root: string, repo: string): string {
	const name = opencodeRepoName(repo);
	const base = root.trim().replace(/\/+$/, "");
	if (!base.startsWith("/") || base.includes("..")) {
		throw new Error("invalid project");
	}
	return `${base}/${name}`;
}

export function opencodeEventPath(repo: string): string {
	return `${OPENCODE_EVENT_PREFIX}${encodeURIComponent(opencodeRepoName(repo))}`;
}

export function parseOpencodeEventPath(path: string): string | null {
	const normalized = path.replace(/\/+$/, "") || "/";
	if (!normalized.startsWith(OPENCODE_EVENT_PREFIX)) {
		return null;
	}
	const raw = normalized.slice(OPENCODE_EVENT_PREFIX.length);
	if (!raw || raw.includes("/")) {
		return null;
	}
	try {
		return opencodeRepoName(decodeURIComponent(raw));
	} catch {
		return null;
	}
}

export function opencodeEventLastId(raw: string | null | undefined): string {
	const id = (raw ?? "").trim();
	if (!id || id.length > 200 || /[\r\n\0]/.test(id)) {
		return "";
	}
	return id;
}

export function opencodeEventWsUrl(deviceUrl: string, repo: string): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	const path = opencodeEventPath(repo);
	if (origin.startsWith("https://")) {
		return `wss://${origin.slice("https://".length)}${path}`;
	}
	if (origin.startsWith("http://")) {
		return `ws://${origin.slice("http://".length)}${path}`;
	}
	return `wss://${origin}${path}`;
}

export function opencodeEventWsConnectUrl(
	deviceUrl: string,
	repo: string,
	headers: DeviceAuthHeaders,
): string {
	return `${opencodeEventWsUrl(deviceUrl, repo)}?${debugAuthQuery(headers)}`;
}

export function opencodeEventResumeUrl(
	wsUrl: string,
	lastEventId: string,
): string {
	const last = opencodeEventLastId(lastEventId);
	if (!last) {
		return wsUrl;
	}
	const url = new URL(wsUrl);
	url.searchParams.set("last", last);
	return url.toString();
}

export function opencodeEventFrame(id: string, data: unknown): string {
	return JSON.stringify({ id, data });
}

export function parseOpencodeEventFrame(
	raw: string,
): { id: string; data: unknown } | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	if (!("data" in parsed)) {
		return null;
	}
	const record = parsed as { id?: unknown; data: unknown };
	return {
		id: typeof record.id === "string" ? record.id : "",
		data: record.data,
	};
}

function opencodeId(raw: string | undefined, label: string): string {
	const id = raw?.trim() ?? "";
	if (!ID.test(id)) {
		throw new Error(`invalid ${label}`);
	}
	return id;
}

export function opencodeProxyAllows(path: string): boolean {
	if (!isOpencodeProxyPath(path)) {
		return false;
	}
	const suffix =
		path === OPENCODE_PROXY_PATH ? "/" : path.slice(OPENCODE_PROXY_PATH.length);
	return opencodeSuffixAllowed(suffix);
}

export function opencodeHealthPath(path: string): boolean {
	return path === `${OPENCODE_PROXY_PATH}/global/health`;
}

function opencodeSuffixAllowed(suffix: string): boolean {
	if (
		suffix === "/global/health" ||
		suffix === "/session" ||
		suffix === "/event" ||
		suffix === "/question" ||
		suffix === "/permission" ||
		suffix === "/permission-mode"
	) {
		return true;
	}
	const session = /^\/session\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\/.*)?$/.exec(
		suffix,
	);
	if (session) {
		const rest = session[2] ?? "";
		return (
			rest === "" ||
			rest === "/message" ||
			rest === "/prompt_async" ||
			rest === "/abort" ||
			/^\/permissions\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rest)
		);
	}
	return /^\/question\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/(reply|reject)$/.test(
		suffix,
	);
}

export function opencodeClientRequest(
	call: OpencodeClientCall,
): OpencodeUpstreamCall {
	opencodeRepoName(call.repo);
	if (!call.uuid.trim()) {
		throw new Error("uuid is required");
	}
	switch (call.op) {
		case "sessions":
			return { method: "GET", path: "/session" };
		case "create":
			return { method: "POST", path: "/session", body: {} };
		case "messages":
			return {
				method: "GET",
				path: `/session/${opencodeId(call.sessionID, "session")}/message`,
			};
		case "prompt": {
			const text = call.text?.trim() ?? "";
			if (!text) {
				throw new Error("prompt is required");
			}
			return {
				method: "POST",
				path: `/session/${opencodeId(call.sessionID, "session")}/prompt_async`,
				body: {
					parts: [{ type: "text", text }],
					...opencodePromptModel(call),
				},
			};
		}
		case "delete":
			return {
				method: "DELETE",
				path: `/session/${opencodeId(call.sessionID, "session")}`,
			};
		case "abort":
			return {
				method: "POST",
				path: `/session/${opencodeId(call.sessionID, "session")}/abort`,
				body: {},
			};
		case "permission": {
			const response = call.response;
			if (
				response !== "once" &&
				response !== "always" &&
				response !== "reject"
			) {
				throw new Error("invalid permission response");
			}
			return {
				method: "POST",
				path: `/session/${opencodeId(call.sessionID, "session")}/permissions/${opencodeId(call.permissionID, "permission")}`,
				body: { response },
			};
		}
		case "questions":
			return { method: "GET", path: "/question" };
		case "permissions":
			return { method: "GET", path: "/permission" };
		case "permission-mode": {
			if (call.mode === undefined) {
				return { method: "GET", path: "/permission-mode" };
			}
			if (call.mode !== "ask" && call.mode !== "full") {
				throw new Error("invalid permission mode");
			}
			return {
				method: "POST",
				path: "/permission-mode",
				body: { mode: call.mode },
			};
		}
		case "question": {
			const requestID = opencodeId(call.requestID, "question");
			if (call.reject) {
				return {
					method: "POST",
					path: `/question/${requestID}/reject`,
					body: {},
				};
			}
			const answers = call.answers ?? [];
			if (
				answers.length === 0 ||
				answers.some(
					(answer) =>
						!Array.isArray(answer) ||
						answer.length === 0 ||
						answer.some((label) => typeof label !== "string" || !label.trim()),
				)
			) {
				throw new Error("question answer is required");
			}
			return {
				method: "POST",
				path: `/question/${requestID}/reply`,
				body: { answers },
			};
		}
		default:
			throw new Error("opencode route is not available");
	}
}

export function scopeOpencodeSearch(options: {
	path: string;
	search: string;
	repo: string;
	projectsDir: string;
}): { search: string; directory: string } {
	if (!opencodeProxyAllows(options.path)) {
		throw new Error("opencode route is not available");
	}
	if (opencodeHealthPath(options.path)) {
		return { search: options.search, directory: "" };
	}
	const directory = opencodeProjectDirectory(options.projectsDir, options.repo);
	const params = new URLSearchParams(
		options.search.startsWith("?") ? options.search.slice(1) : options.search,
	);
	params.delete("directory");
	params.set("directory", directory);
	return { search: `?${params.toString()}`, directory };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function strings(value: unknown, limit = 4): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter(
			(item): item is string =>
				typeof item === "string" && item.trim().length > 0,
		)
		.slice(0, limit);
}

export function emptyOpencodeView(): OpencodeView {
	return {
		sessions: [],
		sessionID: "",
		turns: [],
		busy: false,
		permissions: [],
		questions: [],
	};
}

export function opencodeSessions(value: unknown): OpencodeSessionSummary[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const sessions: OpencodeSessionSummary[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record || typeof record.id !== "string") {
			continue;
		}
		const title =
			typeof record.title === "string" && record.title.trim()
				? record.title
				: record.id;
		const time = asRecord(record.time);
		sessions.push({
			id: record.id,
			title,
			updated: typeof time?.updated === "number" ? time.updated : 0,
		});
	}
	return sessions.sort((left, right) => right.updated - left.updated);
}

function toolStatus(value: unknown): OpencodeToolStatus {
	if (value === "error" || value === "failed") {
		return "error";
	}
	if (value === "completed" || value === "done" || value === "success") {
		return "done";
	}
	return "running";
}

const TOOL_INPUT_CAP = 2_000;
const TOOL_OUTPUT_CAP = 4_000;

function clipStart(value: string, cap: number): string {
	const text = value.trim();
	if (text.length <= cap) {
		return text;
	}
	return `${text.slice(0, cap)}…`;
}

function clipEnd(value: string, cap: number): string {
	const text = value.trim();
	if (text.length <= cap) {
		return text;
	}
	return `…${text.slice(text.length - cap)}`;
}

function asToolText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value == null) {
		return "";
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
}

function toolDetail(record: Record<string, unknown>): string {
	const state = asRecord(record.state);
	const title = typeof state?.title === "string" ? state.title.trim() : "";
	if (title) {
		return title.slice(0, 160);
	}
	const input = asRecord(state?.input);
	for (const key of ["command", "description", "filePath", "path", "query"]) {
		const value = input?.[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim().split("\n")[0]?.slice(0, 160) ?? "";
		}
	}
	return "";
}

function toolBody(state: Record<string, unknown> | null): {
	input?: string;
	output?: string;
} {
	const input = clipStart(asToolText(state?.input), TOOL_INPUT_CAP);
	const output = clipEnd(
		[asToolText(state?.output), asToolText(state?.error)]
			.filter(Boolean)
			.join("\n"),
		TOOL_OUTPUT_CAP,
	);
	return {
		...(input ? { input } : {}),
		...(output ? { output } : {}),
	};
}

function toolPart(id: string, record: Record<string, unknown>): OpencodePart {
	const state = asRecord(record.state);
	return {
		id,
		type: "tool",
		text: toolDetail(record),
		tool: typeof record.tool === "string" ? record.tool : "",
		status: toolStatus(state?.status),
		...toolBody(state),
	};
}

export function opencodeToolStacks(parts: OpencodePart[]): OpencodeTurnBlock[] {
	const blocks: OpencodeTurnBlock[] = [];
	let text: OpencodePart[] = [];
	let tools: OpencodePart[] = [];
	const flushText = () => {
		const joined = text
			.map((part) => part.text)
			.filter(Boolean)
			.join("\n");
		const id = text[0]?.id;
		text = [];
		if (joined && id) {
			blocks.push({ type: "text", id, text: joined });
		}
	};
	const flushTools = () => {
		const id = tools[0]?.id;
		const grouped = tools;
		tools = [];
		if (grouped.length > 0 && id) {
			blocks.push({ type: "tools", id, parts: grouped });
		}
	};
	for (const part of parts) {
		if (part.type === "tool") {
			flushText();
			tools.push(part);
			continue;
		}
		flushTools();
		if (part.text) {
			text.push(part);
		}
	}
	flushText();
	flushTools();
	return blocks;
}

// Injected OpenViking context blocks (synthetic parts from the on-device
// opencode plugin) are kept for the model but hidden from the console.
function isHiddenContextText(text: string): boolean {
	return text.includes("<openviking-context");
}

function textOf(parts: OpencodePart[]): string {
	return parts
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text)
		.join("\n")
		.slice(0, 20_000);
}

function makeTurn(
	id: string,
	role: "user" | "assistant",
	parts: OpencodePart[],
	pending = false,
): OpencodeTurn {
	return { id, role, pending, parts, text: textOf(parts) };
}

function partsFrom(raw: unknown[]): OpencodePart[] {
	const parts: OpencodePart[] = [];
	for (const [index, item] of raw.entries()) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const id = typeof record.id === "string" ? record.id : `part-${index}`;
		if (record.type === "text" && typeof record.text === "string") {
			if (isHiddenContextText(record.text)) {
				continue;
			}
			parts.push({
				id,
				type: "text",
				text: record.text,
				tool: "",
				status: "done",
			});
			continue;
		}
		if (record.type === "tool" && typeof record.tool === "string") {
			parts.push(toolPart(id, record));
		}
	}
	return parts;
}

export function opencodeTurns(value: unknown): OpencodeTurn[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const turns: OpencodeTurn[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const info = asRecord(record.info);
		const id = typeof info?.id === "string" ? info.id : "";
		const role =
			info?.role === "user" || info?.role === "assistant" ? info.role : "";
		if (!id || !role) {
			continue;
		}
		turns.push(
			makeTurn(
				id,
				role,
				partsFrom(Array.isArray(record.parts) ? record.parts : []),
			),
		);
	}
	return turns;
}

function upsertSession(
	sessions: OpencodeSessionSummary[],
	session: OpencodeSessionSummary,
): OpencodeSessionSummary[] {
	const next = sessions.filter((item) => item.id !== session.id);
	next.push(session);
	return next.sort((left, right) => right.updated - left.updated);
}

function upsertTurn(turns: OpencodeTurn[], turn: OpencodeTurn): OpencodeTurn[] {
	const index = turns.findIndex((item) => item.id === turn.id);
	if (index < 0) {
		return [...turns, turn];
	}
	const next = turns.slice();
	next[index] = turn;
	return next;
}

function upsertPart(
	turns: OpencodeTurn[],
	messageID: string,
	role: "user" | "assistant",
	part: OpencodePart,
): OpencodeTurn[] {
	const current = turns.find((item) => item.id === messageID);
	const parts = current?.parts ?? [];
	const index = parts.findIndex((item) => item.id === part.id);
	const next =
		index < 0
			? [...parts, part]
			: parts.map((item, itemIndex) => (itemIndex === index ? part : item));
	return upsertTurn(
		turns,
		makeTurn(messageID, current?.role ?? role, next, false),
	);
}

function appendTextPart(
	turns: OpencodeTurn[],
	messageID: string,
	role: "user" | "assistant",
	partID: string,
	delta: string,
): OpencodeTurn[] {
	const current = turns.find((item) => item.id === messageID);
	const existing = current?.parts.find(
		(item) => item.id === partID && item.type === "text",
	);
	const text = `${existing?.text ?? ""}${delta}`.slice(0, 20_000);
	return upsertPart(turns, messageID, role, {
		id: partID,
		type: "text",
		text,
		tool: "",
		status: "done",
	});
}

export function pendingOpencodeTurn(
	text: string,
	now = Date.now(),
): OpencodeTurn {
	const id = `local-${now}`;
	return makeTurn(
		id,
		"user",
		[{ id: `${id}:text`, type: "text", text, tool: "", status: "done" }],
		true,
	);
}

export function settleOpencodeTurns(
	current: OpencodeTurn[],
	incoming: OpencodeTurn[],
): OpencodeTurn[] {
	const pending = current.filter((turn) => turn.pending);
	const matched = new Set<string>();
	for (const turn of incoming) {
		if (turn.role !== "user") {
			continue;
		}
		const hit = pending.find(
			(item) => !matched.has(item.id) && item.text === turn.text,
		);
		if (hit) {
			matched.add(hit.id);
		}
	}
	return [...incoming, ...pending.filter((item) => !matched.has(item.id))];
}

export function opencodeSessionBucket(
	updated: number,
	now = Date.now(),
): OpencodeSessionBucket {
	if (!updated) {
		return "earlier";
	}
	const day = (value: number) => {
		const date = new Date(value);
		return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	};
	const diff = (day(now) - day(updated)) / 86_400_000;
	if (diff <= 0) {
		return "today";
	}
	if (diff === 1) {
		return "yesterday";
	}
	return "earlier";
}

function eventBody(value: unknown): {
	type: string;
	properties: Record<string, unknown>;
} | null {
	const root = asRecord(value);
	if (!root) {
		return null;
	}
	const payload = asRecord(root.payload) ?? root;
	const type = typeof payload.type === "string" ? payload.type : "";
	if (!type) {
		return null;
	}
	return { type, properties: asRecord(payload.properties) ?? {} };
}

function permissionFrom(
	properties: Record<string, unknown>,
	version: "v1" | "v2",
): OpencodePermission | null {
	const id = typeof properties.id === "string" ? properties.id : "";
	const sessionID =
		typeof properties.sessionID === "string" ? properties.sessionID : "";
	if (!id || !sessionID) {
		return null;
	}
	const callID = toolCallID(properties);
	if (version === "v1") {
		return {
			id,
			sessionID,
			...(callID ? { callID } : {}),
			title:
				typeof properties.permission === "string"
					? properties.permission
					: "permission",
			detail: strings(properties.patterns).join("\n"),
		};
	}
	return {
		id,
		sessionID,
		...(callID ? { callID } : {}),
		title:
			typeof properties.action === "string" ? properties.action : "permission",
		detail: strings(properties.resources).join("\n"),
	};
}

function toolCallID(properties: Record<string, unknown>): string {
	const tool = asRecord(properties.tool);
	const source = asRecord(properties.source);
	const callID = tool?.callID ?? source?.callID;
	return typeof callID === "string" ? callID : "";
}

function questionFrom(
	properties: Record<string, unknown>,
): OpencodeQuestion | null {
	const id = typeof properties.id === "string" ? properties.id : "";
	const sessionID =
		typeof properties.sessionID === "string" ? properties.sessionID : "";
	if (!id || !sessionID || !Array.isArray(properties.questions)) {
		return null;
	}
	const prompts: OpencodeQuestionPrompt[] = [];
	for (const item of properties.questions) {
		const record = asRecord(item);
		if (!record || typeof record.question !== "string") {
			continue;
		}
		prompts.push({
			header: typeof record.header === "string" ? record.header : "",
			question: record.question,
			options: strings(
				Array.isArray(record.options)
					? record.options.map((option) => asRecord(option)?.label)
					: [],
				8,
			),
		});
	}
	if (prompts.length === 0) {
		return null;
	}
	const callID = toolCallID(properties);
	return { id, sessionID, ...(callID ? { callID } : {}), prompts };
}

function promptID(
	part: Record<string, unknown>,
	state: Record<string, unknown> | null,
	fallback: string,
): string {
	const metadata = asRecord(state?.metadata) ?? asRecord(part.metadata);
	const requestID = metadata?.requestID ?? metadata?.id;
	if (typeof requestID === "string" && requestID) {
		return requestID;
	}
	if (typeof part.callID === "string" && part.callID) {
		return part.callID;
	}
	return fallback;
}

function waiting(status: unknown): boolean {
	return status === "pending" || status === "running";
}

export function pendingOpencodeFromMessages(
	value: unknown,
	sessionID: string,
	stored: {
		questions?: readonly OpencodeQuestion[];
		permissions?: readonly OpencodePermission[];
	} = {},
): { questions: OpencodeQuestion[]; permissions: OpencodePermission[] } {
	const list = Array.isArray(value)
		? value
		: Array.isArray(asRecord(value)?.data)
			? (asRecord(value)?.data as unknown[])
			: [];
	const questions: OpencodeQuestion[] = [];
	const permissions: OpencodePermission[] = [];
	const running = new Set<string>();
	for (const item of list) {
		const message = asRecord(item);
		const info = asRecord(message?.info);
		const messageID = typeof info?.id === "string" ? info.id : "";
		const parts = Array.isArray(message?.parts) ? message.parts : [];
		for (const partValue of parts) {
			const part = asRecord(partValue);
			if (part?.type !== "tool" || typeof part.tool !== "string") {
				continue;
			}
			const state = asRecord(part.state);
			if (!waiting(state?.status)) {
				continue;
			}
			const callID = typeof part.callID === "string" ? part.callID : "";
			if (callID) {
				running.add(callID);
			}
			if (part.tool === "question") {
				const input = asRecord(state?.input);
				const id = promptID(part, state, callID || messageID);
				const question = questionFrom({
					id,
					sessionID,
					questions: input?.questions,
					tool: callID ? { callID } : undefined,
				});
				if (question) {
					questions.push(question);
				}
			}
		}
	}
	for (const saved of stored.questions ?? []) {
		if (saved.sessionID !== sessionID) {
			continue;
		}
		const hit = questions.find(
			(item) =>
				item.id === saved.id ||
				(saved.callID && item.callID === saved.callID) ||
				item.prompts[0]?.question === saved.prompts[0]?.question,
		);
		if (hit) {
			hit.id = saved.id;
			continue;
		}
		if (saved.callID && running.has(saved.callID)) {
			questions.push(saved);
		}
	}
	for (const saved of stored.permissions ?? []) {
		if (
			saved.sessionID === sessionID &&
			saved.callID &&
			running.has(saved.callID)
		) {
			permissions.push(saved);
		}
	}
	return { questions, permissions };
}

function promptList(value: unknown): unknown[] | null {
	if (Array.isArray(value)) {
		return value;
	}
	const record = asRecord(value);
	if (record && Array.isArray(record.data)) {
		return record.data;
	}
	return null;
}

export function opencodeQuestions(value: unknown): OpencodeQuestion[] | null {
	const list = promptList(value);
	if (!list) {
		return null;
	}
	const questions: OpencodeQuestion[] = [];
	let raw = 0;
	for (const item of list) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		raw += 1;
		const question = questionFrom(record);
		if (question) {
			questions.push(question);
		}
	}
	return raw > 0 && questions.length === 0 ? null : questions;
}

export function opencodePermissions(
	value: unknown,
): OpencodePermission[] | null {
	const list = promptList(value);
	if (!list) {
		return null;
	}
	const permissions: OpencodePermission[] = [];
	let raw = 0;
	for (const item of list) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		raw += 1;
		const version =
			typeof record.action === "string" || Array.isArray(record.resources)
				? "v2"
				: "v1";
		const permission = permissionFrom(record, version);
		if (permission) {
			permissions.push(permission);
		}
	}
	return raw > 0 && permissions.length === 0 ? null : permissions;
}

export function questionStillPending(turns: readonly OpencodeTurn[]): boolean {
	return turns.some((turn) =>
		turn.parts.some(
			(part) => part.tool === "question" && part.status === "running",
		),
	);
}

export function questionToolFinished(turns: readonly OpencodeTurn[]): boolean {
	let saw = false;
	for (const turn of turns) {
		for (const part of turn.parts) {
			if (part.tool !== "question") {
				continue;
			}
			saw = true;
			if (part.status === "running") {
				return false;
			}
		}
	}
	return saw;
}

export function seedOpencodePrompts(
	view: OpencodeView,
	sessionID: string,
): OpencodeView {
	if (!sessionID) {
		return view;
	}
	const stored = readStoredOpencodePrompts(sessionID);
	const questions = view.questions.some((item) => item.sessionID === sessionID)
		? view.questions
		: [
				...view.questions.filter((item) => item.sessionID !== sessionID),
				...stored.questions,
			];
	const permissions = view.permissions.some(
		(item) => item.sessionID === sessionID,
	)
		? view.permissions
		: [
				...view.permissions.filter((item) => item.sessionID !== sessionID),
				...stored.permissions,
			];
	return { ...view, sessionID, questions, permissions };
}

export type OpencodePromptEpoch = {
	epoch: number;
	dropped: Set<string>;
};

export function noteOpencodePrompt(
	event: unknown,
	state: OpencodePromptEpoch,
): void {
	const body = eventBody(event);
	if (
		!body ||
		(!body.type.startsWith("permission.") && !body.type.startsWith("question."))
	) {
		return;
	}
	state.epoch += 1;
	if (body.type.endsWith(".replied") || body.type.endsWith(".rejected")) {
		const id =
			typeof body.properties.requestID === "string"
				? body.properties.requestID
				: "";
		if (id) {
			state.dropped.add(id);
		}
	}
}

export function restoreOpencodePrompts<
	T extends { id: string; sessionID: string },
>(
	current: readonly T[],
	pending: readonly T[],
	sessionID: string,
	stale: boolean,
	dropped: ReadonlySet<string> = new Set(),
): T[] {
	const next = pending.filter(
		(item) => item.sessionID === sessionID && !dropped.has(item.id),
	);
	const others = current.filter((item) => item.sessionID !== sessionID);
	const mine = current.filter((item) => item.sessionID === sessionID);
	if (stale) {
		const ids = new Set(mine.map((item) => item.id));
		return [...others, ...mine, ...next.filter((item) => !ids.has(item.id))];
	}
	return [...others, ...next];
}

export function restoreOpencodeViewPrompts(
	view: OpencodeView,
	sessionID: string,
	snapshot: {
		questions?: unknown;
		permissions?: unknown;
		stale: boolean;
		dropped: ReadonlySet<string>;
	},
): OpencodeView {
	if (view.sessionID !== sessionID) {
		return view;
	}
	const questions =
		snapshot.questions === undefined
			? null
			: opencodeQuestions(snapshot.questions);
	const permissions =
		snapshot.permissions === undefined
			? null
			: opencodePermissions(snapshot.permissions);
	return {
		...view,
		questions:
			questions == null
				? view.questions
				: restoreOpencodePrompts(
						view.questions,
						questions ?? [],
						sessionID,
						snapshot.stale,
						snapshot.dropped,
					),
		permissions:
			permissions == null
				? view.permissions
				: restoreOpencodePrompts(
						view.permissions,
						permissions ?? [],
						sessionID,
						snapshot.stale,
						snapshot.dropped,
					),
	};
}

export function opencodeReplyAccepted(data: unknown): boolean {
	if (data == null) {
		return false;
	}
	const record = asRecord(data);
	if (!record) {
		return true;
	}
	if (typeof record.error === "string" && record.error.trim()) {
		return false;
	}
	if (record.ok === false) {
		return false;
	}
	return true;
}

export function opencodePromptDropID(event: unknown): string {
	const write = opencodePromptWrite(event);
	return write?.op === "drop" ? write.id : "";
}

export function holdOpencodePromptEvent(
	event: unknown,
	held: ReadonlySet<string>,
): boolean {
	const id = opencodePromptDropID(event);
	return id !== "" && held.has(id);
}

function dedupeSessionPrompts<T extends { id: string; sessionID: string }>(
	items: readonly T[],
	sessionID: string,
): T[] {
	const seen = new Set<string>();
	const next: T[] = [];
	for (const item of items) {
		if (item.sessionID !== sessionID || seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		next.push(item);
	}
	return next;
}

export function recoverOpencodePrompts(
	view: OpencodeView,
	sessionID: string,
	input: {
		questions?: unknown;
		permissions?: unknown;
		messages?: unknown;
	},
): OpencodeView {
	if (!sessionID || view.sessionID !== sessionID) {
		return view;
	}
	const stored = readStoredOpencodePrompts(sessionID);
	const fromMessages =
		input.messages === undefined
			? null
			: pendingOpencodeFromMessages(input.messages, sessionID, stored);
	const listedQuestions =
		input.questions === undefined ? null : opencodeQuestions(input.questions);
	const listedPermissions =
		input.permissions === undefined
			? null
			: opencodePermissions(input.permissions);
	return {
		...view,
		questions: mergeOpencodeQuestions(
			view.questions,
			[...(listedQuestions ?? []), ...(fromMessages?.questions ?? [])],
			sessionID,
		),
		permissions: [
			...view.permissions.filter((item) => item.sessionID !== sessionID),
			...dedupeSessionPrompts(
				[
					...view.permissions.filter((item) => item.sessionID === sessionID),
					...(listedPermissions ?? []),
					...(fromMessages?.permissions ?? []),
				],
				sessionID,
			),
		],
	};
}

export function releaseSettledPromptHolds(
	held: Set<string>,
	view: OpencodeView,
	sessionID: string,
): void {
	for (const id of [...held]) {
		const live =
			view.questions.some(
				(item) =>
					item.sessionID === sessionID &&
					(item.id === id || item.callID === id),
			) ||
			view.permissions.some(
				(item) =>
					item.sessionID === sessionID &&
					(item.id === id || item.callID === id),
			);
		if (!live) {
			held.delete(id);
		}
	}
}

const PROMPT_STORE_KEY = "gpio-companion-code-prompts";

type StoredPromptBook = Record<
	string,
	{ questions: OpencodeQuestion[]; permissions: OpencodePermission[] }
>;

function promptStores(): Storage[] {
	const stores: Storage[] = [];
	for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
		try {
			if (storage) {
				stores.push(storage);
			}
		} catch {}
	}
	return stores;
}

function storedQuestion(value: unknown): OpencodeQuestion | null {
	const record = asRecord(value);
	if (
		!record ||
		typeof record.id !== "string" ||
		typeof record.sessionID !== "string" ||
		!Array.isArray(record.prompts)
	) {
		return null;
	}
	const prompts: OpencodeQuestionPrompt[] = [];
	for (const item of record.prompts) {
		const prompt = asRecord(item);
		if (!prompt || typeof prompt.question !== "string") {
			continue;
		}
		prompts.push({
			header: typeof prompt.header === "string" ? prompt.header : "",
			question: prompt.question,
			options: strings(prompt.options, 8),
		});
	}
	if (prompts.length === 0) {
		return null;
	}
	const callID = typeof record.callID === "string" ? record.callID : "";
	return {
		id: record.id,
		sessionID: record.sessionID,
		...(callID ? { callID } : {}),
		prompts,
	};
}

function storedPermission(value: unknown): OpencodePermission | null {
	const record = asRecord(value);
	if (
		!record ||
		typeof record.id !== "string" ||
		typeof record.sessionID !== "string" ||
		typeof record.title !== "string"
	) {
		return null;
	}
	const callID = typeof record.callID === "string" ? record.callID : "";
	return {
		id: record.id,
		sessionID: record.sessionID,
		...(callID ? { callID } : {}),
		title: record.title,
		detail: typeof record.detail === "string" ? record.detail : "",
	};
}

function parsePromptBook(raw: string | null): StoredPromptBook {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw ?? "");
	} catch {
		return {};
	}
	const record = asRecord(parsed);
	if (!record) {
		return {};
	}
	const book: StoredPromptBook = {};
	for (const [sessionID, value] of Object.entries(record)) {
		const item = asRecord(value);
		if (!item) {
			continue;
		}
		const questions = Array.isArray(item.questions)
			? item.questions.flatMap((entry) => {
					const question = storedQuestion(entry);
					return question ? [question] : [];
				})
			: [];
		const permissions = Array.isArray(item.permissions)
			? item.permissions.flatMap((entry) => {
					const permission = storedPermission(entry);
					return permission ? [permission] : [];
				})
			: [];
		if (questions.length > 0 || permissions.length > 0) {
			book[sessionID] = { questions, permissions };
		}
	}
	return book;
}

function readPromptBook(): StoredPromptBook {
	for (const storage of promptStores()) {
		const book = parsePromptBook(storage.getItem(PROMPT_STORE_KEY));
		if (Object.keys(book).length > 0) {
			return book;
		}
	}
	return {};
}

function writePromptBook(book: StoredPromptBook): void {
	const raw = JSON.stringify(book);
	for (const storage of promptStores()) {
		try {
			if (Object.keys(book).length === 0) {
				storage.removeItem(PROMPT_STORE_KEY);
			} else {
				storage.setItem(PROMPT_STORE_KEY, raw);
			}
		} catch {}
	}
}

export function readStoredOpencodePrompts(sessionID: string): {
	questions: OpencodeQuestion[];
	permissions: OpencodePermission[];
} {
	if (!sessionID) {
		return { questions: [], permissions: [] };
	}
	const stored = readPromptBook()[sessionID];
	return stored ?? { questions: [], permissions: [] };
}

export function storeOpencodePrompts(
	sessionID: string,
	questions: readonly OpencodeQuestion[],
	permissions: readonly OpencodePermission[],
): void {
	if (!sessionID) {
		return;
	}
	const book = readPromptBook();
	const nextQuestions = questions.filter(
		(item) => item.sessionID === sessionID,
	);
	const nextPermissions = permissions.filter(
		(item) => item.sessionID === sessionID,
	);
	if (nextQuestions.length === 0 && nextPermissions.length === 0) {
		delete book[sessionID];
	} else {
		book[sessionID] = {
			questions: nextQuestions,
			permissions: nextPermissions,
		};
	}
	writePromptBook(book);
}

export function rememberOpencodePrompt(event: unknown): void {
	const body = eventBody(event);
	if (
		!body ||
		(!body.type.startsWith("permission.") && !body.type.startsWith("question."))
	) {
		return;
	}
	const sessionID =
		typeof body.properties.sessionID === "string"
			? body.properties.sessionID
			: "";
	if (!sessionID) {
		return;
	}
	const stored = readStoredOpencodePrompts(sessionID);
	const next = applyOpencodeEvent(
		{
			...emptyOpencodeView(),
			sessionID,
			questions: stored.questions,
			permissions: stored.permissions,
		},
		event,
	);
	storeOpencodePrompts(sessionID, next.questions, next.permissions);
}

export type OpencodePromptSave = {
	op: "save";
	kind: "question" | "permission";
	id: string;
	sessionID: string;
	body: Record<string, unknown>;
};

export type OpencodePromptDrop = { op: "drop"; id: string };

export function opencodePromptWrite(
	event: unknown,
): OpencodePromptSave | OpencodePromptDrop | null {
	const body = eventBody(event);
	if (!body) {
		return null;
	}
	if (
		body.type === "question.replied" ||
		body.type === "question.rejected" ||
		body.type === "question.v2.replied" ||
		body.type === "question.v2.rejected" ||
		body.type === "permission.replied" ||
		body.type === "permission.v2.replied"
	) {
		const id =
			typeof body.properties.requestID === "string"
				? body.properties.requestID
				: "";
		return id ? { op: "drop", id } : null;
	}
	if (body.type === "question.asked" || body.type === "question.v2.asked") {
		const question = questionFrom(body.properties);
		if (!question) {
			return null;
		}
		return {
			op: "save",
			kind: "question",
			id: question.id,
			sessionID: question.sessionID,
			body: body.properties,
		};
	}
	if (body.type === "permission.asked" || body.type === "permission.v2.asked") {
		const permission = permissionFrom(
			body.properties,
			body.type === "permission.asked" ? "v1" : "v2",
		);
		if (!permission) {
			return null;
		}
		return {
			op: "save",
			kind: "permission",
			id: permission.id,
			sessionID: permission.sessionID,
			body: body.properties,
		};
	}
	return null;
}

export function applyOpencodeEvent(
	view: OpencodeView,
	event: unknown,
): OpencodeView {
	const body = eventBody(event);
	if (!body) {
		return view;
	}
	const properties = body.properties;
	const sessionID =
		typeof properties.sessionID === "string" ? properties.sessionID : "";
	const listEvent =
		body.type === "session.created" ||
		body.type === "session.updated" ||
		body.type === "session.deleted";
	const promptEvent =
		body.type.startsWith("permission.") || body.type.startsWith("question.");
	if (
		sessionID &&
		view.sessionID &&
		sessionID !== view.sessionID &&
		!listEvent &&
		!promptEvent
	) {
		return view;
	}
	switch (body.type) {
		case "session.created":
		case "session.updated": {
			const info = asRecord(properties.info);
			const sessions = opencodeSessions(info ? [info] : []);
			const session = sessions[0];
			if (!session) {
				return view;
			}
			return { ...view, sessions: upsertSession(view.sessions, session) };
		}
		case "session.deleted": {
			const id =
				typeof properties.sessionID === "string" ? properties.sessionID : "";
			return {
				...view,
				sessions: view.sessions.filter((item) => item.id !== id),
				sessionID: view.sessionID === id ? "" : view.sessionID,
				turns: view.sessionID === id ? [] : view.turns,
			};
		}
		case "session.status": {
			const status = asRecord(properties.status);
			if (!sessionID || sessionID !== view.sessionID) {
				return view;
			}
			return { ...view, busy: status?.type === "busy" };
		}
		case "session.idle":
			return sessionID === view.sessionID ? { ...view, busy: false } : view;
		case "message.part.updated": {
			const part = asRecord(properties.part);
			if (!part || sessionID !== view.sessionID) {
				return view;
			}
			const messageID =
				typeof part.messageID === "string" ? part.messageID : "";
			if (!messageID) {
				return view;
			}
			const echoed =
				part.type === "text" && typeof part.text === "string" ? part.text : "";
			if (echoed && isHiddenContextText(echoed)) {
				return view;
			}
			if (echoed) {
				const pending = view.turns.find(
					(turn) => turn.pending && turn.text === echoed,
				);
				if (pending) {
					return {
						...view,
						busy: true,
						turns: view.turns.map((turn) =>
							turn.id === pending.id
								? makeTurn(
										messageID,
										"user",
										[
											{
												id:
													typeof part.id === "string"
														? part.id
														: `${messageID}:text`,
												type: "text",
												text: echoed,
												tool: "",
												status: "done",
											},
										],
										false,
									)
								: turn,
						),
					};
				}
				return {
					...view,
					busy: true,
					turns: upsertPart(view.turns, messageID, "assistant", {
						id: typeof part.id === "string" ? part.id : `${messageID}:text`,
						type: "text",
						text: echoed,
						tool: "",
						status: "done",
					}),
				};
			}
			if (part.type === "tool" && typeof part.tool === "string") {
				return {
					...view,
					busy: true,
					turns: upsertPart(
						view.turns,
						messageID,
						"assistant",
						toolPart(
							typeof part.id === "string" ? part.id : `${messageID}:tool`,
							part,
						),
					),
				};
			}
			return view;
		}
		case "message.part.delta":
		case "session.next.text.delta": {
			if (sessionID !== view.sessionID) {
				return view;
			}
			const messageID =
				typeof properties.messageID === "string"
					? properties.messageID
					: typeof properties.assistantMessageID === "string"
						? properties.assistantMessageID
						: "";
			const delta =
				typeof properties.delta === "string" ? properties.delta : "";
			if (!messageID || !delta) {
				return view;
			}
			const partID =
				typeof properties.partID === "string" ? properties.partID : messageID;
			return {
				...view,
				busy: true,
				turns: appendTextPart(
					view.turns,
					messageID,
					"assistant",
					partID,
					delta,
				),
			};
		}
		case "permission.asked":
		case "permission.v2.asked": {
			const permission = permissionFrom(
				properties,
				body.type === "permission.asked" ? "v1" : "v2",
			);
			if (!permission) {
				return view;
			}
			return {
				...view,
				permissions: [
					...view.permissions.filter((item) => item.id !== permission.id),
					permission,
				],
			};
		}
		case "permission.replied":
		case "permission.v2.replied": {
			const requestID =
				typeof properties.requestID === "string" ? properties.requestID : "";
			return {
				...view,
				permissions: view.permissions.filter((item) => item.id !== requestID),
			};
		}
		case "question.asked":
		case "question.v2.asked": {
			const question = questionFrom(properties);
			if (!question) {
				return view;
			}
			return {
				...view,
				questions: [
					...view.questions.filter(
						(item) => !coversOpencodeQuestion(question, item),
					),
					question,
				],
			};
		}
		case "question.replied":
		case "question.rejected":
		case "question.v2.replied":
		case "question.v2.rejected": {
			const requestID =
				typeof properties.requestID === "string" ? properties.requestID : "";
			return {
				...view,
				questions: view.questions.filter((item) => item.id !== requestID),
			};
		}
		default:
			return view;
	}
}

export function parseOpencodeSse(buffer: string): {
	events: OpencodeSseEvent[];
	rest: string;
} {
	const parts = buffer.split(/\n\n/);
	const rest = parts.pop() ?? "";
	const events: OpencodeSseEvent[] = [];
	for (const block of parts) {
		if (!block.trim()) {
			continue;
		}
		let id = "";
		const dataLines: string[] = [];
		for (const line of block.split("\n")) {
			if (line.startsWith("id:")) {
				id = line.slice(3).trim();
			}
			if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).trimStart());
			}
		}
		if (dataLines.length === 0) {
			continue;
		}
		const raw = dataLines.join("\n");
		try {
			events.push({ id, data: JSON.parse(raw) as unknown });
		} catch {
			events.push({ id, data: { type: "text", text: raw } });
		}
	}
	return { events, rest };
}

export type CodeRepo = { owner: string; name: string };

export function parseStoredCodeRepo(
	stored: string | null | undefined,
): CodeRepo {
	const trimmed = (stored ?? "").trim();
	if (!trimmed) {
		return { owner: "", name: "" };
	}
	if (trimmed.includes("/")) {
		const index = trimmed.lastIndexOf("/");
		return {
			owner: trimmed.slice(0, index).trim(),
			name: trimmed.slice(index + 1).trim(),
		};
	}
	return { owner: "", name: trimmed };
}

export function matchCodeRepo(
	repos: readonly CodeRepo[],
	stored: string | null | undefined,
): string {
	if (repos.length === 0) {
		return "";
	}
	const parsed = parseStoredCodeRepo(stored);
	if (parsed.owner && parsed.name) {
		const exact = repos.find(
			(item) => item.name === parsed.name && item.owner === parsed.owner,
		);
		if (exact) {
			return exact.name;
		}
	}
	if (parsed.name) {
		const byName = repos.find((item) => item.name === parsed.name);
		if (byName) {
			return byName.name;
		}
	}
	return repos[0]?.name ?? "";
}

export function codeRepoOwner(
	repos: readonly CodeRepo[],
	name: string,
): string {
	return repos.find((item) => item.name === name)?.owner ?? "";
}

export function codeRepoLabel(repo: CodeRepo): string {
	return repo.owner ? `${repo.owner}/${repo.name}` : repo.name;
}

export function filterCodeSessions(
	sessions: readonly OpencodeSessionSummary[],
	query: string,
): OpencodeSessionSummary[] {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return [...sessions];
	}
	return sessions.filter((item) => item.title.toLowerCase().includes(needle));
}

export function codeScrollKey(
	turns: readonly { text: string }[],
	permissions: readonly unknown[],
	questions: readonly unknown[],
): number {
	return (
		turns.length +
		(turns.at(-1)?.text.length ?? 0) +
		permissions.length +
		questions.length
	);
}

export function pruneCodePromptState<T>(
	state: Record<string, T>,
	prompts: readonly { question: string }[],
): Record<string, T> {
	const keep = new Set(prompts.map((item) => item.question));
	const next: Record<string, T> = {};
	for (const [key, value] of Object.entries(state)) {
		if (keep.has(key) && value !== undefined) {
			next[key] = value;
		}
	}
	return next;
}

export function pruneCodeAnswers(
	answers: Record<string, string>,
	prompts: readonly { question: string }[],
): Record<string, string> {
	return pruneCodePromptState(answers, prompts);
}

export function codeQuestionSlideIndex(
	index: number,
	count: number,
	delta: number,
): number {
	if (!Number.isFinite(count) || count <= 1) {
		return 0;
	}
	const base = Number.isFinite(index) ? Math.trunc(index) : 0;
	const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
	return Math.min(count - 1, Math.max(0, base + step));
}

export function codeQuestionChoice(
	options: readonly string[],
	index: number,
): string {
	if (options.length === 0) {
		return "";
	}
	return options[codeQuestionSlideIndex(index, options.length, 0)] ?? "";
}

export function codeQuestionAnswer(
	option: string | undefined,
	custom: string,
): string {
	const typed = custom.trim();
	if (typed) {
		return typed;
	}
	return option?.trim() ?? "";
}

export function activeOpencodeQuestion(
	questions: readonly OpencodeQuestion[],
	sessionID: string,
): OpencodeQuestion | undefined {
	const mine = questions.filter((item) => item.sessionID === sessionID);
	return mine.find((item) => item.id.startsWith("que")) ?? mine[0];
}

export function matchOpencodeQuestionID(
	question: {
		id: string;
		sessionID: string;
		callID?: string;
		prompts: readonly { question: string }[];
	},
	pending: readonly OpencodeQuestion[],
): string {
	if (question.id.startsWith("que")) {
		return question.id;
	}
	const text = question.prompts[0]?.question ?? "";
	const hit = pending.find(
		(item) =>
			item.id.startsWith("que") &&
			item.sessionID === question.sessionID &&
			((question.callID && item.callID === question.callID) ||
				(text !== "" && item.prompts[0]?.question === text)),
	);
	return hit?.id ?? "";
}

function coversOpencodeQuestion(
	real: OpencodeQuestion,
	other: OpencodeQuestion,
): boolean {
	if (real.id === other.id) {
		return true;
	}
	if (real.sessionID !== other.sessionID) {
		return false;
	}
	if (real.callID && other.callID && real.callID === other.callID) {
		return true;
	}
	const text = real.prompts[0]?.question ?? "";
	return text !== "" && other.prompts[0]?.question === text;
}

export function mergeOpencodeQuestions(
	current: readonly OpencodeQuestion[],
	incoming: readonly OpencodeQuestion[],
	sessionID: string,
): OpencodeQuestion[] {
	const others = current.filter((item) => item.sessionID !== sessionID);
	const kept = current.filter(
		(item) => item.sessionID === sessionID && item.id.startsWith("que"),
	);
	const next = incoming.filter((item) => item.sessionID === sessionID);
	const merged = [...kept];
	for (const item of next) {
		if (merged.some((have) => coversOpencodeQuestion(have, item))) {
			continue;
		}
		if (item.id.startsWith("que")) {
			merged.push(item);
		}
	}
	if (merged.length > 0) {
		return [...others, ...merged];
	}
	return [...others, ...next];
}

export function clearCodeAnswers(): Record<string, string> {
	return {};
}

export function codeSessionTitle(
	sessions: readonly OpencodeSessionSummary[],
	sessionID: string,
	fallback: string,
): string {
	return sessions.find((item) => item.id === sessionID)?.title || fallback;
}

export async function readOpencodeEventStream(
	response: Response,
	onEvent: (data: unknown, id: string) => void,
	signal?: AbortSignal,
): Promise<void> {
	const body = response.body;
	if (!body) {
		const parsed = parseOpencodeSse(`${await response.text()}\n\n`);
		for (const event of parsed.events) {
			onEvent(event.data, event.id);
		}
		return;
	}
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let last = "";
	const abort = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		while (!signal?.aborted) {
			const next = await reader.read();
			if (next.done) {
				break;
			}
			buffer += decoder.decode(next.value, { stream: true });
			const parsed = parseOpencodeSse(buffer);
			buffer = parsed.rest;
			for (const event of parsed.events) {
				if (event.id) {
					last = event.id;
				}
				onEvent(event.data, event.id || last);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abort);
	}
}
