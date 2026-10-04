export const APP_PATH = "/v1/app";
export const APP_START_PATH = "/v1/app/start";
export const APP_STOP_PATH = "/v1/app/stop";
export const APP_LIST_PATH = "/v1/app/list";
export const APP_LOG_MAX = 16 * 1024;
export const APP_NAME_MAX = 64;
export const APP_TITLE_MAX = 80;
export const APP_ENTRY_MAX = 512;
export const APP_PORT_MIN = 4600;
export const APP_PORT_MAX = 4619;
export const APP_TOKEN_BYTES = 32;
export const APP_TOKEN_MIN_LENGTH = 32;
export const APP_TOKEN_TTL_MS = 10 * 60_000;
export const APP_MAX_TOKENS = 4;
export const APP_READY_TIMEOUT_MS = 10_000;
export const APP_LIST_MAX = 50;

export const APP_VIEWS = ["split", "modal", "page"] as const;

export type AppView = (typeof APP_VIEWS)[number];

export type AppStartPut = {
	repo: string;
	dir: string;
};

export type BoardApp = {
	project: string;
	dir: string;
	name: string;
	entry: string;
};

export type BoardAppList = {
	apps: BoardApp[];
};

export type AppStatus = {
	running: boolean;
	name: string | null;
	repo: string | null;
	port: number | null;
	startedAt: number | null;
	log: string;
};

export type AppFrameGrant = {
	path: string;
	expiresAt: number;
};

export type AppFramePath = {
	name: string;
	token: string;
	suffix: string;
};

export class AppError extends Error {
	readonly status: 400 | 403 | 404 | 409;

	constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
		super(message);
		this.name = "AppError";
		this.status = status;
	}
}

const APP_RESERVED_NAMES = new Set(["start", "stop", "list", "frame"]);
const APP_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const APP_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const APP_ENTRY_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const APP_ENTRY_FALLBACKS = ["server", "index"];

export function isAppName(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= APP_NAME_MAX &&
		!APP_RESERVED_NAMES.has(value) &&
		APP_NAME_PATTERN.test(value)
	);
}

export function boardAppDirFromPath(path: string): string | null {
	const segments = path.split("/");
	if (segments.length !== 2 || segments[0] !== "app") {
		return null;
	}
	const dir = segments[1] ?? "";
	return isAppName(dir) ? dir : null;
}

export function isValidAppToken(value: string): boolean {
	return value.length >= APP_TOKEN_MIN_LENGTH && APP_TOKEN_PATTERN.test(value);
}

export function isAppManagePath(path: string): boolean {
	if (
		path === APP_PATH ||
		path === APP_START_PATH ||
		path === APP_STOP_PATH ||
		path === APP_LIST_PATH
	) {
		return true;
	}
	return isAppFrameMintPath(path);
}

export function isAppFrameMintPath(path: string): boolean {
	const segments = path.replace(/\/+$/, "").split("/");
	return (
		segments.length === 5 &&
		segments[0] === "" &&
		segments[1] === "v1" &&
		segments[2] === "app" &&
		segments[3] !== "" &&
		segments[4] === "frame"
	);
}

export function appNameFromMintPath(path: string): string {
	if (!isAppFrameMintPath(path)) {
		return "";
	}
	return path.replace(/\/+$/, "").split("/")[3] ?? "";
}

export function parseAppFramePath(path: string): AppFramePath | null {
	const bare = path.split(/[?#]/, 1)[0] ?? path;
	const normalized = bare.replace(/\/+$/, "");
	if (!normalized.startsWith(`${APP_PATH}/`)) {
		return null;
	}
	const segments = normalized.slice(`${APP_PATH}/`.length).split("/");
	if (segments.length < 2) {
		return null;
	}
	const name = segments[0] ?? "";
	const token = segments[1] ?? "";
	if (!isAppName(name) || !isValidAppToken(token)) {
		return null;
	}
	const suffixSegments = segments.slice(2).filter((segment) => segment !== "");
	const suffix = suffixSegments.length ? `/${suffixSegments.join("/")}` : "/";
	return { name, token, suffix };
}

export function appFrameBasePath(name: string, token: string): string {
	return `${APP_PATH}/${encodeURIComponent(name)}/${token}`;
}

export function appFrameUrl(
	deviceUrl: string,
	name: string,
	token: string,
	suffix = "/",
): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	return `${origin}${appFrameBasePath(name, token)}${normalizeSuffix(suffix)}`;
}

export function appFrameWsUrl(
	deviceUrl: string,
	name: string,
	token: string,
	suffix = "/",
): string {
	const url = appFrameUrl(deviceUrl, name, token, suffix);
	if (url.startsWith("https://")) {
		return `wss://${url.slice("https://".length)}`;
	}
	if (url.startsWith("http://")) {
		return `ws://${url.slice("http://".length)}`;
	}
	return url;
}

export function parseAppStartPut(input: unknown): AppStartPut {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new AppError("app start must be an object");
	}
	const record = input as Record<string, unknown>;
	return {
		repo: requiredRepo(record.repo),
		dir: requiredAppDir(record.dir),
	};
}

export function parseBoardAppList(input: unknown): BoardAppList {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("apps must be an object");
	}
	const apps = (input as { apps?: unknown }).apps;
	if (!Array.isArray(apps)) {
		throw new Error("apps is required");
	}
	return { apps: apps.map((item, index) => parseBoardAppItem(item, index)) };
}

export function parseAppPackageName(packageJson: unknown): string {
	if (packageJson === null || typeof packageJson !== "object") {
		throw new AppError("app package.json is invalid");
	}
	const name = (packageJson as { name?: unknown }).name;
	if (typeof name !== "string" || !isAppName(name.trim())) {
		throw new AppError(
			"app package.json name must be kebab-case (max 64, no start/stop/list/frame)",
		);
	}
	return name.trim();
}

export function appEntryCandidates(main: unknown): string[] {
	const entry = typeof main === "string" ? main.trim() : "";
	const out: string[] = [];
	if (entry) {
		const candidate = requiredEntryValue(entry);
		if (candidate && !out.includes(candidate)) {
			out.push(candidate);
		}
	}
	for (const base of APP_ENTRY_FALLBACKS) {
		for (const ext of APP_ENTRY_EXT) {
			const candidate = `${base}${ext}`;
			if (!out.includes(candidate)) {
				out.push(candidate);
			}
		}
	}
	return out;
}

export function capAppLog(log: string): string {
	if (log.length <= APP_LOG_MAX) {
		return log;
	}
	return log.slice(log.length - APP_LOG_MAX);
}

export function newAppToken(): string {
	const bytes = new Uint8Array(APP_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function isAppTokenFresh(expiresAt: number, now = Date.now()): boolean {
	return now < expiresAt;
}

export function isAppPort(port: number): boolean {
	return Number.isInteger(port) && port >= APP_PORT_MIN && port <= APP_PORT_MAX;
}

function requiredRepo(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new AppError("repo is required");
	}
	const repo = value.trim();
	if (repo.includes("/") || repo.includes("\\") || repo.includes("..")) {
		throw new AppError("repo is invalid");
	}
	return repo;
}

function requiredAppDir(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new AppError("dir is required");
	}
	const dir = value.trim();
	if (
		dir.startsWith("/") ||
		dir.includes("/") ||
		dir.includes("\\") ||
		dir.includes("..") ||
		dir.startsWith(".")
	) {
		throw new AppError("dir must be the app/ folder name");
	}
	return dir;
}

function requiredEntryValue(entry: string): string | null {
	if (
		!entry ||
		entry.startsWith("/") ||
		entry.includes("..") ||
		entry.includes("\\") ||
		entry.length > APP_ENTRY_MAX ||
		!APP_ENTRY_EXT.some((ext) => entry.endsWith(ext))
	) {
		return null;
	}
	return entry;
}

function parseBoardAppItem(input: unknown, index: number): BoardApp {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`app ${index} must be an object`);
	}
	const record = input as Record<string, unknown>;
	const project =
		typeof record.project === "string" && record.project.trim()
			? record.project.trim()
			: "";
	if (!project || project.includes("/") || project.includes("..")) {
		throw new Error("project is required");
	}
	const dir = requiredAppDir(record.dir);
	const name = typeof record.name === "string" ? record.name.trim() : "";
	if (!isAppName(name)) {
		throw new Error("name is invalid");
	}
	const entry =
		typeof record.entry === "string"
			? requiredEntryValue(record.entry.trim())
			: null;
	if (!entry) {
		throw new Error("entry is invalid");
	}
	return { project, dir, name, entry };
}

function normalizeSuffix(suffix: string): string {
	const value = suffix.startsWith("/") ? suffix : `/${suffix}`;
	return value === "//" ? "/" : value;
}
