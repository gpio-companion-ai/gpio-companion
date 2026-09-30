import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	isOfflineSignFallback,
	type OfflineGrantBundle,
	shouldMintOfflineKey,
	signOfflineEnvelope,
} from "./offline-sign";

export const DASHBOARD_URL = "https://gpio-companion.com";

export type Device = {
	uuid: string;
	deviceUrl: string;
	login: string;
	email?: string;
	label?: string;
	userId?: string;
	bleMac?: string;
};

export type DeviceList = {
	paired: boolean;
	devices: Device[];
};

export type Session = {
	id: string | null;
	email: string | null;
	name: string | null;
	role?: string | null;
};

export type NearbyBoard = {
	id: string;
	name: string;
	rssi: number | null;
	matched: boolean;
	pairingUuid?: string | null;
	hardware?: string | null;
};

function looksLikeMac(value: string) {
	const hex = value.replace(/[^0-9a-fA-F]/g, "");
	if (hex.length !== 12) {
		return false;
	}
	return [...value].every((ch) => /[0-9a-fA-F:\-_]/.test(ch));
}

export function normalizeBleMac(value: string) {
	const trimmed = value.trim();
	if (!trimmed || !looksLikeMac(trimmed)) {
		return "";
	}
	const hex = trimmed.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
	return hex.match(/.{2}/g)?.join(":") ?? "";
}

export function savedBleId(device: { bleMac?: string } | undefined) {
	return normalizeBleMac(device?.bleMac ?? "");
}

export async function rememberBleMac(uuid: string, id: string) {
	const mac = normalizeBleMac(id);
	if (!uuid.trim() || !mac) {
		return;
	}
	try {
		await apiRequest<{ ok: boolean; device: Device }>(
			"PATCH",
			"/api/mobile/devices",
			{ uuid, bleMac: mac },
		);
	} catch {
		// best-effort; next connect can scan again
	}
}

export async function rememberLastBleMac(uuid: string) {
	try {
		await rememberBleMac(uuid, await call<string>("ble_last_id"));
	} catch {
		// ignore
	}
}

async function withSavedBle<T>(
	uuid: string,
	id: string,
	run: (id: string) => Promise<T>,
): Promise<T> {
	const preferred = id.trim();
	try {
		const result = await run(preferred);
		void rememberLastBleMac(uuid);
		return result;
	} catch (error) {
		if (!preferred) {
			throw error;
		}
		const result = await run("");
		void rememberLastBleMac(uuid);
		return result;
	}
}

function rssiSuffix(
	rssi: number | null,
	t?: (key: "ble.rssi", vars: { n: number }) => string,
) {
	if (rssi == null) {
		return "";
	}
	return t ? t("ble.rssi", { n: rssi }) : ` (${rssi} dBm)`;
}

export function nearbyBoardLabel(
	board: NearbyBoard,
	t?: (
		key: "ble.rssi" | "ble.nearbyRadio",
		vars?: Record<string, string | number>,
	) => string,
) {
	const name = board.name.trim();
	const named = Boolean(name) && !looksLikeMac(name);
	const rssi = rssiSuffix(board.rssi, t);
	if (board.matched) {
		const display = named ? name : "gpio-companion";
		const extra = board.hardware?.trim() || board.pairingUuid?.slice(0, 8);
		return extra ? `${display} (${extra})` : display;
	}
	if (named) {
		return `${name}${rssi}`;
	}
	return t ? t("ble.nearbyRadio", { rssi }) : `Nearby radio${rssi}`;
}

const authRequired = new Set<() => void>();

export function onAuthRequired(handler: () => void): () => void {
	authRequired.add(handler);
	return () => {
		authRequired.delete(handler);
	};
}

function notifyAuthRequired(message: string): void {
	const normalized = message.trim().toLowerCase();
	if (normalized !== "sign in first" && normalized !== "login first") {
		return;
	}
	for (const handler of authRequired) {
		handler();
	}
}

async function call<T>(
	cmd: string,
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return await invoke<T>(cmd, args);
	} catch (caught) {
		const message = typeof caught === "string" ? caught : "request failed";
		notifyAuthRequired(message);
		throw new Error(message);
	}
}

export function authToken() {
	return call<string | null>("auth_token");
}

export function authLogin() {
	return call<void>("auth_login");
}

export function authLogout() {
	return call<void>("auth_logout");
}

export function authSession() {
	return call<Session>("auth_session");
}

export function debugLogs() {
	return call<string[]>("debug_logs");
}

export function listDevices() {
	return call<DeviceList>("devices_list");
}

export function unpairDevice(uuid: string) {
	return call<unknown>("devices_unpair", { uuid });
}

export function bleScan() {
	return call<NearbyBoard[]>("ble_scan");
}

export function bleGattInfo(id = "") {
	return call<{ uuid?: string; hardware?: string; name?: string }>(
		"ble_gatt_info",
		{ id },
	);
}

export type BleHealthHit = {
	id: string;
	body?: unknown;
	raw?: string;
	error?: string;
};

export function bleHealthRun(input: {
	uuid: string;
	id?: string;
	probes: Array<{ id: string; envelope?: unknown }>;
}) {
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		call<BleHealthHit[]>("ble_health_run", {
			uuid: input.uuid,
			id,
			probes: input.probes,
		}),
	);
}

export function blePair(id: string) {
	return call<unknown>("ble_pair", { id });
}

async function loadOfflineKey(uuid: string) {
	return call<OfflineGrantBundle | null>("offline_keys_get", { uuid });
}

export async function saveOfflineKey(record: OfflineGrantBundle) {
	await call<void>("offline_keys_put", { record });
}

export async function ensureOfflineKey(uuid: string) {
	const trimmed = uuid.trim();
	if (!trimmed) {
		return null;
	}
	const existing = await loadOfflineKey(trimmed);
	if (!shouldMintOfflineKey(existing)) {
		return existing;
	}
	try {
		const bundle = await apiRequest<OfflineGrantBundle>(
			"POST",
			"/api/mobile/offline-key",
			{ uuid: trimmed },
		);
		const record = { ...bundle, uuid: trimmed };
		await saveOfflineKey(record);
		return record;
	} catch {
		return existing && existing.exp > Date.now() ? existing : null;
	}
}

async function bleWriteEnvelope(id: string, uuid: string, envelope: unknown) {
	return call<string>("ble_write_envelope", { id, uuid, envelope });
}

function parseBoardJson<T>(raw: string, missing: string): T {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new Error(missing);
	}
	if (
		parsed &&
		typeof parsed === "object" &&
		"error" in parsed &&
		typeof (parsed as { error?: unknown }).error === "string"
	) {
		throw new Error((parsed as { error: string }).error);
	}
	return parsed as T;
}

async function withOfflineBle<T>(
	uuid: string,
	id: string,
	online: () => Promise<T>,
	local: { method: string; path: string; body?: string },
	fromRaw?: (raw: string) => T,
): Promise<T> {
	try {
		return await online();
	} catch (error) {
		if (!isOfflineSignFallback(error)) {
			throw error;
		}
		const record = await loadOfflineKey(uuid);
		if (!record || record.exp <= Date.now()) {
			throw new Error("Go online once to issue a 24h Bluetooth key");
		}
		const envelope = await signOfflineEnvelope({
			bundle: record,
			method: local.method,
			path: local.path,
			body: local.body,
		});
		const raw = await bleWriteEnvelope(id, uuid, envelope);
		if (fromRaw) {
			return fromRaw(raw);
		}
		return raw as T;
	}
}

export function bleWifi(input: {
	uuid: string;
	ssid: string;
	psk: string;
	id: string;
}) {
	return withSavedBle(input.uuid, input.id, (id) =>
		withOfflineBle(
			input.uuid,
			id,
			() => call<string>("ble_wifi", { ...input, id }),
			{
				method: "PUT",
				path: "/v1/config/wifi",
				body: JSON.stringify({
					ssid: input.ssid.trim(),
					psk: input.psk,
					uuid: input.uuid,
				}),
			},
		),
	);
}

export function bleInfo(input: { uuid: string; id?: string }) {
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		withOfflineBle(
			input.uuid,
			id,
			() =>
				call<unknown>("ble_info", {
					uuid: input.uuid,
					id,
				}),
			{ method: "GET", path: "/v1/info" },
			(raw) => parseBoardJson(raw, "board did not return companion info"),
		),
	);
}

export function bleGpio(input: {
	uuid: string;
	id?: string;
	physical?: number;
	dir?: string;
	value?: number;
}) {
	const put = input.physical !== undefined;
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		withOfflineBle(
			input.uuid,
			id,
			() =>
				call<GpioSnapshot>("ble_gpio", {
					uuid: input.uuid,
					id,
					physical: input.physical ?? null,
					dir: input.dir ?? "",
					value: input.value ?? null,
				}),
			{
				method: put ? "PUT" : "GET",
				path: "/v1/gpio",
				body: put
					? JSON.stringify({
							physical: input.physical,
							dir: input.dir,
							value: input.value,
						})
					: "",
			},
			(raw) => parseBoardJson<GpioSnapshot>(raw, "board did not return gpio"),
		),
	);
}

export type KnownNetwork = {
	ssid: string;
	psk: string;
	source: "os" | "saved";
	current: boolean;
};

export function wifiKnownNetworks() {
	return call<KnownNetwork[]>("wifi_known_networks");
}

export function wifiNetworkPsk(ssid: string) {
	return call<string>("wifi_network_psk", { ssid });
}

export function wifiRememberNetwork(ssid: string, psk: string) {
	return call<void>("wifi_remember_network", { ssid, psk });
}

export function knownNetworkLabel(
	network: KnownNetwork,
	t?: (
		key: "wifi.thisComputer" | "wifi.saved",
		vars: { ssid: string },
	) => string,
) {
	if (network.current) {
		return t
			? t("wifi.thisComputer", { ssid: network.ssid })
			: `${network.ssid} (this computer)`;
	}
	if (network.source === "saved") {
		return t
			? t("wifi.saved", { ssid: network.ssid })
			: `${network.ssid} (saved)`;
	}
	return network.ssid;
}

export function onBleStatus(
	handler: (status: string) => void,
): Promise<UnlistenFn> {
	return listen<string>("ble-status", (event) => handler(event.payload));
}

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
	deviceUrl: string;
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

export function apiRequest<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	return call<T>("api_request", {
		method,
		path,
		body: body ?? null,
	});
}

export function openExternal(url: string) {
	return openUrl(url);
}

export function startCliLogin(uuid: string) {
	return apiRequest<{ authorizeUrl: string }>(
		"POST",
		"/api/mobile/jlcpcb/cli/start",
		{ uuid },
	);
}

export function listDeviceStatus() {
	return apiRequest<{ paired: boolean; devices: BoardView[] }>(
		"GET",
		"/api/mobile/status",
	);
}

export function patchDeviceLabel(uuid: string, label: string) {
	return apiRequest<{ ok: boolean; device: Device }>(
		"PATCH",
		"/api/mobile/devices",
		{ uuid, label },
	);
}

export function getCredits() {
	return apiRequest<Credits>("GET", "/api/mobile/credits");
}

export function submitBugReport(body: {
	text: string;
	surface: "desktop";
	boardUuid?: string;
	boardModel?: string;
}) {
	return apiRequest<{ sent: true }>("POST", "/api/mobile/support", body);
}

export function jlcpcbCredentialStatus() {
	return apiRequest<{ configured: boolean }>(
		"GET",
		"/api/mobile/jlcpcb/credentials",
	);
}

export function searchJlcpcbParts(query: string) {
	return apiRequest<{ parts: unknown }>("POST", "/api/mobile/jlcpcb/parts", {
		query,
	});
}

export function loadJlcpcbDraft() {
	return apiRequest<{ draft: unknown }>("GET", "/api/mobile/jlcpcb/draft");
}

export function loadShippingAddress() {
	return apiRequest<{ address: unknown }>("GET", "/api/mobile/address");
}

export function saveShippingAddress(body: {
	name: string;
	line1: string;
	line2: string;
	city: string;
	region: string;
	postalCode: string;
	country: string;
}) {
	return apiRequest<{ address: unknown }>("PUT", "/api/mobile/address", body);
}

export function quoteJlcpcbOrder(body: Record<string, unknown>) {
	return apiRequest<{ quote: unknown }>(
		"POST",
		"/api/mobile/jlcpcb/orders/quote",
		body,
	);
}

export function confirmJlcpcbOrder(body: Record<string, unknown>) {
	return apiRequest<{ order: unknown }>(
		"POST",
		"/api/mobile/jlcpcb/orders",
		body,
	);
}

export function listProjects() {
	return apiRequest<{ configured: boolean; repos: GithubRepo[] }>(
		"GET",
		"/api/mobile/projects",
	);
}

export function loadProject(owner: string, repo: string, ref?: string) {
	return apiRequest<ProjectBundle>("POST", "/api/mobile/projects", {
		owner,
		repo,
		...(ref ? { ref } : {}),
	});
}

export function readProjectFile(
	owner: string,
	repo: string,
	path: string,
	ref?: string,
) {
	return apiRequest<{ text: string; base64?: string }>(
		"PUT",
		"/api/mobile/projects",
		{
			owner,
			repo,
			path,
			...(ref ? { ref } : {}),
		},
	);
}

export function createProject(name: string) {
	return apiRequest<GithubRepo>("PATCH", "/api/mobile/projects", { name });
}

export function deleteProject(owner: string, name: string) {
	return apiRequest<{ deleted: boolean; owner: string; name: string }>(
		"DELETE",
		`/api/mobile/projects?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`,
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

export function pushProject(input: {
	uuid: string;
	owner: string;
	name: string;
}) {
	return apiRequest<ProjectPushResponse>(
		"POST",
		"/api/mobile/projects/push",
		input,
	);
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
	kind: "text" | "model" | "binary";
	text?: string;
	base64?: string;
};

export function listBoardFiles(uuid: string, name: string) {
	return apiRequest<BoardFileList>("POST", "/api/mobile/files/list", {
		uuid,
		name,
	});
}

export function readBoardFile(uuid: string, name: string, path: string) {
	return apiRequest<BoardFileRead>("POST", "/api/mobile/files/read", {
		uuid,
		name,
		path,
	});
}

export function renameBoardFile(
	uuid: string,
	name: string,
	from: string,
	to: string,
) {
	return apiRequest<{ written: boolean; path: string }>(
		"POST",
		"/api/mobile/files/rename",
		{ uuid, name, from, to },
	);
}

export function writeBoardFile(
	uuid: string,
	name: string,
	path: string,
	text: string,
) {
	return apiRequest<{ written: boolean; path: string }>(
		"PUT",
		"/api/mobile/files/write",
		{ uuid, name, path, text },
	);
}

export function uploadBoardFile(
	uuid: string,
	name: string,
	path: string,
	body: { text?: string; base64?: string },
) {
	return apiRequest<{ written: boolean; path: string }>(
		"PUT",
		"/api/mobile/files/write",
		{ uuid, name, path, ...body },
	);
}

export function transcribeCode(audio: string, locale: string) {
	return apiRequest<{ text: string }>("POST", "/api/mobile/code/stt", {
		audio,
		locale,
	});
}

export function signBoardFilesLive(uuid: string, name: string) {
	return apiRequest<{ wsUrl: string }>("POST", "/api/mobile/files/live", {
		uuid,
		name,
	});
}

export function getGithubApp() {
	return apiRequest<GithubAppStatus>("GET", "/api/mobile/github-app");
}

export function saveGithubApp(input: {
	code?: string;
	state: string;
	installationId?: string;
	redirectUri?: string;
}) {
	return apiRequest<GithubAppStatus>("POST", "/api/mobile/github-app", input);
}

export function onGithubAppCallback(
	handler: (url: string) => void,
): Promise<UnlistenFn> {
	return listen<string>("github-app-callback", (event) =>
		handler(event.payload),
	);
}

export function opencodeCall(body: {
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
}) {
	return apiRequest<unknown>("POST", "/api/mobile/opencode", body);
}

export function signOpencodeLive(uuid: string, repo: string) {
	return apiRequest<{ wsUrl: string }>("POST", "/api/mobile/opencode/live", {
		uuid,
		repo,
	});
}

export function listNotifications() {
	return apiRequest<{ items: PendingRequest[] }>(
		"GET",
		"/api/mobile/notifications",
	);
}

export function resolveNotification(uuid: string, action: "accept" | "reject") {
	return apiRequest<{ ok: boolean; action: string }>(
		"POST",
		"/api/mobile/notifications",
		{ uuid, action },
	);
}

export function listDebugBoards() {
	return apiRequest<{ devices: DebugBoard[] }>("GET", "/api/mobile/debug");
}

export function connectDebug(uuid: string) {
	return apiRequest<DebugConnect>("POST", "/api/mobile/debug", { uuid });
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

export function mintHubTicket(uuid: string) {
	return apiRequest<HubTicket>("POST", "/api/mobile/hub", { uuid });
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

export function loadFlash(uuid: string) {
	return apiRequest<FlashStatus>(
		"GET",
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function loadFlashPorts(uuid: string) {
	return apiRequest<{ ports: FlashPort[] }>(
		"GET",
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}&ports=1`,
	);
}

export function startFlash(input: {
	uuid: string;
	fqbn: string;
	dir: string;
	port?: string;
}) {
	return apiRequest<{ started: boolean }>("POST", "/api/mobile/flash", input);
}

export type ArduinoProxyStatus = {
	connected: boolean;
	protocol?: string;
	port?: string;
	fqbn?: string;
	name?: string;
	voltage?: string;
};

export function loadArduinoProxy(uuid: string) {
	return apiRequest<ArduinoProxyStatus>(
		"GET",
		`/api/mobile/arduino-proxy?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startFlashProxy(input: {
	uuid: string;
	fqbn?: string;
	port?: string;
}) {
	return apiRequest<{ started: boolean }>(
		"POST",
		"/api/mobile/arduino-proxy",
		input,
	);
}

export type BoardSketch = {
	project: string;
	name: string;
	dir: string;
	files: string[];
};

export function loadRunSketches(uuid: string) {
	return apiRequest<{ sketches: BoardSketch[] }>(
		"GET",
		`/api/mobile/run?uuid=${encodeURIComponent(uuid)}&sketches=1`,
	);
}

export function loadFlashSketches(uuid: string) {
	return apiRequest<{ sketches: BoardSketch[] }>(
		"GET",
		`/api/mobile/flash?uuid=${encodeURIComponent(uuid)}&sketches=1`,
	);
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

export function loadRun(uuid: string) {
	return apiRequest<RunStatus>(
		"GET",
		`/api/mobile/run?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startRun(input: { uuid: string; dir: string }) {
	return apiRequest<{ started: boolean }>("POST", "/api/mobile/run", input);
}

export function stopRun(uuid: string) {
	return apiRequest<{ stopped: boolean }>("POST", "/api/mobile/run", {
		uuid,
		stop: true,
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

export function loadVerify(uuid: string) {
	return apiRequest<CircuitVerifyState>(
		"GET",
		`/api/mobile/verify?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startVerify(input: { uuid: string; repo: string }) {
	return apiRequest<{ started: boolean }>("POST", "/api/mobile/verify", input);
}

export function stopVerify(uuid: string) {
	return apiRequest<{ stopped: boolean }>("POST", "/api/mobile/verify", {
		uuid,
		stop: true,
	});
}

export function bleVerify(input: {
	uuid: string;
	id?: string;
	repo?: string;
	stop?: boolean;
}) {
	const start = Boolean(input.repo);
	const stop = Boolean(input.stop);
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		withOfflineBle(
			input.uuid,
			id,
			async () => {
				const envelope = await apiRequest<unknown>(
					"POST",
					"/api/mobile/verify",
					{
						uuid: input.uuid,
						repo: input.repo,
						stop: input.stop,
						sign: true,
					},
				);
				const raw = await bleWriteEnvelope(id, input.uuid, envelope);
				return parseBoardJson(raw, "board did not return verify");
			},
			{
				method: stop || start ? "POST" : "GET",
				path: stop ? "/v1/verify/stop" : "/v1/verify",
				body: stop ? "{}" : start ? JSON.stringify({ repo: input.repo }) : "",
			},
			(raw) => parseBoardJson(raw, "board did not return verify"),
		),
	);
}

export function bleRun(input: {
	uuid: string;
	id?: string;
	dir?: string;
	stop?: boolean;
}) {
	const start = Boolean(input.dir);
	const stop = Boolean(input.stop);
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		withOfflineBle(
			input.uuid,
			id,
			() =>
				call<unknown>("ble_run", {
					uuid: input.uuid,
					id,
					dir: input.dir ?? "",
					stop: input.stop ?? false,
				}),
			{
				method: stop || start ? "POST" : "GET",
				path: stop ? "/v1/run/stop" : "/v1/run",
				body: stop ? "{}" : start ? JSON.stringify({ dir: input.dir }) : "",
			},
			(raw) => parseBoardJson(raw, "board did not return run"),
		),
	);
}

export function bleFlash(input: {
	uuid: string;
	id?: string;
	fqbn?: string;
	dir?: string;
	port?: string;
	ports?: boolean;
}) {
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
	return withSavedBle(input.uuid, input.id ?? "", (id) =>
		withOfflineBle(
			input.uuid,
			id,
			() =>
				call<unknown>("ble_flash", {
					uuid: input.uuid,
					id,
					fqbn: input.fqbn ?? "",
					dir: input.dir ?? "",
					port: input.port ?? "",
					ports: input.ports ?? false,
				}),
			{
				method: flash ? "POST" : "GET",
				path: ports ? "/v1/flash/ports" : "/v1/flash",
				body: flash ? JSON.stringify(put) : "",
			},
			(raw) => parseBoardJson(raw, "board did not return flash"),
		),
	);
}

export function loadDeviceLogs(uuid: string) {
	return apiRequest<{ text: string }>(
		"GET",
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
};

export type GpioTarget = "header" | "arduino-proxy";

export type GpioSnapshot = {
	hardware: string;
	pins: GpioPinState[];
	target?: GpioTarget;
	proxy?: { fqbn?: string; name?: string };
};

export function loadGpio(uuid: string) {
	return apiRequest<GpioSnapshot>(
		"GET",
		`/api/mobile/gpio?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function putGpio(input: {
	uuid: string;
	physical: number;
	dir?: string;
	value?: number;
	analog?: number;
	op?: string;
	hz?: number;
	target?: GpioTarget;
}) {
	return apiRequest<GpioSnapshot>("PUT", "/api/mobile/gpio", input);
}

export function connectGpioLive(uuid: string) {
	return apiRequest<{ wsUrl: string }>("POST", "/api/mobile/gpio-live", {
		uuid,
	});
}

export function connectConsoleLive(uuid: string) {
	return apiRequest<{ wsUrl: string }>("POST", "/api/mobile/console-live", {
		uuid,
	});
}

export function startUsbConsole(input: {
	uuid: string;
	port: string;
	baud?: number;
}) {
	return apiRequest<{ started: boolean }>("POST", "/api/mobile/console", input);
}

export function stopUsbConsole(uuid: string) {
	return apiRequest<{ stopped: boolean }>("POST", "/api/mobile/console", {
		uuid,
		stop: true,
	});
}

export function loadDeviceInfo(uuid: string) {
	return apiRequest<{ info: unknown }>(
		"GET",
		`/api/mobile/info?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function startDeviceUpdate(uuid: string) {
	return apiRequest<{ started: boolean }>("POST", "/api/mobile/update", {
		uuid,
	});
}

export function listAdminDevices() {
	return apiRequest<{ devices: AdminDeviceItem[] }>(
		"GET",
		"/api/mobile/admin/devices",
	);
}

export function patchAdminLabel(uuid: string, label: string) {
	return apiRequest<{ ok: boolean; device: Device }>(
		"PATCH",
		"/api/mobile/admin/devices",
		{ uuid, label },
	);
}

export function adminUnpair(uuid: string) {
	return apiRequest<unknown>(
		"DELETE",
		`/api/mobile/admin/devices?uuid=${encodeURIComponent(uuid)}`,
	);
}

export function adminTransfer(uuid: string, toUserId?: string) {
	return apiRequest<{ ok: boolean; device: Device }>(
		"POST",
		"/api/mobile/admin/devices",
		{ uuid, toUserId },
	);
}

export function deviceDisplayName(device: {
	label?: string;
	uuid: string;
	login?: string;
}) {
	return device.label?.trim() || device.login || device.uuid;
}
