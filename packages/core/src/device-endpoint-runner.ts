import { ARDUINO_PROXY_PATH } from "./arduino-proxy.ts";
import { BLE_HEALTH_WIFI_PSK, BLE_HEALTH_WIFI_SSID } from "./ble-health.ts";
import {
	CONSOLE_PATH,
	CONSOLE_USB_PATH,
	CONSOLE_USB_STOP_PATH,
} from "./console.ts";
import { DEBUG_EVENT_PATH, DEBUG_PATH, DEBUG_UPGRADE_FAILED } from "./debug.ts";
import { INFO_PATH } from "./device-info.ts";
import {
	FLASH_PATH,
	FLASH_PORTS_PATH,
	FLASH_PROXY_PATH,
	FLASH_SKETCHES_PATH,
} from "./flash.ts";
import { GPIO_PATH } from "./gpio.ts";
import { LOGS_PATH, UPDATE_PATH } from "./maintenance.ts";
import { isOfflineGrantScope, WIFI_PATH } from "./offline-grant.ts";
import { OPENCODE_PROXY_PATH } from "./opencode-server.ts";
import {
	PROJECTS_PUSH_PATH,
	PROJECTS_REMOVE_PATH,
	PROJECTS_SYNC_PATH,
} from "./project-files.ts";
import { RUN_PATH, RUN_SKETCHES_PATH, RUN_STOP_PATH } from "./run.ts";
import { VERIFY_PATH, VERIFY_STOP_PATH } from "./verify.ts";

export type DeviceEndpointAuth = "none" | "master" | "offline" | "offline-deny";
export type DeviceEndpointVia = "any" | "http" | "ble";

export type DeviceEndpointExpect =
	| { kind: "json-keys"; keys: string[] }
	| { kind: "error"; includes: string[]; status?: number }
	| { kind: "gpio-power" }
	| { kind: "wifi-probe" }
	| { kind: "debug-http" }
	| { kind: "gatt-info" };

export type DeviceEndpointProbe = {
	id: string;
	name: string;
	method: string;
	path: string;
	auth: DeviceEndpointAuth;
	via: DeviceEndpointVia;
	body?: (uuid: string) => string;
	expect: DeviceEndpointExpect;
};

export type DeviceEndpointVerdict = {
	pass: boolean;
	detail: string;
};

const INVALID_JSON = "{";
const EMPTY_OBJECT = "{}";

function probe(
	partial: Omit<DeviceEndpointProbe, "body"> & {
		body?: string | ((uuid: string) => string);
	},
): DeviceEndpointProbe {
	const body = partial.body;
	return {
		...partial,
		body:
			typeof body === "string"
				? () => body
				: typeof body === "function"
					? body
					: undefined,
	};
}

export function deviceEndpointProbes(): DeviceEndpointProbe[] {
	const master: DeviceEndpointProbe[] = [
		probe({
			id: "gatt-info",
			name: "READ GATT info",
			method: "READ",
			path: "info",
			auth: "none",
			via: "ble",
			expect: { kind: "gatt-info" },
		}),
		probe({
			id: "get-health",
			name: "GET /health",
			method: "GET",
			path: "/health",
			auth: "none",
			via: "http",
			expect: { kind: "json-keys", keys: ["ok", "version"] },
		}),
		probe({
			id: "get-status",
			name: "GET /v1/status",
			method: "GET",
			path: "/v1/status",
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["hardware", "pairing", "tunnel"] },
		}),
		probe({
			id: "get-pairing",
			name: "GET /v1/pairing",
			method: "GET",
			path: "/v1/pairing",
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["uuid", "paired"] },
		}),
		probe({
			id: "get-pairing-credentials",
			name: "GET /v1/pairing/credentials",
			method: "GET",
			path: "/v1/pairing/credentials",
			auth: "master",
			via: "http",
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "post-pairing-claim",
			name: "POST /v1/pairing/claim",
			method: "POST",
			path: "/v1/pairing/claim",
			auth: "master",
			via: "any",
			body: EMPTY_OBJECT,
			expect: { kind: "error", includes: ["uuid"] },
		}),
		probe({
			id: "post-pairing-transfer",
			name: "POST /v1/pairing/transfer",
			method: "POST",
			path: "/v1/pairing/transfer",
			auth: "master",
			via: "any",
			body: EMPTY_OBJECT,
			expect: { kind: "error", includes: ["uuid"] },
		}),
		probe({
			id: "post-pairing-unpair",
			name: "POST /v1/pairing/unpair",
			method: "POST",
			path: "/v1/pairing/unpair",
			auth: "master",
			via: "any",
			body: EMPTY_OBJECT,
			expect: { kind: "error", includes: ["uuid"] },
		}),
		probe({
			id: "get-config",
			name: "GET /v1/config",
			method: "GET",
			path: "/v1/config",
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["hardware", "tunnel"] },
		}),
		probe({
			id: "put-config",
			name: "PUT /v1/config",
			method: "PUT",
			path: "/v1/config",
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "put-config-tunnel",
			name: "PUT /v1/config/tunnel",
			method: "PUT",
			path: "/v1/config/tunnel",
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "get-ai-key",
			name: "GET /v1/config/ai-key",
			method: "GET",
			path: "/v1/config/ai-key",
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["gpioAiKey"] },
		}),
		probe({
			id: "get-secrets",
			name: "GET /v1/config/secrets",
			method: "GET",
			path: "/v1/config/secrets",
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["githubReady"] },
		}),
		probe({
			id: "put-secrets",
			name: "PUT /v1/config/secrets",
			method: "PUT",
			path: "/v1/config/secrets",
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "put-wifi",
			name: "PUT /v1/config/wifi",
			method: "PUT",
			path: WIFI_PATH,
			auth: "master",
			via: "any",
			body: (uuid) =>
				JSON.stringify({
					ssid: BLE_HEALTH_WIFI_SSID,
					psk: BLE_HEALTH_WIFI_PSK,
					uuid,
				}),
			expect: { kind: "wifi-probe" },
		}),
		probe({
			id: "put-github",
			name: "PUT /v1/config/github",
			method: "PUT",
			path: "/v1/config/github",
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "get-logs",
			name: "GET /v1/logs",
			method: "GET",
			path: LOGS_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["text", "sinceHours"] },
		}),
		probe({
			id: "get-info",
			name: "GET /v1/info",
			method: "GET",
			path: INFO_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["dashboardUrl"] },
		}),
		probe({
			id: "get-gpio",
			name: "GET /v1/gpio",
			method: "GET",
			path: GPIO_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["pins"] },
		}),
		probe({
			id: "put-gpio-power",
			name: "PUT /v1/gpio",
			method: "PUT",
			path: GPIO_PATH,
			auth: "master",
			via: "any",
			body: JSON.stringify({ physical: 1, dir: "out", value: 1 }),
			expect: { kind: "gpio-power" },
		}),
		probe({
			id: "get-flash",
			name: "GET /v1/flash",
			method: "GET",
			path: FLASH_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["running"] },
		}),
		probe({
			id: "get-flash-ports",
			name: "GET /v1/flash/ports",
			method: "GET",
			path: FLASH_PORTS_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["ports"] },
		}),
		probe({
			id: "get-flash-sketches",
			name: "GET /v1/flash/sketches",
			method: "GET",
			path: FLASH_SKETCHES_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["sketches"] },
		}),
		probe({
			id: "post-flash",
			name: "POST /v1/flash",
			method: "POST",
			path: FLASH_PATH,
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "get-arduino-proxy",
			name: "GET /v1/arduino-proxy",
			method: "GET",
			path: ARDUINO_PROXY_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["connected"] },
		}),
		probe({
			id: "post-flash-proxy",
			name: "POST /v1/flash/proxy",
			method: "POST",
			path: FLASH_PROXY_PATH,
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "get-run",
			name: "GET /v1/run",
			method: "GET",
			path: RUN_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["running"] },
		}),
		probe({
			id: "get-run-sketches",
			name: "GET /v1/run/sketches",
			method: "GET",
			path: RUN_SKETCHES_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["sketches"] },
		}),
		probe({
			id: "post-run",
			name: "POST /v1/run",
			method: "POST",
			path: RUN_PATH,
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "post-run-stop",
			name: "POST /v1/run/stop",
			method: "POST",
			path: RUN_STOP_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["stopped"] },
		}),
		probe({
			id: "get-verify",
			name: "GET /v1/verify",
			method: "GET",
			path: VERIFY_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["running"] },
		}),
		probe({
			id: "post-verify",
			name: "POST /v1/verify",
			method: "POST",
			path: VERIFY_PATH,
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "post-verify-stop",
			name: "POST /v1/verify/stop",
			method: "POST",
			path: VERIFY_STOP_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["stopped"] },
		}),
		probe({
			id: "get-console",
			name: "GET /v1/console",
			method: "GET",
			path: CONSOLE_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["host", "usb"] },
		}),
		probe({
			id: "post-console-usb",
			name: "POST /v1/console/usb",
			method: "POST",
			path: CONSOLE_USB_PATH,
			auth: "master",
			via: "any",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "post-console-usb-stop",
			name: "POST /v1/console/usb/stop",
			method: "POST",
			path: CONSOLE_USB_STOP_PATH,
			auth: "master",
			via: "any",
			expect: { kind: "json-keys", keys: ["stopped"] },
		}),
		probe({
			id: "get-debug-http",
			name: "GET /v1/debug",
			method: "GET",
			path: DEBUG_PATH,
			auth: "master",
			via: "http",
			expect: { kind: "debug-http" },
		}),
		probe({
			id: "post-debug-event",
			name: "POST /v1/debug/event",
			method: "POST",
			path: DEBUG_EVENT_PATH,
			auth: "none",
			via: "http",
			body: EMPTY_OBJECT,
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "post-projects-sync",
			name: "POST /v1/projects/sync",
			method: "POST",
			path: PROJECTS_SYNC_PATH,
			auth: "master",
			via: "http",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "post-projects-remove",
			name: "POST /v1/projects/remove",
			method: "POST",
			path: PROJECTS_REMOVE_PATH,
			auth: "master",
			via: "http",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "post-projects-push",
			name: "POST /v1/projects/push",
			method: "POST",
			path: PROJECTS_PUSH_PATH,
			auth: "master",
			via: "http",
			body: INVALID_JSON,
			expect: { kind: "error", includes: ["invalid json"] },
		}),
		probe({
			id: "get-github-token",
			name: "GET /v1/github-token",
			method: "GET",
			path: "/v1/github-token",
			auth: "none",
			via: "http",
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "get-ai",
			name: "GET /v1/ai",
			method: "GET",
			path: "/v1/ai",
			auth: "none",
			via: "http",
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "get-jlcpcb",
			name: "GET /v1/jlcpcb",
			method: "GET",
			path: "/v1/jlcpcb",
			auth: "none",
			via: "http",
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "get-jlcpcb-draft",
			name: "GET /v1/jlcpcb/draft",
			method: "GET",
			path: "/v1/jlcpcb/draft",
			auth: "none",
			via: "http",
			expect: { kind: "error", includes: ["local-only"], status: 403 },
		}),
		probe({
			id: "get-opencode-health",
			name: "GET /v1/opencode/global/health",
			method: "GET",
			path: `${OPENCODE_PROXY_PATH}/global/health`,
			auth: "master",
			via: "http",
			expect: { kind: "json-keys", keys: ["healthy"] },
		}),
	];

	const offline: DeviceEndpointProbe[] = [];
	for (const item of master) {
		if (item.auth !== "master") {
			continue;
		}
		if (item.path === DEBUG_PATH) {
			continue;
		}
		if (
			item.method === "POST" &&
			(item.path === FLASH_PATH ||
				item.path === FLASH_PROXY_PATH ||
				item.path === RUN_PATH ||
				item.path === VERIFY_PATH ||
				item.path === CONSOLE_USB_PATH)
		) {
			offline.push({
				...item,
				id: `offline-${item.id}`,
				name: `offline ${item.name}`,
				auth: "offline",
			});
			continue;
		}
		if (isOfflineGrantScope(item.method, item.path)) {
			offline.push({
				...item,
				id: `offline-${item.id}`,
				name: `offline ${item.name}`,
				auth: "offline",
			});
			continue;
		}
		offline.push({
			id: `offline-deny-${item.id}`,
			name: `offline deny ${item.name}`,
			method: item.method,
			path: item.path,
			auth: "offline-deny",
			via: item.via,
			body: item.body,
			expect: {
				kind: "error",
				includes: ["offline grant scope mismatch"],
				status: 403,
			},
		});
	}

	offline.push(
		probe({
			id: "offline-deny-update",
			name: "offline deny POST /v1/update",
			method: "POST",
			path: UPDATE_PATH,
			auth: "offline-deny",
			via: "any",
			expect: {
				kind: "error",
				includes: ["offline grant scope mismatch"],
				status: 403,
			},
		}),
	);

	return [...master, ...offline];
}

export function parseDeviceEndpointBody(raw: string): unknown {
	const text = raw.trim();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { error: `non-JSON status payload: ${text}` };
	}
}

export function deviceEndpointErrorMessage(body: unknown): string {
	if (!body || typeof body !== "object") {
		return "";
	}
	const error = (body as { error?: unknown }).error;
	return typeof error === "string" ? error.trim() : "";
}

export function evaluateDeviceEndpointProbe(
	probeItem: DeviceEndpointProbe,
	input: {
		selectedUuid?: string;
		status?: number;
		error?: string;
		body?: unknown;
		raw?: string;
	},
): DeviceEndpointVerdict {
	const thrown = input.error?.trim() ?? "";
	const raw =
		input.raw?.trim() ??
		(typeof input.body === "string"
			? input.body
			: JSON.stringify(input.body ?? ""));
	const body = input.body;
	const message = thrown || deviceEndpointErrorMessage(body);
	const status = input.status ?? 0;

	if (probeItem.expect.kind === "gatt-info") {
		if (thrown) {
			return { pass: false, detail: thrown };
		}
		const uuid =
			body && typeof body === "object"
				? String((body as { uuid?: unknown }).uuid ?? "").trim()
				: "";
		if (!uuid) {
			return {
				pass: false,
				detail: "GATT info characteristic did not include a pairing UUID.",
			};
		}
		if (input.selectedUuid && uuid !== input.selectedUuid) {
			return {
				pass: false,
				detail: `GATT info UUID ${uuid} does not match ${input.selectedUuid}.`,
			};
		}
		return { pass: true, detail: `GATT info UUID ${uuid}` };
	}

	if (probeItem.expect.kind === "gpio-power") {
		if (isPowerPinRefusal(message) || isPowerPinRefusal(raw)) {
			return {
				pass: true,
				detail: `Board refused pin 1 as required (${message || raw}).`,
			};
		}
		if (!message) {
			return {
				pass: false,
				detail:
					"PUT /v1/gpio on physical pin 1 should refuse power/GND, but the board accepted the write.",
			};
		}
		return {
			pass: false,
			detail: `PUT /v1/gpio pin 1 returned an unexpected error: ${message}`,
		};
	}

	if (probeItem.expect.kind === "wifi-probe") {
		if (isMissingSsidProbe(message) || isMissingSsidProbe(raw)) {
			return {
				pass: true,
				detail: `WiFi handler ran and rejected the probe SSID (${message || "ssid-not-found"}).`,
			};
		}
		const connected =
			body && typeof body === "object"
				? (body as { connected?: unknown }).connected
				: undefined;
		if (connected === true) {
			return {
				pass: false,
				detail:
					"Probe SSID unexpectedly connected. The healthcheck must not join a real network.",
			};
		}
		return {
			pass: false,
			detail: `PUT /v1/config/wifi failed: ${message || raw || JSON.stringify(body)}`,
		};
	}

	if (probeItem.expect.kind === "debug-http") {
		if (
			status === 400 &&
			/upgrade failed/i.test(message || raw || DEBUG_UPGRADE_FAILED)
		) {
			return { pass: true, detail: "Debug HTTP probe ready (upgrade failed)." };
		}
		if (/upgrade failed/i.test(message) || /upgrade failed/i.test(raw)) {
			return { pass: true, detail: "Debug HTTP probe ready (upgrade failed)." };
		}
		return {
			pass: false,
			detail: `GET /v1/debug expected upgrade failed, got ${status} ${message || raw}`,
		};
	}

	if (probeItem.expect.kind === "error") {
		const haystack = `${status} ${message} ${raw}`.toLowerCase();
		const missing = probeItem.expect.includes.filter(
			(item) => !haystack.includes(item.toLowerCase()),
		);
		if (missing.length > 0) {
			return {
				pass: false,
				detail: `${probeItem.name} expected ${probeItem.expect.includes.join(", ")}; got ${status} ${message || raw}`,
			};
		}
		if (
			probeItem.expect.status &&
			status &&
			status !== probeItem.expect.status
		) {
			return {
				pass: false,
				detail: `${probeItem.name} expected HTTP ${probeItem.expect.status}, got ${status} ${message}`,
			};
		}
		return {
			pass: true,
			detail: message || raw || `${status}`,
		};
	}

	if (probeItem.expect.kind === "json-keys") {
		if (body && typeof body === "object" && !message) {
			const record = body as Record<string, unknown>;
			const missing = probeItem.expect.keys.filter((key) => !(key in record));
			if (missing.length === 0) {
				return { pass: true, detail: `${probeItem.name} JSON ok.` };
			}
		}
		if (
			truncatedOk(probeItem, thrown) ||
			truncatedOk(probeItem, raw) ||
			truncatedOk(probeItem, message)
		) {
			return {
				pass: true,
				detail: `${probeItem.name} received a truncated BLE payload.`,
			};
		}
		if (thrown || message) {
			return {
				pass: false,
				detail: `${probeItem.name} failed: ${thrown || message}`,
			};
		}
		if (!body || typeof body !== "object") {
			return {
				pass: false,
				detail: `${probeItem.name} returned an empty payload.`,
			};
		}
		const record = body as Record<string, unknown>;
		const missing = probeItem.expect.keys.filter((key) => !(key in record));
		return {
			pass: false,
			detail: `${probeItem.name} missing ${missing.join(", ")}. Body: ${JSON.stringify(body)}`,
		};
	}

	return { pass: false, detail: `Unknown expect for ${probeItem.id}` };
}

function truncatedOk(probeItem: DeviceEndpointProbe, text: string): boolean {
	if (!text) {
		return false;
	}
	if (probeItem.path === GPIO_PATH && probeItem.method === "GET") {
		return /"hardware"\s*:/.test(text) && /"pins"\s*:\s*\[/.test(text);
	}
	if (probeItem.path === INFO_PATH && probeItem.method === "GET") {
		return /"dashboardUrl"\s*:/.test(text) || /"deviceAuth"\s*:/.test(text);
	}
	return false;
}

function isPowerPinRefusal(message: string): boolean {
	return /power|gnd|not gpio/i.test(message);
}

function isMissingSsidProbe(message: string): boolean {
	return /ssid-not-found|wifi network not found/i.test(message);
}
