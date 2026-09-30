import type { ArduinoProxyStatus } from "./arduino-proxy.ts";
import type { FlashStatus } from "./flash.ts";
import type { RunStatus } from "./run.ts";

export const HUB_PATH = "/api/hub";
export const HUB_TOKEN_PREFIX = "gpiohub.v1.";
export const HUB_TOKEN_TTL_MS = 60 * 60 * 1000;
export const HUB_PING_MS = 60_000;
export const HUB_FLASH_MS = 1_500;
export const HUB_RUN_MS = 1_000;
export const HUB_PROXY_MS = 1_500;
export const HUB_LIVE_TTL_SEC = 120;

export type HubRole = "pi" | "dashboard";

export type HubChannel = "flash" | "run" | "arduinoProxy";

export type HubMessageType = HubChannel | "hello" | "ping";

export type HubMessage = {
	v: 1;
	type: HubMessageType;
	payload?: unknown;
};

const CHANNELS = new Set<HubChannel>(["flash", "run", "arduinoProxy"]);
const MESSAGE_TYPES = new Set<HubMessageType>([
	"flash",
	"run",
	"arduinoProxy",
	"hello",
	"ping",
]);

export function isHubChannel(value: unknown): value is HubChannel {
	return typeof value === "string" && CHANNELS.has(value as HubChannel);
}

export function isHubRole(value: unknown): value is HubRole {
	return value === "pi" || value === "dashboard";
}

export function hubOrigin(origin?: string): string {
	return (origin || "https://gpio-companion.com").replace(/\/+$/, "");
}

export function hubWsUrl(
	origin: string,
	uuid: string,
	ticket?: string,
): string {
	const url = new URL(`${hubOrigin(origin)}${HUB_PATH}`);
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	} else if (url.protocol === "http:") {
		url.protocol = "ws:";
	}
	url.searchParams.set("uuid", uuid.trim());
	if (ticket?.trim()) {
		url.searchParams.set("ticket", ticket.trim());
	}
	return url.toString();
}

export function encodeHubMessage(message: HubMessage): string {
	return JSON.stringify(message);
}

export function parseHubMessage(input: unknown): HubMessage | null {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input) as unknown;
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as { v?: unknown; type?: unknown; payload?: unknown };
	if (record.v !== 1) {
		return null;
	}
	if (
		typeof record.type !== "string" ||
		!MESSAGE_TYPES.has(record.type as HubMessageType)
	) {
		return null;
	}
	const message: HubMessage = { v: 1, type: record.type as HubMessageType };
	if (record.payload !== undefined) {
		message.payload = record.payload;
	}
	return message;
}

export function asFlashStatus(payload: unknown): FlashStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as FlashStatus;
	if (typeof record.running !== "boolean") {
		return null;
	}
	if (
		record.last !== null &&
		record.last !== undefined &&
		typeof record.last !== "object"
	) {
		return null;
	}
	return record;
}

export function asRunStatus(payload: unknown): RunStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as RunStatus;
	if (typeof record.running !== "boolean") {
		return null;
	}
	if (typeof record.log !== "string") {
		return null;
	}
	if (
		record.last !== null &&
		record.last !== undefined &&
		typeof record.last !== "object"
	) {
		return null;
	}
	return record;
}

export function asArduinoProxyStatus(
	payload: unknown,
): ArduinoProxyStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as ArduinoProxyStatus;
	if (typeof record.connected !== "boolean") {
		return null;
	}
	return record;
}
