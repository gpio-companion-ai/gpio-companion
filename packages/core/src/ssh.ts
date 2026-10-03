import { debugAuthQuery } from "./debug.ts";
import type { DeviceAuthHeaders } from "./device-auth.ts";

export const SSH_PATH = "/v1/ssh";
export const SSH_MAX_INPUT = 8192;
export const SSH_DEFAULT_COLS = 80;
export const SSH_DEFAULT_ROWS = 24;
export const SSH_COLS_MIN = 2;
export const SSH_COLS_MAX = 500;
export const SSH_ROWS_MIN = 2;
export const SSH_ROWS_MAX = 200;

export type SshStatus = "auth" | "connected" | "closed";

export type SshWsOpen = { op: "open" };
export type SshWsInput = { op: "input"; data: string };
export type SshWsResize = { op: "resize"; cols: number; rows: number };
export type SshWsClose = { op: "close" };

export type SshWsCommand =
	| SshWsOpen
	| SshWsInput
	| SshWsResize
	| SshWsClose;

export type SshChunk = { chunk: string };
export type SshStatusMessage = { status: SshStatus; message?: string };
export type SshWsError = { error: string };

export type SshFrame = SshChunk | SshStatusMessage | SshWsError;

export class SshError extends Error {
	readonly status: 400 | 409;

	constructor(message: string, status: 400 | 409 = 400) {
		super(message);
		this.name = "SshError";
		this.status = status;
	}
}

export function isSshPath(path: string): boolean {
	return path === SSH_PATH;
}

export function sshWsUrl(deviceUrl: string): string {
	const origin = deviceUrl.replace(/\/+$/, "");
	if (origin.startsWith("https://")) {
		return `wss://${origin.slice("https://".length)}${SSH_PATH}`;
	}
	if (origin.startsWith("http://")) {
		return `ws://${origin.slice("http://".length)}${SSH_PATH}`;
	}
	return `wss://${origin}${SSH_PATH}`;
}

export function sshWsConnectUrl(
	deviceUrl: string,
	headers: DeviceAuthHeaders,
): string {
	return `${sshWsUrl(deviceUrl)}?${debugAuthQuery(headers)}`;
}

export function parseSshWsCommand(input: unknown): SshWsCommand {
	if (input === null || typeof input !== "object") {
		throw new SshError("ssh command must be an object");
	}
	const record = input as Record<string, unknown>;
	if (record.op === "open") {
		return { op: "open" };
	}
	if (record.op === "close") {
		return { op: "close" };
	}
	if (record.op === "input") {
		const data = record.data;
		if (typeof data !== "string") {
			throw new SshError("ssh input data must be a string");
		}
		if (data.length > SSH_MAX_INPUT) {
			throw new SshError("ssh input is too large");
		}
		return { op: "input", data };
	}
	if (record.op === "resize") {
		return { op: "resize", cols: sshDimension(record.cols, true), rows: sshDimension(record.rows, false) };
	}
	throw new SshError("unknown ssh command");
}

export function isSshChunk(input: unknown): input is SshChunk {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return false;
	}
	const record = input as Record<string, unknown>;
	return typeof record.chunk === "string";
}

export function isSshStatusMessage(input: unknown): input is SshStatusMessage {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return false;
	}
	const record = input as Record<string, unknown>;
	return (
		record.status === "auth" ||
		record.status === "connected" ||
		record.status === "closed"
	);
}

export function asSshWsError(input: unknown): string | null {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return null;
	}
	const record = input as Record<string, unknown>;
	if (isSshChunk(record) || isSshStatusMessage(record)) {
		return null;
	}
	return typeof record.error === "string" && record.error.trim()
		? record.error
		: null;
}

function sshDimension(value: unknown, cols: boolean): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new SshError(`ssh ${cols ? "cols" : "rows"} must be an integer`);
	}
	const min = cols ? SSH_COLS_MIN : SSH_ROWS_MIN;
	const max = cols ? SSH_COLS_MAX : SSH_ROWS_MAX;
	if (value < min || value > max) {
		throw new SshError(`ssh ${cols ? "cols" : "rows"} out of range`);
	}
	return value;
}
