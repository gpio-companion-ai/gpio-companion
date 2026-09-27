export type WifiConfig = {
	ssid: string;
	psk: string;
	uuid: string;
};

export type WifiConnectReason =
	| "ssid-not-found"
	| "password"
	| "no-device"
	| "failed";

export const WIFI_CONNECT_MESSAGES: Record<WifiConnectReason, string> = {
	"ssid-not-found": "wifi network not found",
	password: "wifi password incorrect",
	"no-device": "wifi adapter not available",
	failed: "wifi connect failed",
};

export function wifiConnectMessage(reason: WifiConnectReason): string {
	return WIFI_CONNECT_MESSAGES[reason];
}

export class WifiConnectError extends Error {
	readonly reason: WifiConnectReason;

	constructor(reason: WifiConnectReason) {
		super(wifiConnectMessage(reason));
		this.name = "WifiConnectError";
		this.reason = reason;
	}
}

export function classifyWifiConnectError(output: string): WifiConnectReason {
	const text = output.toLowerCase();
	if (
		text.includes("no network with ssid") ||
		text.includes("network could not be found") ||
		/ssid[^\n]*not found/.test(text)
	) {
		return "ssid-not-found";
	}
	if (
		text.includes("secrets were required") ||
		text.includes("psk: property is invalid") ||
		text.includes("wrong password") ||
		text.includes("bad password") ||
		text.includes("802-11-wireless-security")
	) {
		return "password";
	}
	if (
		text.includes("no suitable device") ||
		/device [^\n]* not found/.test(text) ||
		text.includes("wifi is disabled") ||
		text.includes("scanning not allowed") ||
		text.includes("unmanaged")
	) {
		return "no-device";
	}
	return "failed";
}

export function wifiDevicesToClaim(statusText: string): string[] {
	const devices: string[] = [];
	for (const line of statusText.replace(/\r\n/g, "\n").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const first = trimmed.indexOf(":");
		if (first < 0) {
			continue;
		}
		const device = trimmed.slice(0, first);
		const rest = trimmed.slice(first + 1);
		const second = rest.indexOf(":");
		if (second < 0) {
			continue;
		}
		const type = rest.slice(0, second);
		const state = rest.slice(second + 1).split(":", 1)[0] ?? "";
		if (
			device &&
			type === "wifi" &&
			(state === "unmanaged" || state === "unavailable")
		) {
			devices.push(device);
		}
	}
	return devices;
}

export function parseWifiConfig(input: unknown): WifiConfig {
	if (input === null || typeof input !== "object") {
		throw new Error("wifi must be an object");
	}
	const record = input as Record<string, unknown>;
	return {
		ssid: requiredString(record.ssid, "ssid"),
		psk: requiredString(record.psk, "psk"),
		uuid: requiredString(record.uuid, "uuid"),
	};
}

export function publicWifiStatus(ssid: string, connected: boolean) {
	return { ssid, connected };
}

export function publicWifiFailure(ssid: string, reason: WifiConnectReason) {
	return {
		ssid,
		connected: false as const,
		reason,
		error: wifiConnectMessage(reason),
	};
}

export type WifiBleStatus = {
	ok: boolean;
	ssid?: string;
	message: string;
};

export function parseWifiBleStatus(raw: string): WifiBleStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, message: "wifi connect failed" };
	}
	if (!parsed || typeof parsed !== "object") {
		return { ok: false, message: "wifi connect failed" };
	}
	const body = parsed as {
		error?: unknown;
		ssid?: unknown;
		connected?: unknown;
		reason?: unknown;
	};
	const ssid = typeof body.ssid === "string" ? body.ssid : undefined;
	if (typeof body.error === "string" && body.error.trim()) {
		return { ok: false, ssid, message: body.error };
	}
	if (body.connected === false) {
		const reason = body.reason;
		const message =
			typeof reason === "string" && reason in WIFI_CONNECT_MESSAGES
				? wifiConnectMessage(reason as WifiConnectReason)
				: "wifi connect failed";
		return { ok: false, ssid, message };
	}
	if (body.connected === true) {
		return { ok: true, ssid, message: "" };
	}
	return { ok: false, ssid, message: "wifi connect failed" };
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}
	return value.trim();
}
