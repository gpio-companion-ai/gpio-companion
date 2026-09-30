import { applyMarkup, DEFAULT_AI_MARKUP, usdToMicros } from "./ai-pricing.ts";
import {
	BOARD_FILE_TEXT_MAX,
	BOARD_UPLOAD_BINARY_MAX,
	BOARD_UPLOAD_DIR,
	boardFileKindFromName,
	decodeBase64,
	encodeBase64,
} from "./board-files.ts";

export const CODE_UPLOAD_DIR = BOARD_UPLOAD_DIR;
export const CODE_UPLOAD_BINARY_MAX = BOARD_UPLOAD_BINARY_MAX;
export const CODE_STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const CODE_STT_USD_PER_MINUTE = 0.0005;
export const CODE_STT_MAX_MS = 60_000;
export const CODE_STT_MAX_BYTES = 8 * 1024 * 1024;
export const CODE_ATTACH_ACCEPT =
	".c,.h,.hh,.hpp,.cc,.cpp,.cxx,.ino,.txt,.text,.md,.markdown,.ts,.tsx,.mts,.cts,.js,.jsx,.mjs,.cjs,.json,.css,.scss,.html,.htm,.yml,.yaml,.toml,.xml,.svg,.py,.sh,.bash,.rs,.go,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf";

const UPLOAD_BINARY = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf"]);

export type ExplorerPick = {
	path: string;
	type: "file" | "dir";
};

export function explorerCreateDir(picked: ExplorerPick | null): string {
	if (!picked?.path) {
		return "";
	}
	if (picked.type === "dir") {
		return picked.path;
	}
	const index = picked.path.lastIndexOf("/");
	return index < 0 ? "" : picked.path.slice(0, index);
}

export type CodeAttachKind = "text" | "binary";
export type CodeAttachUse = "project" | "context";
export type CodeAttachSource = "upload" | "board";
export const CODE_CONTEXT_TEXT_MAX = 32 * 1024;
export const CODE_MENTION_LIMIT = 8;

export type CodeAttachDraft = {
	id: string;
	name: string;
	path: string;
	kind: CodeAttachKind;
	use: CodeAttachUse;
	source?: CodeAttachSource;
	text?: string;
	base64?: string;
};

export type CodeMention = {
	start: number;
	end: number;
	query: string;
};

export function codeAttachKind(name: string): CodeAttachKind | null {
	const ext = extensionOf(name);
	if (UPLOAD_BINARY.has(ext)) {
		return "binary";
	}
	if (boardFileKindFromName(name) === "text") {
		return "text";
	}
	return null;
}

export function codeAttachFileName(raw: string): string {
	const base = raw.split(/[/\\]/).pop()?.trim() ?? "";
	const cleaned = base
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/\.{2,}/g, ".")
		.replace(/^-+|-+$/g, "")
		.replace(/^\.+/, "")
		.slice(0, 80);
	if (!cleaned || !codeAttachKind(cleaned)) {
		throw new Error("file type is not allowed");
	}
	return cleaned;
}

export function codeAttachPath(
	filename: string,
	taken: readonly string[],
): string {
	const name = codeAttachFileName(filename);
	const dot = name.lastIndexOf(".");
	const stem = name.slice(0, dot);
	const ext = name.slice(dot);
	const used = new Set(taken);
	let candidate = `${CODE_UPLOAD_DIR}/${name}`;
	let n = 2;
	while (used.has(candidate)) {
		candidate = `${CODE_UPLOAD_DIR}/${stem}-${n}${ext}`;
		n += 1;
		if (n > 100) {
			throw new Error("file type is not allowed");
		}
	}
	return candidate;
}

export function stageCodeAttach(input: {
	filename: string;
	bytes: Uint8Array;
	taken: readonly string[];
	id?: string;
}): CodeAttachDraft {
	const name = codeAttachFileName(input.filename);
	const kind = codeAttachKind(name);
	if (!kind) {
		throw new Error("file type is not allowed");
	}
	const limit = kind === "text" ? BOARD_FILE_TEXT_MAX : CODE_UPLOAD_BINARY_MAX;
	if (input.bytes.byteLength > limit) {
		throw new Error("file is too large");
	}
	const path = codeAttachPath(name, input.taken);
	const id = input.id?.trim() || newId();
	if (kind === "text") {
		let text = "";
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
		} catch {
			throw new Error("file is not text");
		}
		if (text.includes("\0")) {
			throw new Error("file is not text");
		}
		return { id, name, path, kind, use: "project", text };
	}
	return {
		id,
		name,
		path,
		kind,
		use: "project",
		base64: encodeBase64(input.bytes),
	};
}

export function stageExplorerFile(input: {
	dir: string;
	filename: string;
	bytes: Uint8Array;
	taken: readonly string[];
	id?: string;
}): CodeAttachDraft {
	const name = codeAttachFileName(input.filename);
	const kind = codeAttachKind(name);
	if (!kind) {
		throw new Error("file type is not allowed");
	}
	const limit = kind === "text" ? BOARD_FILE_TEXT_MAX : CODE_UPLOAD_BINARY_MAX;
	if (input.bytes.byteLength > limit) {
		throw new Error("file is too large");
	}
	const path = explorerPath(input.dir, name, input.taken);
	const id = input.id?.trim() || newId();
	if (kind === "text") {
		let text = "";
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
		} catch {
			throw new Error("file is not text");
		}
		if (text.includes("\0")) {
			throw new Error("file is not text");
		}
		return { id, name, path, kind, use: "project", text };
	}
	return {
		id,
		name,
		path,
		kind,
		use: "project",
		base64: encodeBase64(input.bytes),
	};
}

export function codeAttachPrompt(
	text: string,
	files: readonly (string | CodeAttachDraft)[],
): string {
	const body = text.trim();
	const drafts = files.map(asAttach);
	const saved = drafts.filter((file) => file.use !== "context" && file.path);
	const context = drafts.filter((file) => file.use === "context");
	const parts: string[] = [];
	if (body) {
		parts.push(body);
	}
	if (saved.length > 0) {
		parts.push(
			`Attached files on this board:\n${saved.map((file) => `- ${file.path}`).join("\n")}`,
		);
	}
	for (const file of context) {
		if (file.kind !== "text" || typeof file.text !== "string") {
			throw new Error("context file must be text");
		}
		if (
			new TextEncoder().encode(file.text).byteLength > CODE_CONTEXT_TEXT_MAX
		) {
			throw new Error("file is too large");
		}
		parts.push(
			file.source === "board"
				? `Project file ${file.path}:\n\`\`\`\n${file.text}\n\`\`\``
				: `Context only, not saved on the board — ${file.name}:\n\`\`\`\n${file.text}\n\`\`\``,
		);
	}
	return parts.join("\n\n");
}

export function codeMentionAt(
	text: string,
	cursor: number,
): CodeMention | null {
	const at = Math.max(0, Math.min(cursor, text.length));
	const before = text.slice(0, at);
	let start = 0;
	for (let i = before.length - 1; i >= 0; i -= 1) {
		const char = before[i];
		if (char === " " || char === "\n" || char === "\t") {
			start = i + 1;
			break;
		}
	}
	const token = before.slice(start);
	if (!token.startsWith("@")) {
		return null;
	}
	return { start, end: at, query: token.slice(1) };
}

export function applyCodeMention(text: string, mention: CodeMention): string {
	return `${text.slice(0, mention.start)}${text.slice(mention.end)}`;
}

export function filterCodeMentions(
	paths: readonly string[],
	query: string,
	limit = CODE_MENTION_LIMIT,
): string[] {
	const needle = query.trim().toLowerCase();
	const ranked = paths
		.map((path) => {
			const cleaned = path.trim().replace(/^\/+/, "");
			if (!cleaned || cleaned.endsWith("/") || cleaned.includes("..")) {
				return null;
			}
			const lower = cleaned.toLowerCase();
			const base = lower.split("/").pop() ?? lower;
			let score = 3;
			if (!needle) {
				score = 1;
			} else if (base.startsWith(needle)) {
				score = 0;
			} else if (base.includes(needle)) {
				score = 1;
			} else if (lower.includes(needle)) {
				score = 2;
			} else {
				return null;
			}
			return { path: cleaned, score };
		})
		.filter((item): item is { path: string; score: number } => item !== null)
		.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of ranked) {
		if (seen.has(item.path)) {
			continue;
		}
		seen.add(item.path);
		out.push(item.path);
		if (out.length >= limit) {
			break;
		}
	}
	return out;
}

export function stageBoardContext(input: {
	path: string;
	text: string;
	id?: string;
}): CodeAttachDraft {
	const path = input.path.trim().replace(/^\/+/, "");
	const name = path.split("/").pop() ?? "";
	if (
		!path ||
		path.endsWith("/") ||
		path.includes("..") ||
		path.includes("\\") ||
		codeAttachKind(name) !== "text"
	) {
		throw new Error("context file must be text");
	}
	if (input.text.includes("\0")) {
		throw new Error("file is not text");
	}
	if (new TextEncoder().encode(input.text).byteLength > CODE_CONTEXT_TEXT_MAX) {
		throw new Error("file is too large");
	}
	return {
		id: input.id?.trim() || newId(),
		name,
		path,
		kind: "text",
		use: "context",
		source: "board",
		text: input.text,
	};
}

export function renameContextDrafts(
	files: readonly CodeAttachDraft[],
	from: string,
	to: string,
): CodeAttachDraft[] {
	const next = to.trim().replace(/^\/+/, "");
	const name = next.split("/").pop() ?? next;
	return files.map((file) =>
		file.source === "board" && file.path === from
			? { ...file, path: next, name }
			: file,
	);
}

export function codeSttLanguage(locale: string): "en" | "fr" {
	return locale.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function codeSttMicros(
	seconds: number,
	markup: number = DEFAULT_AI_MARKUP,
): number {
	const safe = Math.min(
		CODE_STT_MAX_MS / 1000,
		Math.max(0, Number.isFinite(seconds) ? seconds : 0),
	);
	if (safe <= 0) {
		return 0;
	}
	const raw = usdToMicros((safe / 60) * CODE_STT_USD_PER_MINUTE);
	return applyMarkup(raw === 0 ? 1 : raw, markup);
}

export { decodeBase64, encodeBase64 };

export function codeComposerErrorKey(
	message: string,
):
	| "fileTooLarge"
	| "fileType"
	| "updateCompanion"
	| "creditsEmpty"
	| "contextText"
	| null {
	const text = message.toLowerCase();
	if (text.includes("credits empty")) {
		return "creditsEmpty";
	}
	if (text.includes("context file must be text")) {
		return "contextText";
	}
	if (text.includes("file is too large")) {
		return "fileTooLarge";
	}
	if (
		text.includes("file type is not allowed") ||
		text.includes("invalid file")
	) {
		return "fileType";
	}
	if (
		text.includes("file is not text") ||
		text.includes("text is required") ||
		text.includes("text are required") ||
		text.includes("update companion")
	) {
		return "updateCompanion";
	}
	return null;
}

function explorerPath(
	dir: string,
	name: string,
	taken: readonly string[],
): string {
	const folder = dir.trim().replace(/^\/+|\/+$/g, "");
	const dot = name.lastIndexOf(".");
	const stem = name.slice(0, dot);
	const ext = name.slice(dot);
	const used = new Set(taken);
	let n = 1;
	let candidate = "";
	while (n < 100) {
		const file = n === 1 ? name : `${stem}-${n}${ext}`;
		candidate = folder ? `${folder}/${file}` : file;
		if (!used.has(candidate)) {
			return candidate;
		}
		n += 1;
	}
	throw new Error("file type is not allowed");
}

function asAttach(file: string | CodeAttachDraft): CodeAttachDraft {
	if (typeof file === "string") {
		return {
			id: file,
			name: file,
			path: file,
			kind: "text",
			use: "project",
		};
	}
	return file;
}

function extensionOf(name: string): string {
	const base = name.split("/").pop() ?? name;
	const dot = base.lastIndexOf(".");
	if (dot <= 0) {
		return "";
	}
	return base.slice(dot + 1).toLowerCase();
}

function newId(): string {
	const cryptoRef = globalThis.crypto;
	if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
		return cryptoRef.randomUUID();
	}
	return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
