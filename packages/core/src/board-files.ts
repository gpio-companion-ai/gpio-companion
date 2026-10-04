import { debugAuthQuery } from "./debug.ts";
import type { DeviceAuthHeaders } from "./device-auth.ts";
import { parseGithubRepoName } from "./project-files.ts";

export const FILES_LIST_PATH = "/v1/files/list";
export const FILES_READ_PATH = "/v1/files/read";
export const FILES_WRITE_PATH = "/v1/files";
export const FILES_RENAME_PATH = "/v1/files/rename";
export const FILES_REMOVE_PATH = "/v1/files/remove";
export const FILES_WATCH_PREFIX = "/v1/files/watch/";
export const BOARD_FILE_LIST_MAX = 4000;
export const BOARD_FILE_DEPTH_MAX = 12;
export const BOARD_FILE_TEXT_MAX = 1024 * 1024;
export const BOARD_FILE_MODEL_MAX = 8 * 1024 * 1024;
export const BOARD_FILE_IMAGE_MAX = 4 * 1024 * 1024;
export const BOARD_UPLOAD_DIR = "uploads";
export const BOARD_UPLOAD_BINARY_MAX = 4 * 1024 * 1024;
export const BOARD_FILE_SKIP_DIRS = [".git", "node_modules"] as const;

export const EDITOR_EMBED_PATH = "/embed/editor";
export const EDITOR_EMBED_MESSAGE_TYPE = "gpio-editor";
export const EDITOR_EMBED_READY_TYPE = "gpio-editor-ready";
export const EDITOR_EMBED_CHANGE_TYPE = "gpio-editor-change";
export const EDITOR_EMBED_SAVE_TYPE = "gpio-editor-save";
export const EDITOR_EMBED_SELECTION_TYPE = "gpio-editor-selection";
export const EDITOR_EMBED_BRIDGE_KEY = "__gpioEditorEmbed";
export const EDITOR_EMBED_PENDING_KEY = "__gpioEditorPending";

export type CodeEditorSelection = {
	startLine: number;
	endLine: number;
	text: string;
};

const TEXT_EXT = new Set([
	"c",
	"h",
	"hh",
	"hpp",
	"cc",
	"cpp",
	"cxx",
	"ino",
	"txt",
	"text",
	"md",
	"markdown",
	"ts",
	"tsx",
	"mts",
	"cts",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"css",
	"scss",
	"html",
	"htm",
	"yml",
	"yaml",
	"toml",
	"xml",
	"svg",
	"py",
	"sh",
	"bash",
	"rs",
	"go",
	"csv",
	"gitignore",
	"gitattributes",
	"editorconfig",
]);

const BINARY_EXT = new Set([
	"glb",
	"stl",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"zip",
	"pdf",
	"wasm",
	"bin",
	"o",
	"a",
	"so",
	"exe",
	"dylib",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export type BoardFileEntry = {
	path: string;
	type: "file" | "dir";
	size: number;
};

export type BoardFileList = {
	branch: string;
	entries: BoardFileEntry[];
};

export type BoardFileKind = "text" | "model" | "image" | "binary";

export type BoardFileRead = {
	path: string;
	kind: BoardFileKind;
	text?: string;
	base64?: string;
};

export type BoardFileWrite = {
	written: true;
	path: string;
};

export type BoardFileEventKind = "change" | "add" | "unlink";

export type BoardFileEvent = {
	repo: string;
	path: string;
	kind: BoardFileEventKind;
};

export type BoardFileNode = {
	name: string;
	path: string;
	type: "file" | "dir";
	children: BoardFileNode[];
};

export type BoardFileListPut = {
	name: string;
};

export type BoardFileReadPut = {
	name: string;
	path: string;
};

export type BoardFileRenamePut = {
	name: string;
	from: string;
	to: string;
};

export type BoardFileRemove = {
	removed: true;
	path: string;
};

export type BoardFileRemovePut = {
	name: string;
	path: string;
};

export type BoardFileWritePut = {
	name: string;
	path: string;
	text?: string;
	base64?: string;
};

export type EditorEmbedPayload = {
	type: typeof EDITOR_EMBED_MESSAGE_TYPE;
	path: string;
	text: string;
	language: string;
	rev: number;
};

export { BREADBOARD_DIAGRAM_JSON } from "./breadboard.ts";

export const OC_EDITOR_SPLIT_KEY = "gpio-companion-oc-editor-pct";
export const OC_SPLIT_MIN = 28;
export const OC_SPLIT_MAX = 75;

export function clampSplitPercent(value: number): number {
	if (!Number.isFinite(value)) {
		return 55;
	}
	return Math.min(OC_SPLIT_MAX, Math.max(OC_SPLIT_MIN, Math.round(value)));
}

export function splitPercentFromRatio(ratio: number): number {
	return clampSplitPercent(ratio * 100);
}

export function boardFileDirty(
	kind: string,
	draft: string,
	text: string,
): boolean {
	return kind === "text" && draft !== text;
}

export function countBoardFiles(entries: readonly BoardFileEntry[]): number {
	return entries.filter((entry) => entry.type === "file").length;
}

export function filterBoardNodes(
	nodes: readonly BoardFileNode[],
	query: string,
): BoardFileNode[] {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return [...nodes];
	}
	const out: BoardFileNode[] = [];
	for (const node of nodes) {
		if (node.type === "dir") {
			const children = filterBoardNodes(node.children, needle);
			const self = node.name.toLowerCase().includes(needle);
			if (self || children.length > 0) {
				out.push({
					...node,
					children: self && children.length === 0 ? node.children : children,
				});
			}
			continue;
		}
		if (
			node.name.toLowerCase().includes(needle) ||
			node.path.toLowerCase().includes(needle)
		) {
			out.push(node);
		}
	}
	return out;
}

export function boardFileWatchPath(name: string): string {
	return `${FILES_WATCH_PREFIX}${encodeURIComponent(parseGithubRepoName(name))}`;
}

export function parseBoardFileWatchPath(path: string): string | null {
	const normalized = path.replace(/\/+$/, "") || "/";
	if (!normalized.startsWith(FILES_WATCH_PREFIX)) {
		return null;
	}
	const raw = normalized.slice(FILES_WATCH_PREFIX.length);
	if (!raw || raw.includes("/")) {
		return null;
	}
	try {
		return parseGithubRepoName(decodeURIComponent(raw));
	} catch {
		return null;
	}
}

export function filesWsUrl(deviceUrl: string, name: string): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	const path = boardFileWatchPath(name);
	if (origin.startsWith("https://")) {
		return `wss://${origin.slice("https://".length)}${path}`;
	}
	if (origin.startsWith("http://")) {
		return `ws://${origin.slice("http://".length)}${path}`;
	}
	return `wss://${origin}${path}`;
}

export function filesWsConnectUrl(
	deviceUrl: string,
	name: string,
	headers: DeviceAuthHeaders,
): string {
	return `${filesWsUrl(deviceUrl, name)}?${debugAuthQuery(headers)}`;
}

export function boardFileRelative(input: string): string {
	const rel = input.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!rel || rel.includes("\0")) {
		throw new Error("invalid path");
	}
	const parts = rel.split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) {
		throw new Error("invalid path");
	}
	return parts.join("/");
}

export function boardFileExtension(path: string): string {
	const name = path.split("/").pop() ?? path;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) {
		return "";
	}
	return name.slice(dot + 1).toLowerCase();
}

export function boardFileKindFromName(path: string): BoardFileKind | "unknown" {
	const ext = boardFileExtension(path);
	if (ext === "glb") {
		return "model";
	}
	if (TEXT_EXT.has(ext)) {
		return "text";
	}
	if (IMAGE_EXT.has(ext)) {
		return "image";
	}
	if (BINARY_EXT.has(ext)) {
		return "binary";
	}
	return "unknown";
}

export function isMarkdownPath(path: string): boolean {
	const ext = boardFileExtension(path);
	return ext === "md" || ext === "markdown";
}

export function isImagePath(path: string): boolean {
	return IMAGE_EXT.has(boardFileExtension(path));
}

export function isSvgPath(path: string): boolean {
	return boardFileExtension(path) === "svg";
}

export function boardImageMime(path: string): string {
	return IMAGE_MIME[boardFileExtension(path)] ?? "application/octet-stream";
}

export function boardImageDataUrl(base64: string, path: string): string {
	return `data:${boardImageMime(path)};base64,${base64}`;
}

export function svgDataUrl(text: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
}

export function boardFileLanguage(path: string): string {
	switch (boardFileExtension(path)) {
		case "c":
		case "h":
		case "ino":
			return "c";
		case "cc":
		case "cpp":
		case "cxx":
		case "hh":
		case "hpp":
			return "cpp";
		case "ts":
		case "tsx":
		case "mts":
		case "cts":
			return "typescript";
		case "js":
		case "jsx":
		case "mjs":
		case "cjs":
			return "javascript";
		case "md":
		case "markdown":
			return "markdown";
		case "json":
			return "json";
		case "css":
		case "scss":
			return "css";
		case "html":
		case "htm":
			return "html";
		case "xml":
		case "svg":
			return "xml";
		case "py":
			return "python";
		case "sh":
		case "bash":
			return "shell";
		case "go":
			return "go";
		case "rs":
			return "rust";
		default:
			return "plaintext";
	}
}

export function isUtf8Text(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) {
		return false;
	}
	try {
		new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

const UPLOAD_BINARY = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf"]);

export function decodeBase64(value: string): Uint8Array {
	const clean = value.replace(/\s/g, "");
	if (
		clean.length === 0 ||
		clean.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)
	) {
		throw new Error("invalid file");
	}
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) {
		binary += String.fromCharCode(...bytes.subarray(i, i + step));
	}
	return btoa(binary);
}

export function isUploadBinaryPath(path: string): boolean {
	const parts = path.split("/");
	const name = parts[parts.length - 1] ?? "";
	if (!name || parts.some((part) => !part || part === "." || part === "..")) {
		return false;
	}
	const dot = name.lastIndexOf(".");
	const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	return UPLOAD_BINARY.has(ext);
}

export function assertBoardUploadBinary(path: string, base64: string): void {
	if (!isUploadBinaryPath(path)) {
		throw new Error("file type is not allowed");
	}
	const bytes = decodeBase64(base64);
	if (bytes.byteLength > BOARD_UPLOAD_BINARY_MAX) {
		throw new Error("file is too large");
	}
}

export function assertBoardTextWrite(path: string, text: string): void {
	if (typeof text !== "string") {
		throw new Error("text is required");
	}
	if (new TextEncoder().encode(text).byteLength > BOARD_FILE_TEXT_MAX) {
		throw new Error("file is too large");
	}
	const kind = boardFileKindFromName(path);
	if (kind === "model" || kind === "image" || kind === "binary") {
		throw new Error("file is not text");
	}
	if (text.includes("\0")) {
		throw new Error("file is not text");
	}
}

export function parseBoardFileListPut(input: unknown): BoardFileListPut {
	const record = objectBody(input);
	if (typeof record.name !== "string") {
		throw new Error("name is required");
	}
	return { name: parseGithubRepoName(record.name) };
}

export function parseBoardFileReadPut(input: unknown): BoardFileReadPut {
	const record = objectBody(input);
	if (typeof record.name !== "string" || typeof record.path !== "string") {
		throw new Error("name and path are required");
	}
	return {
		name: parseGithubRepoName(record.name),
		path: boardFileRelative(record.path),
	};
}

export function parseBoardFileRenamePut(input: unknown): BoardFileRenamePut {
	const record = objectBody(input);
	if (
		typeof record.name !== "string" ||
		typeof record.from !== "string" ||
		typeof record.to !== "string"
	) {
		throw new Error("name, from, and to are required");
	}
	const from = boardFileRelative(record.from);
	const to = boardFileRelative(record.to);
	if (from === to) {
		throw new Error("file already exists");
	}
	return { name: parseGithubRepoName(record.name), from, to };
}

export function parseBoardFileRemovePut(input: unknown): BoardFileRemovePut {
	const record = objectBody(input);
	if (typeof record.name !== "string" || typeof record.path !== "string") {
		throw new Error("name and path are required");
	}
	return {
		name: parseGithubRepoName(record.name),
		path: boardFileRelative(record.path),
	};
}

export function parseBoardFileWritePut(input: unknown): BoardFileWritePut {
	const record = objectBody(input);
	if (typeof record.name !== "string" || typeof record.path !== "string") {
		throw new Error("name and path are required");
	}
	const path = boardFileRelative(record.path);
	const name = parseGithubRepoName(record.name);
	const hasText = typeof record.text === "string";
	const hasBinary = typeof record.base64 === "string" && record.base64 !== "";
	if (hasText === hasBinary) {
		throw new Error("text or base64 is required");
	}
	if (hasBinary) {
		assertBoardUploadBinary(path, record.base64 as string);
		return { name, path, base64: record.base64 as string };
	}
	assertBoardTextWrite(path, record.text as string);
	return { name, path, text: record.text as string };
}

export function parseBoardFileEvent(input: unknown): BoardFileEvent | null {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		return null;
	}
	const record = input as Record<string, unknown>;
	if (
		typeof record.repo !== "string" ||
		typeof record.path !== "string" ||
		(record.kind !== "change" &&
			record.kind !== "add" &&
			record.kind !== "unlink")
	) {
		return null;
	}
	try {
		return {
			repo: parseGithubRepoName(record.repo),
			path: boardFileRelative(record.path),
			kind: record.kind,
		};
	} catch {
		return null;
	}
}

export function boardFileTree(entries: BoardFileEntry[]): BoardFileNode[] {
	const root: BoardFileNode[] = [];
	const dirs = new Map<string, BoardFileNode>();
	const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
	for (const entry of sorted) {
		if (entry.type === "dir") {
			ensureDir(root, dirs, entry.path);
			continue;
		}
		const parts = entry.path.split("/");
		const name = parts.pop() ?? entry.path;
		const parentPath = parts.join("/");
		const parent = parentPath ? ensureDir(root, dirs, parentPath) : null;
		const node: BoardFileNode = {
			name,
			path: entry.path,
			type: "file",
			children: [],
		};
		(parent ? parent.children : root).push(node);
	}
	sortTree(root);
	return root;
}

export type BoardFileApplyResult = {
	action: "ignore" | "echo" | "reload" | "stale" | "missing";
	refreshTree: boolean;
};

export function boardFileApplyEvent(input: {
	event: BoardFileEvent;
	openPath: string;
	dirty: boolean;
	echo: boolean;
}): BoardFileApplyResult {
	const matches = input.event.path === input.openPath;
	if (!matches) {
		return { action: "ignore", refreshTree: true };
	}
	if (input.event.kind === "unlink") {
		return { action: "missing", refreshTree: true };
	}
	if (input.echo) {
		return { action: "echo", refreshTree: true };
	}
	if (input.dirty) {
		return { action: "stale", refreshTree: true };
	}
	return { action: "reload", refreshTree: true };
}

export function editorEmbedUrl(
	origin: string,
	opts?: { locale?: string; theme?: string },
): string {
	const url = new URL(EDITOR_EMBED_PATH, origin.replace(/\/+$/, "") || origin);
	if (opts?.locale) {
		url.searchParams.set("locale", opts.locale);
	}
	if (opts?.theme) {
		url.searchParams.set("theme", opts.theme);
	}
	return url.toString();
}

export function editorEmbedInjectSource(payload: EditorEmbedPayload): string {
	const json = JSON.stringify(payload).replace(/</g, "\\u003c");
	return `window.${EDITOR_EMBED_PENDING_KEY}=${json};if(window.${EDITOR_EMBED_BRIDGE_KEY}){window.${EDITOR_EMBED_BRIDGE_KEY}(window.${EDITOR_EMBED_PENDING_KEY});}true;`;
}

export function parseEditorEmbedMessage(
	data: unknown,
): EditorEmbedPayload | null {
	const record = asRecord(data);
	if (!record || record.type !== EDITOR_EMBED_MESSAGE_TYPE) {
		return null;
	}
	if (typeof record.path !== "string" || typeof record.text !== "string") {
		return null;
	}
	return {
		type: EDITOR_EMBED_MESSAGE_TYPE,
		path: record.path,
		text: record.text,
		language:
			typeof record.language === "string" ? record.language : "plaintext",
		rev: typeof record.rev === "number" ? record.rev : 0,
	};
}

export function parseEditorEmbedChange(data: unknown): string | null {
	const record = asRecord(data);
	if (!record || record.type !== EDITOR_EMBED_CHANGE_TYPE) {
		return null;
	}
	return typeof record.text === "string" ? record.text : null;
}

export function parseEditorEmbedSelection(
	data: unknown,
): CodeEditorSelection | null | undefined {
	const record = asRecord(data);
	if (!record || record.type !== EDITOR_EMBED_SELECTION_TYPE) {
		return undefined;
	}
	const selection = record.selection;
	if (selection === null) {
		return null;
	}
	if (
		selection &&
		typeof selection === "object" &&
		Number.isInteger((selection as CodeEditorSelection).startLine) &&
		Number.isInteger((selection as CodeEditorSelection).endLine) &&
		typeof (selection as CodeEditorSelection).text === "string"
	) {
		return {
			startLine: (selection as CodeEditorSelection).startLine,
			endLine: (selection as CodeEditorSelection).endLine,
			text: (selection as CodeEditorSelection).text,
		};
	}
	return undefined;
}

export function isEditorEmbedSave(data: unknown): boolean {
	const record = asRecord(data);
	return Boolean(record && record.type === EDITOR_EMBED_SAVE_TYPE);
}

function objectBody(input: unknown): Record<string, unknown> {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("body must be an object");
	}
	return input as Record<string, unknown>;
}

function ensureDir(
	root: BoardFileNode[],
	dirs: Map<string, BoardFileNode>,
	path: string,
): BoardFileNode {
	const found = dirs.get(path);
	if (found) {
		return found;
	}
	const parts = path.split("/");
	const name = parts.pop() ?? path;
	const parentPath = parts.join("/");
	const node: BoardFileNode = {
		name,
		path,
		type: "dir",
		children: [],
	};
	dirs.set(path, node);
	const parent = parentPath ? ensureDir(root, dirs, parentPath) : null;
	(parent ? parent.children : root).push(node);
	return node;
}

function sortTree(nodes: BoardFileNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "dir" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
	for (const node of nodes) {
		if (node.children.length > 0) {
			sortTree(node.children);
		}
	}
}

function asRecord(data: unknown): Record<string, unknown> | null {
	if (typeof data === "string") {
		try {
			data = JSON.parse(data) as unknown;
		} catch {
			return null;
		}
	}
	if (data == null || typeof data !== "object" || Array.isArray(data)) {
		return null;
	}
	return data as Record<string, unknown>;
}
