import { dashboardUrl } from "./config.ts";
import {
	isOfflineSignFallback,
	liveOfflineKey,
	loadOfflineKey,
	type StoredOfflineKey,
	saveOfflineKey,
	shouldMintOfflineKey,
	signWithStoredKey,
} from "./offline-keys.ts";

export type ActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: string };

export class UnauthorizedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export type TokenProvider = () => Promise<string | null>;

const REQUEST_TIMEOUT_MS = 15_000;

let tokenProvider: TokenProvider | null = null;
let sessionLost: (() => void) | null = null;

export function setTokenProvider(provider: TokenProvider | null): void {
	tokenProvider = provider;
}

export function setSessionLostHandler(handler: (() => void) | null): void {
	sessionLost = handler;
}

function loseSession(): void {
	sessionLost?.();
}

function isLoginRequired(error: string): boolean {
	const normalized = error.trim().toLowerCase();
	return (
		normalized === "sign in first" ||
		normalized === "login first" ||
		normalized.startsWith("sign in first") ||
		normalized.startsWith("login first")
	);
}

async function fetchOnce(
	token: string,
	path: string,
	init: RequestInit,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(`${dashboardUrl}${path}`, {
			...init,
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
				...init.headers,
			},
			signal: controller.signal,
		});
	} catch (caught) {
		if (
			caught instanceof Error &&
			(caught.name === "AbortError" || /abort/i.test(caught.message))
		) {
			throw new Error(
				"request timed out — check your connection and try again",
			);
		}
		throw new Error(
			`could not reach gpio-companion.com — ${
				caught instanceof Error ? caught.message : "network error"
			}`,
		);
	} finally {
		clearTimeout(timer);
	}
}

type Parsed<T> =
	| { ok: true; data: T }
	| { ok: false; unauthorized: boolean; error: string };

async function parseResponse<T>(response: Response): Promise<Parsed<T>> {
	const text = await response.text();
	let body: unknown = null;
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}
	}
	if (
		!body ||
		typeof body !== "object" ||
		typeof (body as { ok?: unknown }).ok !== "boolean"
	) {
		return {
			ok: false,
			unauthorized: response.status === 401,
			error: `gpio-companion.com error (HTTP ${response.status})`,
		};
	}
	const result = body as ActionResult<T>;
	if (result.ok) {
		return { ok: true, data: result.data };
	}
	const error =
		typeof result.error === "string" && result.error.trim().length > 0
			? result.error
			: `request failed (HTTP ${response.status})`;
	const unauthorized = response.status === 401 || isLoginRequired(error);
	return { ok: false, unauthorized, error };
}

async function request<T>(
	token: string,
	path: string,
	init: RequestInit = {},
	retried = false,
): Promise<T> {
	const response = await fetchOnce(token, path, init);
	const parsed = await parseResponse<T>(response);
	if (parsed.ok) {
		return parsed.data;
	}
	if (parsed.unauthorized && !retried) {
		const next = tokenProvider ? await tokenProvider() : null;
		if (next && next !== token) {
			return request(next, path, init, true);
		}
		if (!next) {
			loseSession();
		}
		throw new UnauthorizedError(parsed.error);
	}
	if (parsed.unauthorized) {
		loseSession();
		throw new UnauthorizedError(parsed.error);
	}
	throw new Error(parsed.error);
}

export type Session = {
	id: string | null;
	email: string | null;
	name: string | null;
	role?: string | null;
};

export type Device = {
	uuid: string;
	deviceUrl: string;
	login: string;
	email?: string;
	label?: string;
	userId?: string;
	bleMac?: string;
};

export type DeviceStatus = {
	hardware?: string;
	model?: string;
	tunnel?: { configured?: boolean; apiHostname?: string };
	secrets?: { githubReady?: boolean; gpioAiKey?: boolean };
	network?: {
		type?: "ethernet" | "wifi" | "unknown";
		ssid?: string;
		interface?: string;
		connection?: string;
	} | null;
};

export type BoardView = {
	device: Device;
	status: DeviceStatus | null;
};

export type Credits = { micros: number; usd: number };

export type CreditsUsageKind = "chat" | "embedding" | "stt" | "tts";

export type CreditsUsageSummary = {
	days: number;
	since: string;
	calls: number;
	micros: number;
	byKind: {
		kind: CreditsUsageKind;
		calls: number;
		micros: number;
		promptTokens: number;
		completionTokens: number;
		audioSeconds: number;
		chars: number;
	}[];
	byModel: {
		model: string;
		kind: CreditsUsageKind;
		calls: number;
		micros: number;
		promptTokens: number;
		completionTokens: number;
	}[];
	daily: {
		date: string;
		chat: number;
		embedding: number;
		stt: number;
		tts: number;
	}[];
};

export type GithubRepo = {
	full_name: string;
	name: string;
	owner: string;
	html_url: string;
};

export type GithubContent = {
	name: string;
	path: string;
	type: string;
	download_url: string | null;
};

export type ProjectBranch = {
	name: string;
	sha: string;
	committedAt: string;
};

export type ProjectBundle = {
	owner: string;
	repo: string;
	ref?: string;
	defaultBranch?: string;
	branches?: ProjectBranch[];
	pcb: GithubContent[];
	breadboard: GithubContent[];
	technical: GithubContent[];
	model?: GithubContent[];
	pcbPreviewUrl: string | null;
	breadboardPreviewUrl: string | null;
	breadboardDiagramUrl?: string | null;
	breadboardCircuitJsonUrl?: string | null;
	modelManifestUrl?: string | null;
};

export type GithubAppStatus = {
	connected: boolean;
	login: string;
	installUrl: string;
	canCreate?: boolean;
};

export type PendingRequest = {
	uuid: string;
	requesterEmail?: string;
	login?: string;
	createdAt?: string;
};

export type MaintenanceReport = {
	uuid?: string;
	at?: number;
	diskTotalMb?: number;
	diskAvailMb?: number;
	reclaimedBytes?: number;
	actions?: string[];
};

export type DebugBoard = {
	uuid: string;
	deviceUrl?: string;
	label?: string;
	email?: string;
	login?: string;
	userId?: string;
	paired?: boolean;
	live?: boolean;
	maintenance?: MaintenanceReport | null;
};

export type DebugConnect = {
	wsUrl: string;
	probe: { status: number; error: string; ready: boolean };
};

export type HubTicket = {
	token: string;
	expiresAt: string;
	exp: number;
	wsUrl: string;
};

export type AdminDeviceItem = {
	device: Device;
	status: DeviceStatus | null;
};

export function deviceDisplayName(device: {
	label?: string;
	uuid: string;
	login?: string;
}) {
	return device.label?.trim() || device.login || device.uuid;
}

export function getSession(token: string) {
	return request<Session>(token, "/api/mobile/session");
}

export function listDevices(token: string) {
	return request<{ paired: boolean; devices: Device[] }>(
		token,
		"/api/mobile/devices",
	);
}

export function listDeviceStatus(token: string) {
	return request<{ paired: boolean; devices: BoardView[] }>(
		token,
		"/api/mobile/status",
	);
}

export function patchDeviceLabel(token: string, uuid: string, label: string) {
	return request<{ ok: boolean; device: Device }>(
		token,
		"/api/mobile/devices",
		{
			method: "PATCH",
			body: JSON.stringify({ uuid, label }),
		},
	);
}

export function patchDeviceBleMac(token: string, uuid: string, bleMac: string) {
	return request<{ ok: boolean; device: Device }>(
		token,
		"/api/mobile/devices",
		{
			method: "PATCH",
			body: JSON.stringify({ uuid, bleMac }),
		},
	);
}

export function unpairDevice(token: string, uuid: string) {
	return request(
		token,
		`/api/mobile/devices?uuid=${encodeURIComponent(uuid)}`,
		{ method: "DELETE" },
	);
}

export function signCredentials(token: string) {
	return request<Record<string, unknown>>(token, "/api/mobile/pair", {
		method: "PUT",
	});
}

export function claimDevice(
	token: string,
	input: { uuid: string; key: string; deviceUrl?: string; bleMac?: string },
) {
	return request(token, "/api/mobile/pair", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

async function signOnlineOrOffline(
	token: string,
	path: string,
	body: unknown,
	local: { uuid: string; method: string; path: string; body?: string },
) {
	try {
		return await request<Record<string, unknown>>(token, path, {
			method: "POST",
			body: JSON.stringify(body),
		});
	} catch (error) {
		if (!isOfflineSignFallback(error)) {
			throw error;
		}
		return signWithStoredKey(
			local.uuid,
			local.method,
			local.path,
			local.body ?? "",
		);
	}
}

export function mintOfflineKey(token: string, uuid: string) {
	return request<Omit<StoredOfflineKey, "uuid">>(
		token,
		"/api/mobile/offline-key",
		{
			method: "POST",
			body: JSON.stringify({ uuid }),
		},
	);
}

export async function ensureOfflineKey(token: string, uuid: string) {
	const trimmed = uuid.trim();
	if (!trimmed) {
		return null;
	}
	const existing = await loadOfflineKey(trimmed);
	if (!shouldMintOfflineKey(existing)) {
		return existing;
	}
	try {
		const bundle = await mintOfflineKey(token, trimmed);
		const record: StoredOfflineKey = { uuid: trimmed, ...bundle };
		await saveOfflineKey(record);
		return record;
	} catch {
		return liveOfflineKey(existing);
	}
}

export function signWifi(
	token: string,
	input: { uuid: string; ssid: string; psk: string },
) {
	const ssid = input.ssid.trim();
	return signOnlineOrOffline(token, "/api/mobile/wifi", input, {
		uuid: input.uuid,
		method: "PUT",
		path: "/v1/config/wifi",
		body: JSON.stringify({
			ssid,
			psk: input.psk,
			uuid: input.uuid,
		}),
	});
}

export function opencodeCall(
	token: string,
	body: {
		uuid: string;
		repo: string;
		op: string;
		sessionID?: string;
		permissionID?: string;
		requestID?: string;
		text?: string;
		model?: string;
		variant?: "low" | "medium" | "high";
		response?: "once" | "always" | "reject";
		answers?: string[][];
		reject?: boolean;
		mode?: "ask" | "full";
	},
) {
	return request<unknown>(token, "/api/mobile/opencode", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function signOpencodeLive(token: string, uuid: string, repo: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/opencode/live", {
		method: "POST",
		body: JSON.stringify({ uuid, repo }),
	});
}

export function getCredits(token: string) {
	return request<Credits>(token, "/api/mobile/credits");
}

export function getCreditsUsage(token: string) {
	return request<CreditsUsageSummary>(
		token,
		"/api/mobile/credits/usage?days=30",
	);
}

export function getVoiceSettings(token: string) {
	return request<{ provider: string; voice: string }>(
		token,
		"/api/mobile/voice-settings",
	);
}

export function saveVoiceSettings(
	token: string,
	provider: string,
	voice: string,
) {
	return request<{ provider: string; voice: string }>(
		token,
		"/api/mobile/voice-settings",
		{
			method: "PUT",
			body: JSON.stringify({ provider, voice }),
		},
	);
}

export function getProfile(token: string) {
	return request<{ level: string; context: string } | null>(
		token,
		"/api/mobile/profile",
	);
}

export function saveProfile(
	token: string,
	profile: { level: string; context: string },
) {
	return request<{ level: string; context: string }>(
		token,
		"/api/mobile/profile",
		{
			method: "PUT",
			body: JSON.stringify(profile),
		},
	);
}

export function submitBugReport(
	token: string,
	body: {
		text: string;
		surface: "mobile";
		boardUuid?: string;
		boardModel?: string;
	},
) {
	return request<{ sent: true }>(token, "/api/mobile/support", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function jlcpcbCredentialStatus(token: string) {
	return request<{ configured: boolean }>(
		token,
		"/api/mobile/jlcpcb/credentials",
	);
}

export function searchJlcpcbParts(token: string, query: string) {
	return request<{ parts: unknown }>(token, "/api/mobile/jlcpcb/parts", {
		method: "POST",
		body: JSON.stringify({ query }),
	});
}

export function loadJlcpcbDraft(token: string) {
	return request<{ draft: unknown }>(token, "/api/mobile/jlcpcb/draft");
}

export function startCliLogin(token: string, uuid: string) {
	return request<{ authorizeUrl: string }>(
		token,
		"/api/mobile/jlcpcb/cli/start",
		{
			method: "POST",
			body: JSON.stringify({ uuid }),
		},
	);
}

export function loadShippingAddress(token: string) {
	return request<{ address: unknown }>(token, "/api/mobile/address");
}

export function saveShippingAddress(
	token: string,
	body: {
		name: string;
		line1: string;
		line2: string;
		city: string;
		region: string;
		postalCode: string;
		country: string;
	},
) {
	return request<{ address: unknown }>(token, "/api/mobile/address", {
		method: "PUT",
		body: JSON.stringify(body),
	});
}

export function quoteJlcpcbOrder(token: string, body: Record<string, unknown>) {
	return request<{ quote: unknown }>(token, "/api/mobile/jlcpcb/orders/quote", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function confirmJlcpcbOrder(
	token: string,
	body: Record<string, unknown>,
) {
	return request<{ order: unknown }>(token, "/api/mobile/jlcpcb/orders", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function listProjects(token: string) {
	return request<{ configured: boolean; repos: GithubRepo[] }>(
		token,
		"/api/mobile/projects",
		{ cache: "no-store" },
	);
}

export function loadProject(
	token: string,
	owner: string,
	repo: string,
	ref?: string,
) {
	return request<ProjectBundle>(token, "/api/mobile/projects", {
		method: "POST",
		cache: "no-store",
		body: JSON.stringify({ owner, repo, ...(ref ? { ref } : {}) }),
	});
}

export function readProjectFile(
	token: string,
	owner: string,
	repo: string,
	path: string,
	ref?: string,
) {
	return request<{ text: string; base64?: string }>(
		token,
		"/api/mobile/projects",
		{
			method: "PUT",
			cache: "no-store",
			body: JSON.stringify({ owner, repo, path, ...(ref ? { ref } : {}) }),
		},
	);
}

export function createProject(token: string, name: string) {
	return request<GithubRepo>(token, "/api/mobile/projects", {
		method: "PATCH",
		body: JSON.stringify({ name }),
	});
}

export function deleteProject(token: string, owner: string, name: string) {
	return request<{ deleted: boolean; owner: string; name: string }>(
		token,
		`/api/mobile/projects?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`,
		{ method: "DELETE" },
	);
}

export type ProjectPushResponse = {
	board: {
		committed: boolean;
		pushed: boolean;
		sha: string;
		branch?: string;
		message: string;
	};
	bundle: ProjectBundle;
};

export function pushProject(
	token: string,
	input: { uuid: string; owner: string; name: string },
) {
	return request<ProjectPushResponse>(token, "/api/mobile/projects/push", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export type BoardFileEntry = {
	path: string;
	type: "file" | "dir";
	size: number;
};

export type BoardFileList = {
	branch: string;
	entries: BoardFileEntry[];
};

export type BoardFileRead = {
	path: string;
	kind: "text" | "model" | "image" | "binary";
	text?: string;
	base64?: string;
};

export function listBoardFiles(token: string, uuid: string, name: string) {
	return request<BoardFileList>(token, "/api/mobile/files/list", {
		method: "POST",
		body: JSON.stringify({ uuid, name }),
	});
}

export function readBoardFile(
	token: string,
	uuid: string,
	name: string,
	path: string,
) {
	return request<BoardFileRead>(token, "/api/mobile/files/read", {
		method: "POST",
		body: JSON.stringify({ uuid, name, path }),
	});
}

export function renameBoardFile(
	token: string,
	uuid: string,
	name: string,
	from: string,
	to: string,
) {
	return request<{ written: boolean; path: string }>(
		token,
		"/api/mobile/files/rename",
		{
			method: "POST",
			body: JSON.stringify({ uuid, name, from, to }),
		},
	);
}

export function removeBoardFile(
	token: string,
	uuid: string,
	name: string,
	path: string,
) {
	return request<{ removed: boolean; path: string }>(
		token,
		"/api/mobile/files/remove",
		{
			method: "POST",
			body: JSON.stringify({ uuid, name, path }),
		},
	);
}

export function writeBoardFile(
	token: string,
	uuid: string,
	name: string,
	path: string,
	text: string,
) {
	return request<{ written: boolean; path: string }>(
		token,
		"/api/mobile/files/write",
		{
			method: "PUT",
			body: JSON.stringify({ uuid, name, path, text }),
		},
	);
}

export function uploadBoardFile(
	token: string,
	uuid: string,
	name: string,
	path: string,
	body: { text?: string; base64?: string },
) {
	return request<{ written: boolean; path: string }>(
		token,
		"/api/mobile/files/write",
		{
			method: "PUT",
			body: JSON.stringify({ uuid, name, path, ...body }),
		},
	);
}

export function transcribeCode(token: string, audio: string, locale: string) {
	return request<{ text: string }>(token, "/api/mobile/code/stt", {
		method: "POST",
		body: JSON.stringify({ audio, locale }),
	});
}

export function speakCode(token: string, text: string, locale: string) {
	return request<{ audio: string }>(token, "/api/mobile/code/tts", {
		method: "POST",
		body: JSON.stringify({ text, locale }),
	});
}

export function signBoardFilesLive(token: string, uuid: string, name: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/files/live", {
		method: "POST",
		body: JSON.stringify({ uuid, name }),
	});
}

export function getGithubApp(token: string) {
	return request<GithubAppStatus>(token, "/api/mobile/github-app");
}

export function saveGithubApp(
	token: string,
	input: {
		code?: string;
		state: string;
		installationId?: string;
		redirectUri?: string;
	},
) {
	return request<GithubAppStatus>(token, "/api/mobile/github-app", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function listNotifications(token: string) {
	return request<{ items: PendingRequest[] }>(
		token,
		"/api/mobile/notifications",
	);
}

export function resolveNotification(
	token: string,
	uuid: string,
	action: "accept" | "reject",
) {
	return request<{ ok: boolean; action: string }>(
		token,
		"/api/mobile/notifications",
		{
			method: "POST",
			body: JSON.stringify({ uuid, action }),
		},
	);
}

export function listDebugBoards(token: string) {
	return request<{ devices: DebugBoard[] }>(token, "/api/mobile/debug");
}

export function connectDebug(token: string, uuid: string) {
	return request<DebugConnect>(token, "/api/mobile/debug", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function debugWsUrlFromConnect(next: DebugConnect): string {
	if (!next.probe?.ready) {
		throw new Error(debugProbeMessage(next.probe));
	}
	const wsUrl = next.wsUrl?.trim() ?? "";
	if (!wsUrl) {
		throw new Error("missing websocket url");
	}
	return wsUrl;
}

function debugProbeMessage(probe?: DebugConnect["probe"]): string {
	if (!probe) {
		return "companion unreachable";
	}
	if (probe.ready) {
		return "";
	}
	if (probe.status === 404 && probe.error === "not found") {
		return "Companion firmware is too old for debug. Update companion.";
	}
	if (probe.status === 401 && probe.error === "missing device signature") {
		return "Companion firmware is too old for debug. Update companion.";
	}
	if (!probe.status) {
		return probe.error;
	}
	return `${probe.status} ${probe.error}`;
}

export function mintHubTicket(token: string, uuid: string) {
	return request<HubTicket>(token, "/api/mobile/hub", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function loadDeviceLogs(token: string, uuid: string) {
	return request<{ text: string }>(
		token,
		`/api/mobile/logs?uuid=${encodeURIComponent(uuid)}`,
	);
}

export type GpioPinState = {
	physical: number;
	name: string;
	type: string;
	dir?: "in" | "out" | "pwm" | "off";
	value?: 0 | 1;
	pwm?: number;
	analog?: number;
	hz?: number;
	adc?: number;
	reserved?: boolean;
	unresolved?: boolean;
	sketch?: boolean;
};

export type GpioTarget = "header" | "arduino-proxy";

export type GpioSnapshot = {
	hardware: string;
	pins: GpioPinState[];
	target?: GpioTarget;
	proxy?: { fqbn?: string; name?: string };
	sketch?: boolean;
};

export function loadGpio(token: string, uuid: string) {
	return request<GpioSnapshot>(
		token,
		`/api/mobile/gpio?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function putGpio(
	token: string,
	input: {
		uuid: string;
		physical: number;
		dir?: string;
		value?: number;
		analog?: number;
		op?: string;
		hz?: number;
		target?: GpioTarget;
	},
) {
	return request<GpioSnapshot>(token, "/api/mobile/gpio", {
		method: "PUT",
		body: JSON.stringify(input),
	});
}

export function connectGpioLive(token: string, uuid: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/gpio-live", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function connectConsoleLive(token: string, uuid: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/console-live", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function connectSshLive(token: string, uuid: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/ssh-live", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function connectUiLive(token: string, uuid: string) {
	return request<{ wsUrl: string }>(token, "/api/mobile/ui-live", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export type AppLiveGrant = {
	name: string;
	token: string;
	path: string;
	expiresAt: number;
	url: string;
};

export function mintAppFrame(token: string, uuid: string, appId: string) {
	return request<AppLiveGrant>(token, "/api/mobile/app-live", {
		method: "POST",
		body: JSON.stringify({ uuid, appId }),
	});
}

export type BoardApp = {
	project: string;
	dir: string;
	name: string;
	entry: string;
};

export type AppStatus = {
	running: boolean;
	name: string | null;
	repo: string | null;
	port: number | null;
	startedAt: number | null;
	log: string;
};

export function loadBoardApps(token: string, uuid: string) {
	return request<{ apps: BoardApp[] }>(
		token,
		`/api/mobile/app?uuid=${encodeURIComponent(uuid)}&apps=1`,
	);
}

export function loadAppStatus(token: string, uuid: string) {
	return request<AppStatus>(
		token,
		`/api/mobile/app?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startApp(
	token: string,
	input: { uuid: string; repo: string; dir: string },
) {
	return request<{ started: boolean; name: string; port: number }>(
		token,
		"/api/mobile/app",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function stopApp(token: string, uuid: string) {
	return request<{ stopped: boolean }>(token, "/api/mobile/app", {
		method: "POST",
		body: JSON.stringify({ uuid, stop: true }),
	});
}

export function startUsbConsole(
	token: string,
	input: { uuid: string; port: string; baud?: number },
) {
	return request<{ started: boolean }>(token, "/api/mobile/console", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function stopUsbConsole(token: string, uuid: string) {
	return request<{ stopped: boolean }>(token, "/api/mobile/console", {
		method: "POST",
		body: JSON.stringify({ uuid, stop: true }),
	});
}

export function signConsole(
	token: string,
	input: {
		uuid: string;
		port?: string;
		baud?: number;
		stop?: boolean;
		sign?: boolean;
	},
) {
	const stop = Boolean(input.stop);
	const start = Boolean(input.port);
	return signOnlineOrOffline(token, "/api/mobile/console", input, {
		uuid: input.uuid,
		method: stop || start ? "POST" : "GET",
		path: stop
			? "/v1/console/usb/stop"
			: start
				? "/v1/console/usb"
				: "/v1/console",
		body: stop
			? "{}"
			: start
				? JSON.stringify({ port: input.port, baud: input.baud })
				: "",
	});
}

export function signGpio(
	token: string,
	input: { uuid: string; physical?: number; dir?: string; value?: number },
) {
	const put = input.physical !== undefined;
	return signOnlineOrOffline(token, "/api/mobile/gpio", input, {
		uuid: input.uuid,
		method: put ? "PUT" : "GET",
		path: "/v1/gpio",
		body: put
			? JSON.stringify({
					physical: input.physical,
					dir: input.dir,
					value: input.value,
				})
			: "",
	});
}

export type FlashPort = {
	address: string;
	protocol?: string;
	fqbn?: string;
	name?: string;
};

export type FlashStatus = {
	running: boolean;
	last: {
		ok: boolean;
		fqbn: string;
		dir: string;
		port?: string;
		log: string;
	} | null;
};

export function loadFlash(token: string, uuid: string) {
	return request<FlashStatus>(
		token,
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function loadFlashPorts(token: string, uuid: string) {
	return request<{ ports: FlashPort[] }>(
		token,
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}&ports=1`,
	);
}

export type BoardSketch = {
	project: string;
	name: string;
	dir: string;
	files: string[];
};

export function loadRunSketches(token: string, uuid: string) {
	return request<{ sketches: BoardSketch[] }>(
		token,
		`/api/mobile/run?uuid=${encodeURIComponent(uuid)}&sketches=1`,
	);
}

export function loadFlashSketches(token: string, uuid: string) {
	return request<{ sketches: BoardSketch[] }>(
		token,
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}&sketches=1`,
	);
}

export function startFlash(
	token: string,
	input: { uuid: string; fqbn: string; dir: string; port?: string },
) {
	return request<{ started: boolean }>(token, "/api/mobile/flash", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export type ArduinoProxyStatus = {
	connected: boolean;
	protocol?: string;
	port?: string;
	fqbn?: string;
	name?: string;
	voltage?: string;
};

export function loadArduinoProxy(token: string, uuid: string) {
	return request<ArduinoProxyStatus>(
		token,
		`/api/mobile/arduino-proxy?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startFlashProxy(
	token: string,
	input: { uuid: string; fqbn?: string; port?: string },
) {
	return request<{ started: boolean }>(token, "/api/mobile/arduino-proxy", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export type RunStatus = {
	running: boolean;
	log: string;
	last: {
		ok: boolean;
		dir: string;
		log: string;
	} | null;
};

export function loadRun(token: string, uuid: string) {
	return request<RunStatus>(
		token,
		`/api/mobile/run?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startRun(token: string, input: { uuid: string; dir: string }) {
	return request<{ started: boolean }>(token, "/api/mobile/run", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function stopRun(token: string, uuid: string) {
	return request<{ stopped: boolean }>(token, "/api/mobile/run", {
		method: "POST",
		body: JSON.stringify({ uuid, stop: true }),
	});
}

export type CircuitVerifyState = {
	running: boolean;
	results: Array<{
		id: string;
		status: string;
		detail: string;
		kind: string;
		partIds: string[];
		pins: number[];
		connections: number[];
		net: string;
	}>;
	last: {
		ok: boolean;
		repo: string;
		results: CircuitVerifyState["results"];
	} | null;
};

export function loadVerify(token: string, uuid: string) {
	return request<CircuitVerifyState>(
		token,
		`/api/mobile/verify?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startVerify(
	token: string,
	input: { uuid: string; repo: string },
) {
	return request<{ started: boolean }>(token, "/api/mobile/verify", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function stopVerify(token: string, uuid: string) {
	return request<{ stopped: boolean }>(token, "/api/mobile/verify", {
		method: "POST",
		body: JSON.stringify({ uuid, stop: true }),
	});
}

export function signVerify(
	token: string,
	input: {
		uuid: string;
		repo?: string;
		stop?: boolean;
		sign?: boolean;
	},
) {
	const start = Boolean(input.repo);
	const stop = Boolean(input.stop);
	return signOnlineOrOffline(token, "/api/mobile/verify", input, {
		uuid: input.uuid,
		method: stop || start ? "POST" : "GET",
		path: stop ? "/v1/verify/stop" : "/v1/verify",
		body: stop ? "{}" : start ? JSON.stringify({ repo: input.repo }) : "",
	});
}

export function signRun(
	token: string,
	input: {
		uuid: string;
		dir?: string;
		stop?: boolean;
		sign?: boolean;
	},
) {
	const start = Boolean(input.dir);
	const stop = Boolean(input.stop);
	return signOnlineOrOffline(token, "/api/mobile/run", input, {
		uuid: input.uuid,
		method: stop || start ? "POST" : "GET",
		path: stop ? "/v1/run/stop" : "/v1/run",
		body: stop ? "{}" : start ? JSON.stringify({ dir: input.dir }) : "",
	});
}

export function signFlash(
	token: string,
	input: {
		uuid: string;
		fqbn?: string;
		dir?: string;
		port?: string;
		ports?: boolean;
		sign?: boolean;
	},
) {
	const flash = Boolean(input.fqbn);
	const ports = Boolean(input.ports);
	const put: { fqbn?: string; dir?: string; port?: string } = {};
	if (flash) {
		put.fqbn = input.fqbn;
		put.dir = input.dir;
		if (input.port) {
			put.port = input.port;
		}
	}
	return signOnlineOrOffline(token, "/api/mobile/flash", input, {
		uuid: input.uuid,
		method: flash ? "POST" : "GET",
		path: ports ? "/v1/flash/ports" : "/v1/flash",
		body: flash ? JSON.stringify(put) : "",
	});
}

export function loadDeviceInfo(token: string, uuid: string) {
	return request<{ info: unknown }>(
		token,
		`/api/mobile/info?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function signDeviceInfo(token: string, uuid: string) {
	return signOnlineOrOffline(
		token,
		"/api/mobile/info",
		{ uuid },
		{ uuid, method: "GET", path: "/v1/info" },
	);
}

export function startDeviceUpdate(token: string, uuid: string) {
	return request<{ started: boolean }>(token, "/api/mobile/update", {
		method: "POST",
		body: JSON.stringify({ uuid }),
	});
}

export function listAdminDevices(token: string) {
	return request<{ devices: AdminDeviceItem[] }>(
		token,
		"/api/mobile/admin/devices",
	);
}

export function patchAdminLabel(token: string, uuid: string, label: string) {
	return request<{ ok: boolean; device: Device }>(
		token,
		"/api/mobile/admin/devices",
		{
			method: "PATCH",
			body: JSON.stringify({ uuid, label }),
		},
	);
}

export function adminUnpair(token: string, uuid: string) {
	return request(
		token,
		`/api/mobile/admin/devices?uuid=${encodeURIComponent(uuid)}`,
		{ method: "DELETE" },
	);
}

export function adminTransfer(token: string, uuid: string, toUserId?: string) {
	return request<{ ok: boolean; device: Device }>(
		token,
		"/api/mobile/admin/devices",
		{
			method: "POST",
			body: JSON.stringify({ uuid, toUserId }),
		},
	);
}
