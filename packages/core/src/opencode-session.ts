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

export type OpencodeToolStatus = "running" | "done" | "error";

export type OpencodePart = {
	id: string;
	type: "text" | "tool";
	text: string;
	tool: string;
	status: OpencodeToolStatus;
};

export type OpencodeTurn = {
	id: string;
	role: "user" | "assistant";
	pending?: boolean;
	parts: OpencodePart[];
	text: string;
};

export type OpencodeBlock =
	| { type: "paragraph"; text: string }
	| { type: "code"; text: string }
	| { type: "list"; items: string[] };

export type OpencodeSessionBucket = "today" | "yesterday" | "earlier";

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

function toolStatus(value: unknown): OpencodeToolStatus {
	if (value === "error" || value === "failed") {
		return "error";
	}
	if (value === "completed" || value === "done" || value === "success") {
		return "done";
	}
	return "running";
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
			const state = asRecord(record.state);
			parts.push({
				id,
				type: "tool",
				text: toolDetail(record),
				tool: record.tool,
				status: toolStatus(state?.status),
			});
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

export function formatOpencodeBlocks(source: string): OpencodeBlock[] {
	const blocks: OpencodeBlock[] = [];
	const text = source.replace(/\r\n/g, "\n");
	let last = 0;
	for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
		const index = match.index ?? 0;
		pushOpencodeProse(blocks, text.slice(last, index));
		const code = (match[1] ?? "").replace(/\n$/, "");
		if (code) {
			blocks.push({ type: "code", text: code });
		}
		last = index + match[0].length;
	}
	pushOpencodeProse(blocks, text.slice(last));
	return blocks;
}

function pushOpencodeProse(blocks: OpencodeBlock[], raw: string) {
	const paragraph: string[] = [];
	const list: string[] = [];
	const flushParagraph = () => {
		const text = paragraph.join(" ").trim();
		paragraph.length = 0;
		if (text) {
			blocks.push({ type: "paragraph", text });
		}
	};
	const flushList = () => {
		if (list.length > 0) {
			blocks.push({ type: "list", items: list.slice() });
			list.length = 0;
		}
	};
	for (const line of raw.split("\n")) {
		const item = /^[-*]\s+(.+)$/.exec(line) ?? /^\d+\.\s+(.+)$/.exec(line);
		if (item?.[1]) {
			flushParagraph();
			list.push(item[1]);
			continue;
		}
		if (!line.trim()) {
			flushParagraph();
			flushList();
			continue;
		}
		flushList();
		paragraph.push(line.trim());
	}
	flushParagraph();
	flushList();
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
			const echoed =
				part.type === "text" && typeof part.text === "string" ? part.text : "";
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
				const state = asRecord(part.state);
				return {
					...view,
					busy: true,
					turns: upsertPart(view.turns, messageID, "assistant", {
						id: typeof part.id === "string" ? part.id : `${messageID}:tool`,
						type: "tool",
						text: toolDetail(part),
						tool: part.tool,
						status: toolStatus(state?.status),
					}),
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
