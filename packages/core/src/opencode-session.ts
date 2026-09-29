import { isOpencodeProxyPath, OPENCODE_PROXY_PATH } from "./opencode-server.ts";

export const OPENCODE_REPO_HEADER = "x-gpio-opencode-repo";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type OpencodePermissionResponse = "once" | "always" | "reject";

export type OpencodeClientCall = {
	uuid: string;
	repo: string;
	op:
		| "sessions"
		| "create"
		| "messages"
		| "prompt"
		| "abort"
		| "permission"
		| "question";
	sessionID?: string;
	permissionID?: string;
	requestID?: string;
	text?: string;
	response?: OpencodePermissionResponse;
	answers?: string[][];
	reject?: boolean;
};

export type OpencodeUpstreamCall = {
	method: "GET" | "POST";
	path: string;
	body?: unknown;
};

export type OpencodeSessionSummary = {
	id: string;
	title: string;
	updated: number;
};

export type OpencodeTurn = {
	id: string;
	role: "user" | "assistant";
	text: string;
};

export type OpencodePermission = {
	id: string;
	sessionID: string;
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
		suffix === "/event"
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
				body: { parts: [{ type: "text", text }] },
			};
		}
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

function textFromParts(parts: unknown[]): string {
	const lines: string[] = [];
	for (const part of parts) {
		const record = asRecord(part);
		if (!record) {
			continue;
		}
		if (record.type === "text" && typeof record.text === "string") {
			lines.push(record.text);
		} else if (record.type === "tool" && typeof record.tool === "string") {
			lines.push(`· ${record.tool}`);
		}
	}
	return lines.join("\n").slice(0, 20_000);
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
		turns.push({
			id,
			role,
			text: textFromParts(Array.isArray(record.parts) ? record.parts : []),
		});
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

function appendTurnText(
	turns: OpencodeTurn[],
	id: string,
	role: "user" | "assistant",
	delta: string,
): OpencodeTurn[] {
	const current = turns.find((item) => item.id === id);
	const text = `${current?.text ?? ""}${delta}`.slice(0, 20_000);
	return upsertTurn(turns, { id, role: current?.role ?? role, text });
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
	if (version === "v1") {
		return {
			id,
			sessionID,
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
		title:
			typeof properties.action === "string" ? properties.action : "permission",
		detail: strings(properties.resources).join("\n"),
	};
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
	return { id, sessionID, prompts };
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
			if (part.type === "text" && typeof part.text === "string") {
				return {
					...view,
					busy: true,
					turns: upsertTurn(view.turns, {
						id: messageID,
						role: "assistant",
						text: part.text,
					}),
				};
			}
			if (part.type === "tool" && typeof part.tool === "string") {
				return {
					...view,
					busy: true,
					turns: appendTurnText(
						view.turns,
						messageID,
						"assistant",
						`\n· ${part.tool}`,
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
			return {
				...view,
				busy: true,
				turns: appendTurnText(view.turns, messageID, "assistant", delta),
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
					...view.questions.filter((item) => item.id !== question.id),
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
