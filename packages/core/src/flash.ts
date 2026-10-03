export const FLASH_PATH = "/v1/flash";
export const FLASH_PORTS_PATH = "/v1/flash/ports";
export const FLASH_SKETCHES_PATH = "/v1/flash/sketches";
export const FLASH_PROXY_PATH = "/v1/flash/proxy";
export const FLASH_LOG_MAX = 16 * 1024;

export type FlashPort = {
	address: string;
	protocol?: string;
	fqbn?: string;
	name?: string;
};

export type FlashTargetHint = {
	connected?: boolean;
	port?: string;
	fqbn?: string;
	baud?: number;
};

export type FlashTarget = {
	port: string;
	fqbn: string;
	baud?: number;
};

const USB_ARDUINO_PORT = /^\/(?:.*\/)?tty(USB|ACM)[0-9]+$/;

export function isUsbArduinoPort(address: string): boolean {
	return USB_ARDUINO_PORT.test(address);
}

export function pickProxyFlashPort(
	ports: FlashPort[],
	requested?: string,
): string | undefined {
	const usb = ports.filter((port) => isUsbArduinoPort(port.address));
	if (requested && isUsbArduinoPort(requested)) {
		return requested;
	}
	return usb.find((port) => port.fqbn)?.address ?? usb[0]?.address;
}

export function pickFlashTarget(
	ports: FlashPort[],
	hint?: FlashTargetHint | null,
): FlashTarget {
	const connected = hint?.connected === true;
	const hintPort = hint?.port?.trim() ?? "";
	const hintFqbn = hint?.fqbn?.trim() ?? "";
	const matched = connected
		? (ports.find((item) => hintPort && item.address === hintPort) ??
			ports.find(
				(item) =>
					hintFqbn &&
					(item.fqbn === hintFqbn || item.fqbn?.startsWith(`${hintFqbn}:`)),
			))
		: undefined;
	const fallback = ports.find((item) => item.fqbn?.trim()) ?? ports[0];
	if (connected) {
		return {
			port: matched?.address || hintPort || fallback?.address || "",
			fqbn: matched?.fqbn?.trim() || hintFqbn || fallback?.fqbn?.trim() || "",
			baud: hint?.baud,
		};
	}
	return {
		port: fallback?.address ?? "",
		fqbn: fallback?.fqbn?.trim() ?? "",
	};
}

export type FlashPut = {
	fqbn: string;
	dir: string;
	port?: string;
};

export type FlashResult = {
	ok: boolean;
	fqbn: string;
	dir: string;
	port?: string;
	log: string;
	startedAt: number;
	finishedAt: number;
};

export type FlashStatus = {
	running: boolean;
	last: FlashResult | null;
};

export class FlashError extends Error {
	readonly status: 400 | 409;

	constructor(message: string, status: 400 | 409 = 400) {
		super(message);
		this.name = "FlashError";
		this.status = status;
	}
}

export function isFlashPath(path: string): boolean {
	return (
		path === FLASH_PATH ||
		path === FLASH_PORTS_PATH ||
		path === FLASH_SKETCHES_PATH ||
		path === FLASH_PROXY_PATH
	);
}

export function parseFlashPut(input: unknown): FlashPut {
	if (input === null || typeof input !== "object") {
		throw new FlashError("flash must be an object");
	}
	const record = input as Record<string, unknown>;
	const fqbn = requiredToken(record.fqbn, "fqbn");
	const dir = requiredDir(record.dir);
	const put: FlashPut = { fqbn, dir };
	if (record.port !== undefined && record.port !== "") {
		put.port = requiredToken(record.port, "port");
	}
	return put;
}

export function capFlashLog(log: string): string {
	if (log.length <= FLASH_LOG_MAX) {
		return log;
	}
	return log.slice(log.length - FLASH_LOG_MAX);
}

export function parseArduinoBoardList(input: unknown): FlashPort[] {
	let parsed = input;
	if (typeof input === "string") {
		try {
			parsed = JSON.parse(input) as unknown;
		} catch {
			return [];
		}
	}
	const detected = portsArray(parsed);
	const ports: FlashPort[] = [];
	for (const item of detected) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const row = item as Record<string, unknown>;
		const port =
			row.port && typeof row.port === "object"
				? (row.port as Record<string, unknown>)
				: row;
		const address = stringField(port.address) || stringField(port.label);
		if (!address || !isUsbArduinoPort(address)) {
			continue;
		}
		const props =
			port.properties && typeof port.properties === "object"
				? (port.properties as Record<string, unknown>)
				: {};
		const picked = pickArduinoProxyFqbn({
			boards: listedBoards(row.matching_boards),
			vid: stringField(props.vid) || stringField(props.VID),
			pid: stringField(props.pid) || stringField(props.PID),
			label: [
				stringField(port.label),
				stringField(props.product),
				stringField(props.Product),
			]
				.filter(Boolean)
				.join(" "),
		});
		ports.push({
			address,
			protocol: stringField(port.protocol) || undefined,
			fqbn: picked.fqbn,
			name: picked.name,
		});
	}
	return ports;
}

function portsArray(parsed: unknown): unknown[] {
	if (Array.isArray(parsed)) {
		return parsed;
	}
	if (parsed && typeof parsed === "object") {
		const record = parsed as Record<string, unknown>;
		if (Array.isArray(record.detected_ports)) {
			return record.detected_ports;
		}
		if (Array.isArray(record.ports)) {
			return record.ports;
		}
	}
	return [];
}

function requiredToken(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new FlashError(`${field} is required`);
	}
	const trimmed = value.trim();
	if (!/^[A-Za-z0-9/._:-]+$/.test(trimmed)) {
		throw new FlashError(`${field} is invalid`);
	}
	return trimmed;
}

function requiredDir(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new FlashError("dir is required");
	}
	const dir = value.trim();
	if (!dir.startsWith("/") || dir.includes("..")) {
		throw new FlashError("dir must be an absolute path");
	}
	return dir;
}

const MEGA_USB_IDS = new Set([
	"2341:0010",
	"2341:0042",
	"2341:0210",
	"2341:0242",
	"2a03:0010",
	"2a03:0042",
]);

function listedBoards(
	value: unknown,
): Array<{ fqbn: string; name: string }> {
	if (!Array.isArray(value)) {
		return [];
	}
	const boards: Array<{ fqbn: string; name: string }> = [];
	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const board = item as Record<string, unknown>;
		const fqbn = stringField(board.fqbn);
		const name = stringField(board.name);
		if (!fqbn && !name) {
			continue;
		}
		boards.push({ fqbn, name });
	}
	return boards;
}

export function pickArduinoProxyFqbn(input: {
	boards: Array<{ fqbn?: string; name?: string }>;
	vid?: string;
	pid?: string;
	label?: string;
}): { fqbn?: string; name?: string } {
	const vid = usbToken(input.vid ?? "");
	const pid = usbToken(input.pid ?? "");
	const usb = vid && pid ? `${vid}:${pid}` : "";
	const label = (input.label ?? "").toLowerCase();
	const megaNamed = input.boards.find((board) =>
		/mega/i.test(`${board.fqbn ?? ""} ${board.name ?? ""}`),
	);
	if (MEGA_USB_IDS.has(usb) || megaNamed || label.includes("mega")) {
		return {
			fqbn: "arduino:avr:mega",
			name: megaNamed?.name || "Arduino Mega 2560",
		};
	}
	const known = input.boards.filter((board) => board.fqbn);
	if (known.length !== 1) {
		return {};
	}
	const only = known[0];
	if (!only?.fqbn) {
		return {};
	}
	return {
		fqbn: only.fqbn.startsWith("arduino:avr:mega")
			? "arduino:avr:mega"
			: only.fqbn,
		name: only.name || undefined,
	};
}

function usbToken(value: string): string {
	const trimmed = value.trim().toLowerCase().replace(/^0x/, "");
	if (!trimmed) {
		return "";
	}
	return trimmed.padStart(4, "0");
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
