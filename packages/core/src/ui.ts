import { APP_VIEWS, type AppView, isAppName } from "./app-server.ts";
import { boardFileRelative } from "./board-files.ts";
import { debugAuthQuery } from "./debug.ts";
import type { DeviceAuthHeaders } from "./device-auth.ts";
import { parseGithubRepoName } from "./project-files.ts";

export const UI_PATH = "/v1/ui";
export const UI_REPLY_PREFIX = "/v1/ui/reply/";
export const UI_MAX_SOCKETS = 8;
export const UI_PREVIEW_PATH_MAX = 512;
export const UI_TITLE_MAX = 80;
export const UI_BODY_MAX = 500;
export const UI_BUTTON_LABEL_MAX = 40;
export const UI_BUTTONS_MAX = 3;
export const UI_TOAST_MAX = 160;
export const UI_REPLY_TTL_MS = 120_000;
export const UI_REPLY_POLL_MS = 25_000;
export const UI_REPLY_TICK_MS = 250;

export type UiSurface = "web" | "desktop" | "mobile";

export type UiNavigateTarget =
	| "project"
	| "code"
	| "docs"
	| "devices"
	| "pair"
	| "wifi"
	| "keys"
	| "requests"
	| "debug"
	| "admin"
	| "profile"
	| "github"
	| "credits";

export type UiDockTab =
	| "console"
	| "gpio"
	| "flash"
	| "problems"
	| "actions"
	| "ssh"
	| "support";

export type UiNavigateCommand = { type: "navigate"; target: UiNavigateTarget };
export type UiDockCommand = { type: "dock"; tab: UiDockTab };
export type UiPaletteCommand = { type: "palette"; open: boolean };
export type UiToastCommand = { type: "toast"; text: string };
export type UiModalCommand = {
	type: "modal";
	id: string;
	title: string;
	body: string;
	buttons: string[];
};

export type UiPreviewCommand = {
	type: "preview";
	repo: string;
	path: string;
};

export type UiAppCommand = {
	type: "app";
	appId: string;
	view: AppView;
	title: string;
};

export type UiDiagnosticsCommand = {
	type: "diagnostics";
	id: string;
};

export type UiCommand =
	| UiNavigateCommand
	| UiDockCommand
	| UiPaletteCommand
	| UiToastCommand
	| UiModalCommand
	| UiPreviewCommand
	| UiAppCommand
	| UiDiagnosticsCommand;

export const UI_NAVIGATE_TARGETS = [
	"project",
	"code",
	"docs",
	"devices",
	"pair",
	"wifi",
	"keys",
	"requests",
	"debug",
	"admin",
	"profile",
	"github",
	"credits",
] as const satisfies readonly UiNavigateTarget[];

export const UI_DOCK_TABS = [
	"console",
	"gpio",
	"flash",
	"problems",
	"actions",
	"ssh",
	"support",
] as const satisfies readonly UiDockTab[];

export const UI_SURFACES = [
	"web",
	"desktop",
	"mobile",
] as const satisfies readonly UiSurface[];

export type UiSocketHello = {
	op: "hello";
	surface: UiSurface;
	focused: boolean;
};

export const UI_REPLY_BODY_MAX = 8000;

export type UiSocketReply = {
	op: "reply";
	id: string;
	action: string;
	body?: string;
};

export type UiSocketClientMessage = UiSocketHello | UiSocketReply;

export type UiSocketInfo = {
	id: string;
	surface: UiSurface;
	focused: boolean;
	connectedAt: number;
};

export type UiCommandResult = {
	delivered: number;
	fallback: boolean;
};

export class UiError extends Error {
	readonly status: 400 | 403;

	constructor(message: string, status: 400 | 403 = 400) {
		super(message);
		this.name = "UiError";
		this.status = status;
	}
}

export function isUiPath(path: string): boolean {
	const normalized = path.replace(/\/+$/, "") || "/";
	if (normalized === UI_PATH) {
		return true;
	}
	if (!normalized.startsWith(UI_REPLY_PREFIX)) {
		return false;
	}
	const id = normalized.slice(UI_REPLY_PREFIX.length);
	return id.length > 0 && !id.includes("/");
}

export function uiReplyIdFromPath(path: string): string {
	const normalized = path.replace(/\/+$/, "");
	if (!normalized.startsWith(UI_REPLY_PREFIX)) {
		return "";
	}
	return normalized.slice(UI_REPLY_PREFIX.length);
}

export function uiWsUrl(deviceUrl: string): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	if (origin.startsWith("https://")) {
		return `wss://${origin.slice("https://".length)}${UI_PATH}`;
	}
	if (origin.startsWith("http://")) {
		return `ws://${origin.slice("http://".length)}${UI_PATH}`;
	}
	return `wss://${origin}${UI_PATH}`;
}

export function uiWsConnectUrl(
	deviceUrl: string,
	headers: DeviceAuthHeaders,
): string {
	return `${uiWsUrl(deviceUrl)}?${debugAuthQuery(headers)}`;
}

export function parseUiCommand(input: unknown): UiCommand {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new UiError("ui command must be an object");
	}
	const record = input as Record<string, unknown>;
	switch (record.type) {
		case "navigate":
			return { type: "navigate", target: parseTarget(record.target) };
		case "dock":
			return { type: "dock", tab: parseDockTab(record.tab) };
		case "palette":
			if (typeof record.open !== "boolean") {
				throw new UiError("palette open must be a boolean");
			}
			return { type: "palette", open: record.open };
		case "toast":
			return {
				type: "toast",
				text: capText(record.text, UI_TOAST_MAX, "toast"),
			};
		case "modal":
			return parseModal(record);
		case "preview":
			return parsePreview(record);
		case "app":
			return parseApp(record);
		case "diagnostics":
			return parseDiagnostics(record);
		default:
			throw new UiError("unknown ui command");
	}
}

export function parseUiSocketMessage(input: unknown): UiSocketClientMessage {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new UiError("ui message must be an object");
	}
	const record = input as Record<string, unknown>;
	if (record.op === "hello") {
		return {
			op: "hello",
			surface: parseSurface(record.surface),
			focused: record.focused === true,
		};
	}
	if (record.op === "reply") {
		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (!id || id.length > 128) {
			throw new UiError("reply id is required");
		}
		const action =
			typeof record.action === "string"
				? record.action.trim().slice(0, 160)
				: "";
		if (!action) {
			throw new UiError("reply action is required");
		}
		const body =
			typeof record.body === "string"
				? record.body.slice(0, UI_REPLY_BODY_MAX)
				: "";
		return body
			? { op: "reply", id, action, body }
			: { op: "reply", id, action };
	}
	throw new UiError("unknown ui message");
}

export function newUiModalId(): string {
	return crypto.randomUUID();
}

export function isUiReplyFresh(at: number, now: number): boolean {
	return now - at <= UI_REPLY_TTL_MS;
}

function parseTarget(value: unknown): UiNavigateTarget {
	if (
		typeof value === "string" &&
		(UI_NAVIGATE_TARGETS as readonly string[]).includes(value)
	) {
		return value as UiNavigateTarget;
	}
	throw new UiError("unknown navigate target");
}

function parseDockTab(value: unknown): UiDockTab {
	if (
		typeof value === "string" &&
		(UI_DOCK_TABS as readonly string[]).includes(value)
	) {
		return value as UiDockTab;
	}
	throw new UiError("unknown dock tab");
}

function parseSurface(value: unknown): UiSurface {
	if (
		typeof value === "string" &&
		(UI_SURFACES as readonly string[]).includes(value)
	) {
		return value as UiSurface;
	}
	throw new UiError("unknown ui surface");
}

function capText(value: unknown, max: number, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new UiError(`${label} text is required`);
	}
	return value.slice(0, max);
}

function parseDiagnostics(
	record: Record<string, unknown>,
): UiDiagnosticsCommand {
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id || id.length > 128) {
		throw new UiError("diagnostics id is required");
	}
	return { type: "diagnostics", id };
}

function parseModal(record: Record<string, unknown>): UiModalCommand {
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id || id.length > 128) {
		throw new UiError("modal id is required");
	}
	const buttons = record.buttons;
	if (
		!Array.isArray(buttons) ||
		buttons.length === 0 ||
		buttons.length > UI_BUTTONS_MAX
	) {
		throw new UiError(`modal needs 1 to ${UI_BUTTONS_MAX} buttons`);
	}
	return {
		type: "modal",
		id,
		title: capText(record.title, UI_TITLE_MAX, "title"),
		body: capText(record.body, UI_BODY_MAX, "body"),
		buttons: buttons.map((label) =>
			capText(label, UI_BUTTON_LABEL_MAX, "button"),
		),
	};
}

function parsePreview(record: Record<string, unknown>): UiPreviewCommand {
	if (typeof record.repo !== "string" || !record.repo.trim()) {
		throw new UiError("preview repo is required");
	}
	let repo: string;
	try {
		repo = parseGithubRepoName(record.repo);
	} catch (error) {
		throw new UiError(
			error instanceof Error ? error.message : "preview repo is invalid",
		);
	}
	if (typeof record.path !== "string" || !record.path.trim()) {
		throw new UiError("preview path is required");
	}
	let path: string;
	try {
		path = boardFileRelative(record.path.trim());
	} catch {
		throw new UiError("preview path is invalid");
	}
	if (path.length > UI_PREVIEW_PATH_MAX) {
		throw new UiError("preview path is too long");
	}
	return { type: "preview", repo, path };
}

export {
	browserDiagnosticsBody,
	installBrowserDiagnosticsHere,
	recordBrowserNetwork,
} from "./browser-diagnostics.ts";

function parseApp(record: Record<string, unknown>): UiAppCommand {
	if (typeof record.appId !== "string" || !isAppName(record.appId.trim())) {
		throw new UiError("app id is invalid");
	}
	const appId = record.appId.trim();
	let view: AppView = "split";
	if (record.view !== undefined) {
		if (
			typeof record.view !== "string" ||
			!(APP_VIEWS as readonly string[]).includes(record.view)
		) {
			throw new UiError("app view must be split, modal, or page");
		}
		view = record.view as AppView;
	}
	const title =
		typeof record.title === "string" && record.title.trim()
			? record.title.trim().slice(0, UI_TITLE_MAX)
			: appId;
	return { type: "app", appId, view, title };
}
