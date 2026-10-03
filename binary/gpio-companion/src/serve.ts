import { readFileSync } from "node:fs";
import {
	AGENT_PATH,
	AGENT_STOP_PATH,
	AgentError,
	APP_LIST_PATH,
	APP_PATH,
	APP_START_PATH,
	APP_STOP_PATH,
	AppError,
	ARDUINO_PROXY_PATH,
	ArduinoProxyError,
	appNameFromMintPath,
	CONSOLE_PATH,
	CONSOLE_USB_PATH,
	CONSOLE_USB_STOP_PATH,
	ConsoleError,
	capLogText,
	DEBUG_EVENT_PATH,
	DEBUG_PATH,
	DEFAULT_DEVICE_MAX_SKEW_MS,
	type DebugEvent,
	DeviceAuthError,
	type DeviceConfig,
	type DiskStats,
	debugAuthHeadersFromRequest,
	FILES_LIST_PATH,
	FILES_READ_PATH,
	FILES_REMOVE_PATH,
	FILES_RENAME_PATH,
	FILES_WRITE_PATH,
	FLASH_PATH,
	FLASH_PORTS_PATH,
	FLASH_PROXY_PATH,
	FLASH_SKETCHES_PATH,
	FLASH_STOP_PATH,
	FlashError,
	GPIO_PATH,
	GpioError,
	grantHeaderValue,
	hasDeviceSignature,
	INFO_PATH,
	isAgentPath,
	isAllowedDebugOrigin,
	isAppFrameMintPath,
	isAppManagePath,
	isArduinoProxyFqbn,
	isArduinoProxyPath,
	isConsolePath,
	isFlashPath,
	isGpioBusCommand,
	isGpioWsRefresh,
	isOpencodeProxyPath,
	isRunPath,
	isUiPath,
	isUsbArduinoPort,
	isVerifyPath,
	LOGS_PATH,
	LOGS_SINCE_HOURS,
	mergeDeviceSecrets,
	type NetworkStatus,
	OPENCODE_REPO_HEADER,
	opencodeEventLastId,
	PROJECTS_PUSH_PATH,
	PROJECTS_REMOVE_PATH,
	PROJECTS_SYNC_PATH,
	pairingCredentials,
	parseAppFramePath,
	parseBoardFileListPut,
	parseBoardFileReadPut,
	parseBoardFileRemovePut,
	parseBoardFileRenamePut,
	parseBoardFileWatchPath,
	parseBoardFileWritePut,
	parseDebugEventInput,
	parseDeviceSecrets,
	parseFlashProxyPut,
	parseGpioWsCommand,
	parseOpencodeEventPath,
	parsePairingClaim,
	parsePairingUnpair,
	parseProjectPushPut,
	parseProjectRemovePut,
	parseProjectSyncPut,
	parseTunnelConfig,
	parseUserProfile,
	parseWifiConfig,
	pickProxyFlashPort,
	publicDeviceUrl,
	publicPairing,
	publicWifiFailure,
	publicWifiStatus,
	RUN_PATH,
	RUN_SKETCHES_PATH,
	RUN_STOP_PATH,
	RunError,
	redactDeviceConfig,
	redactLogText,
	scopeOpencodeSearch,
	secretsStatus,
	UI_PATH,
	UI_REPLY_POLL_MS,
	UiError,
	UPDATE_PATH,
	uiReplyIdFromPath,
	VERIFY_PATH,
	VERIFY_STOP_PATH,
	VERSION,
	VerifyError,
	verifyDeviceRequest,
	verifyOfflineEnvelope,
	WifiConnectError,
} from "gpio-companion";
import { type AgentController, createAgentController } from "./agent.ts";
import { type FetchLike, proxyAiRequest } from "./ai-credentials.ts";
import {
	type AppController,
	appUpstreamWsUrl,
	createAppController,
	listBoardApps,
} from "./app-server.ts";
import {
	type ArduinoProxyController,
	createArduinoProxy,
	proxyUploadHooks,
	resolveArduinoProxyDir,
} from "./arduino-proxy.ts";
import {
	type BoardFileHub,
	createBoardFileHub,
	listBoardFiles,
	readBoardFile,
	removeBoardFile,
	renameBoardFile,
	writeBoardFile,
	writeBoardFileBytes,
} from "./board-files.ts";
import { readBoardModel } from "./board-model.ts";
import { type ConsoleHub, createConsoleHub } from "./console.ts";
import { createDebugHub } from "./debug.ts";
import { readDiskStats } from "./disk.ts";
import {
	createArduinoFlash,
	type FlashController,
	invalidateArduinoBoardCache,
} from "./flash.ts";
import type { GithubInstallationCreds } from "./github-credentials.ts";
import {
	createLibgpiodGpio,
	type GpioController,
	readSketchStatus,
} from "./gpio.ts";
import { createGpioStream } from "./gpio-stream.ts";
import { readDeviceInfoJson } from "./info.ts";
import {
	clearCliSession,
	completeJlcpcbLogin,
	type PendingCliLogin,
	startJlcpcbLogin,
} from "./jlcpcb-login.ts";
import { proxyJlcpcbRequest } from "./jlcpcb-proxy.ts";
import { readJournalLogs } from "./logs.ts";
import { readNetworkStatus } from "./network.ts";
import {
	handleOpencodePermissionMode,
	OPENCODE_PERMISSION_MODE_PATH,
} from "./opencode-permission-mode.ts";
import {
	assertOpencodeProxyGranted,
	bridgeOpencodeEvents,
	DEFAULT_OPENCODE_SERVER_ENV,
	proxyOpencodeRequest,
	readOpencodeServerAuth,
} from "./opencode-proxy.ts";
import {
	applyClaim,
	applyTransfer,
	applyUnpair,
	type PairingStore,
} from "./pairing.ts";
import { privileged } from "./priv.ts";
import {
	type ApplyProjectPush,
	type ApplyProjectRemove,
	type ApplyProjects,
	projectsRoot,
} from "./projects.ts";
import { createHostRun, type RunController } from "./run.ts";
import type { SecretsStore } from "./secrets.ts";
import { listBoardSketches } from "./sketches.ts";
import { type ConfigStore, DEFAULT_PORT } from "./store.ts";
import type { ApplyTunnel } from "./tunnel.ts";
import { createUiHub, type UiHub } from "./ui.ts";
import type { ApplyUpdate } from "./update.ts";
import { createCircuitVerify, type VerifyController } from "./verify.ts";
import type { ApplyWifi } from "./wifi.ts";

export type DeviceAuthConfig = {
	keyId: string;
	publicKeyPem: string;
};

export type ApplyClock = (issuedMs: number) => Promise<void>;

export type ServeOptions = {
	port?: number;
	hostname?: string;
	store: ConfigStore;
	secrets: SecretsStore;
	pairing: PairingStore;
	applyTunnel: ApplyTunnel;
	applyWifi?: ApplyWifi;
	applyUpdate?: ApplyUpdate;
	applyProjects?: ApplyProjects;
	applyProjectPush?: ApplyProjectPush;
	applyProjectRemove?: ApplyProjectRemove;
	revokeOpencode?: () => Promise<void>;
	deviceAuth: DeviceAuthConfig;
	githubCredentials?: () => Promise<GithubInstallationCreds>;
	applyClock?: ApplyClock;
	clockStampPath?: string;
	clockTrusted?: () => boolean | Promise<boolean>;
	noncePath?: string;
	nonceStore?: {
		has(nonce: string): boolean;
		add(nonce: string): void;
	};
	dashboardUrl?: string;
	fetchImpl?: FetchLike;
	opencodeFetch?: FetchLike;
	opencodeEnvPath?: string;
	opencodeUpstream?: string;
	readDisk?: () => DiskStats | null;
	readLogs?: () => Promise<string>;
	readNetwork?: () => NetworkStatus | null;
	readInfo?: () => Promise<Record<string, unknown>>;
	gpio?: GpioController;
	flash?: FlashController;
	run?: RunController;
	agent?: AgentController;
	app?: AppController;
	verify?: VerifyController;
	proxy?: ArduinoProxyController;
	console?: ConsoleHub;
	ui?: UiHub;
	uiReplyPollMs?: number;
	projectsDir?: string;
};

export type DeviceRequestExtras = {
	readDisk?: () => DiskStats | null;
	readLogs?: () => Promise<string>;
	readNetwork?: () => NetworkStatus | null;
	readInfo?: () => Promise<Record<string, unknown>>;
	gpio?: GpioController;
	flash?: FlashController;
	run?: RunController;
	agent?: AgentController;
	app?: AppController;
	verify?: VerifyController;
	proxy?: ArduinoProxyController;
	console?: ConsoleHub;
	ui?: UiHub;
	uiReplyPollMs?: number;
	projectsDir?: string;
	applyUpdate?: ApplyUpdate;
	applyProjects?: ApplyProjects;
	applyProjectPush?: ApplyProjectPush;
	applyProjectRemove?: ApplyProjectRemove;
	dashboardUrl?: string;
	fetchImpl?: FetchLike;
	opencodeFetch?: FetchLike;
	opencodeEnvPath?: string;
	opencodeUpstream?: string;
	opencodeJsonPath?: string;
	revokeOpencode?: () => Promise<void>;
	debug?: { publish(event: DebugEvent): void };
	gpioStream?: { publish(): void };
	files?: BoardFileHub;
	startJlcpcbLogin?: () => Promise<PendingCliLogin>;
};

type TunnelWsData = {
	stream: "debug" | "gpio" | "console" | "files" | "opencode" | "ui" | "app";
	repo?: string;
	lastEventId?: string;
	appSuffix?: string;
	appSearch?: string;
	appPort?: number;
	appUpstream?: WebSocket;
	appPending?: Array<string | Uint8Array>;
};

type OpencodeSocket = {
	send(data: string): void;
	close(): void;
	data: TunnelWsData;
};

type AppSocket = {
	send(data: string | ArrayBuffer | Uint8Array): void;
	close(code?: number, reason?: string): void;
	data: TunnelWsData;
};

export type DeviceApiServer = ReturnType<typeof Bun.serve<TunnelWsData>> & {
	run: RunController;
	flash: FlashController;
	verify: VerifyController;
	console: ConsoleHub;
	app: AppController;
};

export function startDeviceApi(options: ServeOptions): DeviceApiServer {
	const port = options.port ?? DEFAULT_PORT;
	const hostname = options.hostname ?? "0.0.0.0";
	const clock = createClockGate(options);
	const nonces = createNonceGate(options);
	const dashboardUrl =
		options.dashboardUrl ?? process.env.GPIO_COMPANION_DASHBOARD_URL;
	const debug = createDebugHub({
		dashboardUrl,
	});
	let runRef: RunController | null = null;
	const gpio = options.gpio ?? createLibgpiodGpio();
	const proxy = options.proxy ?? createArduinoProxy();
	const gpioStream = createGpioStream({
		gpio,
		proxy,
		hardware: async () => (await options.store.read()).hardware,
		sketchTarget: () => runRef?.runTarget?.() ?? null,
	});
	const consoleHub = options.console ?? createConsoleHub();
	const uiHub = options.ui ?? createUiHub();
	const app =
		options.app ?? createAppController({ projectsDir: options.projectsDir });
	const fileHub = createBoardFileHub(options.projectsDir ?? projectsRoot());
	const opencodeStops = new WeakMap<object, AbortController>();
	const opencodeEnvPath =
		options.opencodeEnvPath ??
		process.env.GPIO_COMPANION_OPENCODE_SERVER_ENV ??
		DEFAULT_OPENCODE_SERVER_ENV;

	function startOpencodeBridge(ws: OpencodeSocket) {
		const controller = new AbortController();
		opencodeStops.set(ws, controller);
		const repo = ws.data.repo ?? "";
		void (async () => {
			try {
				const auth = await readOpencodeServerAuth(opencodeEnvPath);
				await bridgeOpencodeEvents({
					repo,
					projectsDir: options.projectsDir ?? projectsRoot(),
					lastEventId: ws.data.lastEventId,
					auth,
					upstream:
						options.opencodeUpstream ?? process.env.GPIO_COMPANION_OPENCODE_URL,
					fetchImpl: options.opencodeFetch,
					signal: controller.signal,
					send: (frame) => {
						ws.send(frame);
					},
				});
			} catch {
				// upstream ended or the socket closed
			} finally {
				if (!controller.signal.aborted) {
					try {
						ws.close();
					} catch {
						// already closed
					}
				}
			}
		})();
	}

	function stopOpencodeBridge(ws: object) {
		opencodeStops.get(ws)?.abort();
		opencodeStops.delete(ws);
	}

	function startAppBridge(ws: AppSocket) {
		const port = ws.data.appPort ?? 0;
		const suffix = ws.data.appSuffix ?? "/";
		const search = ws.data.appSearch ?? "";
		let upstream: WebSocket;
		try {
			upstream = new WebSocket(appUpstreamWsUrl(port, suffix, search));
		} catch {
			try {
				ws.close(1011, "app unavailable");
			} catch {
				undefined;
			}
			return;
		}
		ws.data.appUpstream = upstream;
		const pending: Array<string | Uint8Array> = [];
		ws.data.appPending = pending;
		upstream.addEventListener("open", () => {
			for (const item of pending.splice(0)) {
				try {
					upstream.send(item);
				} catch {
					undefined;
				}
			}
		});
		upstream.addEventListener("message", (event) => {
			const data = event.data;
			try {
				if (typeof data === "string") {
					ws.send(data);
				} else if (data instanceof ArrayBuffer) {
					ws.send(data);
				} else if (ArrayBuffer.isView(data)) {
					ws.send(
						new Uint8Array(
							data.buffer,
							data.byteOffset,
							data.byteLength as number,
						),
					);
				}
			} catch {
				undefined;
			}
		});
		const stop = () => {
			try {
				upstream.close();
			} catch {
				undefined;
			}
		};
		upstream.addEventListener("close", () => {
			try {
				ws.close(1011, "app closed");
			} catch {
				undefined;
			}
		});
		upstream.addEventListener("error", stop);
	}
	const jobs: { run?: RunController; verify?: VerifyController } = {};
	const run =
		options.run ??
		createHostRun({
			hardware: async () => (await options.store.read()).hardware,
			gpio,
			proxy,
			onLog: (chunk) => consoleHub.appendHost(chunk),
			onRunning: (running) => {
				consoleHub.setHostRunning(running);
				if (!running) {
					void proxy.probe();
				}
			},
			isBusy: () => jobs.verify?.status().running ?? false,
		});
	runRef = run;
	gpio.setSketchStatus?.(() =>
		runRef?.runTarget?.() === "header"
			? readSketchStatus(runRef?.statusPath?.() ?? null)
			: null,
	);
	proxy.setSketchStatus?.(() =>
		runRef?.runTarget?.() === "arduino-proxy"
			? readSketchStatus(runRef?.statusPath?.() ?? null)
			: null,
	);
	const verify =
		options.verify ??
		createCircuitVerify({
			hardware: async () => (await options.store.read()).hardware,
			gpio,
			proxy,
			projectsDir: options.projectsDir,
			isRunBusy: () => jobs.run?.status().running ?? false,
		});
	jobs.run = run;
	jobs.verify = verify;
	const flash =
		options.flash ??
		(() => {
			const upload = proxyUploadHooks(proxy);
			return createArduinoFlash({
				beforeUpload: async (job) => {
					consoleHub.stopUsb();
					await upload.beforeUpload(job);
				},
				afterUpload: async (job, result) => {
					if (!result.ok || job.dir === resolveArduinoProxyDir()) {
						await upload.afterUpload(job, result);
						return;
					}
					proxy.hold(false);
					if (job.port) {
						consoleHub.scheduleUsb(job.port);
					}
				},
			});
		})();
	const extras: DeviceRequestExtras = {
		readDisk: options.readDisk ?? readDiskStats,
		readLogs: options.readLogs ?? readJournalLogs,
		readNetwork: options.readNetwork ?? readNetworkStatus,
		readInfo: options.readInfo ?? (async () => readDeviceInfoJson()),
		gpio,
		gpioStream,
		proxy,
		console: consoleHub,
		ui: uiHub,
		uiReplyPollMs: options.uiReplyPollMs,
		files: fileHub,
		flash,
		run,
		agent:
			options.agent ??
			createAgentController({
				projectsDir: options.projectsDir,
			}),
		app,
		verify,
		projectsDir: options.projectsDir,
		applyUpdate: options.applyUpdate,
		applyProjects: options.applyProjects,
		applyProjectPush: options.applyProjectPush,
		applyProjectRemove: options.applyProjectRemove,
		dashboardUrl:
			options.dashboardUrl ?? process.env.GPIO_COMPANION_DASHBOARD_URL,
		fetchImpl: options.fetchImpl,
		opencodeFetch: options.opencodeFetch,
		opencodeEnvPath: options.opencodeEnvPath,
		opencodeUpstream: options.opencodeUpstream,
		opencodeJsonPath: options.opencodeJsonPath,
		revokeOpencode: options.revokeOpencode,
		debug,
	};
	const server = Bun.serve<TunnelWsData>({
		port,
		hostname,
		async fetch(request, server) {
			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204 });
			}
			const url = new URL(request.url);
			const path = url.pathname.replace(/\/+$/, "") || "/";
			const upgrade = request.headers.get("upgrade")?.toLowerCase() ?? "";
			const appFrame = parseAppFramePath(path);
			const watchRepo =
				request.method === "GET" ? parseBoardFileWatchPath(path) : null;
			const eventRepo =
				request.method === "GET" ? parseOpencodeEventPath(path) : null;
			if (eventRepo && upgrade === "websocket") {
				return (
					(await acceptSignedUpgrade(request, server, {
						path,
						stream: "opencode",
						repo: eventRepo,
						lastEventId: opencodeEventLastId(url.searchParams.get("last")),
						label: "opencode",
						allowOrigin: (origin) => isAllowedDebugOrigin(origin, dashboardUrl),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
						prepare: async () => {
							const pairing = await options.pairing.read();
							try {
								await assertOpencodeProxyGranted({
									claimed: pairing.claimed,
									uuid: pairing.uuid,
									key: pairing.key,
									origin: dashboardUrl,
									fetchImpl: options.fetchImpl,
								});
							} catch (error) {
								const message =
									error instanceof Error
										? error.message
										: "opencode proxy revoked";
								return Response.json({ error: message }, { status: 403 });
							}
							try {
								await readOpencodeServerAuth(opencodeEnvPath);
							} catch (error) {
								const message =
									error instanceof Error
										? error.message
										: "opencode server password is not set";
								return Response.json({ error: message }, { status: 503 });
							}
						},
					})) ?? (undefined as never)
				);
			}
			if (watchRepo && upgrade === "websocket") {
				return (
					(await acceptSignedUpgrade(request, server, {
						path,
						stream: "files",
						repo: watchRepo,
						label: "files",
						allowOrigin: (origin) => isAllowedDebugOrigin(origin, dashboardUrl),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
					})) ?? (undefined as never)
				);
			}
			if (
				upgrade === "websocket" &&
				path !== DEBUG_PATH &&
				path !== GPIO_PATH &&
				path !== CONSOLE_PATH &&
				path !== UI_PATH &&
				!watchRepo &&
				!eventRepo &&
				!appFrame
			) {
				console.error(`gpio-companion debug: websocket to ${path}`);
			}
			if (request.method === "GET" && path === DEBUG_PATH) {
				return (
					(await acceptSignedUpgrade(request, server, {
						path: DEBUG_PATH,
						stream: "debug",
						label: "debug",
						allowOrigin: (origin) => debug.allowOrigin(origin),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
					})) ?? (undefined as never)
				);
			}
			if (
				request.method === "GET" &&
				path === GPIO_PATH &&
				upgrade === "websocket"
			) {
				return (
					(await acceptSignedUpgrade(request, server, {
						path: GPIO_PATH,
						stream: "gpio",
						label: "gpio",
						allowOrigin: (origin) => isAllowedDebugOrigin(origin, dashboardUrl),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
					})) ?? (undefined as never)
				);
			}
			if (
				request.method === "GET" &&
				path === CONSOLE_PATH &&
				upgrade === "websocket"
			) {
				return (
					(await acceptSignedUpgrade(request, server, {
						path: CONSOLE_PATH,
						stream: "console",
						label: "console",
						allowOrigin: (origin) => isAllowedDebugOrigin(origin, dashboardUrl),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
					})) ?? (undefined as never)
				);
			}
			if (
				request.method === "GET" &&
				path === UI_PATH &&
				upgrade === "websocket"
			) {
				return (
					(await acceptSignedUpgrade(request, server, {
						path: UI_PATH,
						stream: "ui",
						label: "ui",
						allowOrigin: (origin) => isAllowedDebugOrigin(origin, dashboardUrl),
						deviceAuth: options.deviceAuth,
						clock,
						nonces,
					})) ?? (undefined as never)
				);
			}
			if (appFrame) {
				const origin = request.headers.get("origin") ?? "";
				if (!isAllowedDebugOrigin(origin, dashboardUrl)) {
					console.error(`gpio-companion app: unauthorized origin ${origin}`);
					return Response.json(
						{ error: "unauthorized app origin" },
						{ status: 401 },
					);
				}
				if (!extras.app) {
					return Response.json(
						{ error: "app is unavailable" },
						{ status: 503 },
					);
				}
				if (upgrade === "websocket") {
					try {
						const auth = extras.app.authorize(appFrame);
						if (
							server.upgrade(request, {
								data: {
									stream: "app",
									appSuffix: appFrame.suffix,
									appSearch: url.search,
									appPort: auth.port,
								},
							})
						) {
							return undefined as never;
						}
						return new Response("upgrade failed", { status: 400 });
					} catch (error) {
						const message =
							error instanceof Error ? error.message : "app frame failed";
						const status = error instanceof AppError ? error.status : 400;
						return Response.json({ error: message }, { status });
					}
				}
				try {
					return await extras.app.proxy(request, appFrame, url.search);
				} catch (error) {
					if (error instanceof AppError) {
						return Response.json(
							{ error: error.message },
							{ status: error.status },
						);
					}
					return Response.json({ error: "app frame failed" }, { status: 502 });
				}
			}
			let response: Response;
			try {
				response = await handleDeviceRequest(
					request,
					options.store,
					options.secrets,
					options.pairing,
					options.applyTunnel,
					options.applyWifi,
					options.deviceAuth,
					options.githubCredentials,
					clock,
					nonces,
					extras,
				);
			} catch (error) {
				if (error instanceof DeviceAuthError) {
					response = Response.json(
						{ error: error.message },
						{ status: error.status },
					);
				} else if (error instanceof GpioError) {
					response = Response.json(
						{ error: error.message },
						{ status: error.status },
					);
				} else if (
					error instanceof FlashError ||
					error instanceof RunError ||
					error instanceof AgentError ||
					error instanceof AppError ||
					error instanceof VerifyError ||
					error instanceof ConsoleError ||
					error instanceof UiError ||
					error instanceof ArduinoProxyError
				) {
					response = Response.json(
						{ error: error.message },
						{ status: error.status },
					);
				} else {
					const message =
						error instanceof Error ? error.message : "request failed";
					const status =
						message.includes("mismatch") ||
						message.includes("already paired") ||
						message.includes("local-only")
							? 403
							: 400;
					response = Response.json({ error: message }, { status });
				}
			}
			void debug.publishFromResponse(request, response);
			return response;
		},
		websocket: {
			open(ws) {
				if (ws.data.stream === "gpio") {
					gpioStream.add(ws);
					return;
				}
				if (ws.data.stream === "console") {
					consoleHub.add(ws);
					return;
				}
				if (ws.data.stream === "ui") {
					uiHub.add(ws);
					return;
				}
				if (ws.data.stream === "files") {
					if (ws.data.repo) {
						fileHub.add(ws, ws.data.repo);
					}
					return;
				}
				if (ws.data.stream === "opencode") {
					startOpencodeBridge(ws);
					return;
				}
				if (ws.data.stream === "app") {
					startAppBridge(ws as AppSocket);
					return;
				}
				debug.add(ws);
			},
			message(ws, message) {
				const text =
					typeof message === "string"
						? message
						: new TextDecoder().decode(message);
				if (ws.data.stream === "gpio") {
					void gpioStream.handle(ws, text);
					return;
				}
				if (ws.data.stream === "console") {
					consoleHub.handle(ws, text);
					return;
				}
				if (ws.data.stream === "ui") {
					uiHub.handle(ws, text);
					return;
				}
				if (ws.data.stream === "app") {
					const upstream = ws.data.appUpstream;
					if (!upstream) {
						return;
					}
					if (upstream.readyState === 1) {
						upstream.send(message);
					} else {
						ws.data.appPending?.push(message);
					}
					return;
				}
			},
			close(ws) {
				if (ws.data.stream === "gpio") {
					gpioStream.remove(ws);
					return;
				}
				if (ws.data.stream === "console") {
					consoleHub.remove(ws);
					return;
				}
				if (ws.data.stream === "ui") {
					uiHub.remove(ws);
					return;
				}
				if (ws.data.stream === "files") {
					fileHub.remove(ws);
					return;
				}
				if (ws.data.stream === "opencode") {
					stopOpencodeBridge(ws);
					return;
				}
				if (ws.data.stream === "app") {
					try {
						ws.data.appUpstream?.close();
					} catch {
						undefined;
					}
					return;
				}
				debug.remove(ws);
			},
		},
	});
	return Object.assign(server, {
		run,
		flash,
		verify,
		console: consoleHub,
		app,
	});
}

export async function handleDeviceRequest(
	request: Request,
	store: ConfigStore,
	secretsStore: SecretsStore,
	pairingStore: PairingStore,
	applyTunnel: ApplyTunnel,
	applyWifi: ApplyWifi | undefined,
	deviceAuth: DeviceAuthConfig,
	githubCredentials?: () => Promise<GithubInstallationCreds>,
	clock?: ClockGate,
	nonces?: NonceGate,
	extras?: DeviceRequestExtras,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const method = request.method.toUpperCase();
	const bodyText =
		method === "GET" || method === "HEAD" ? "" : await request.text();

	if (method === "GET" && path === "/health") {
		return json({ ok: true, version: VERSION });
	}

	if (method === "POST" && path === DEBUG_EVENT_PATH) {
		if (!isLoopback(url)) {
			throw new Error("debug event is local-only");
		}
		let body: unknown;
		try {
			body = bodyText ? JSON.parse(bodyText) : null;
		} catch {
			return json({ error: "invalid json" }, 400);
		}
		try {
			extras?.debug?.publish(parseDebugEventInput(body));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "invalid debug event";
			return json({ error: message }, 400);
		}
		return json({ ok: true });
	}

	if (method === "GET" && path === "/v1/github-token") {
		if (!isLoopback(url)) {
			throw new Error("github token is local-only");
		}
		if (!githubCredentials) {
			throw new Error("github credentials are not configured");
		}
		return json(await githubCredentials());
	}

	if (path === "/v1/ai" || path.startsWith("/v1/ai/")) {
		if (!isLoopback(url)) {
			throw new Error("ai proxy is local-only");
		}
		const pairing = await pairingStore.read();
		return proxyAiRequest({
			request,
			path,
			bodyText,
			uuid: pairing.uuid,
			key: pairing.key,
			origin: extras?.dashboardUrl,
			fetchImpl: extras?.fetchImpl,
		});
	}

	if (path === "/v1/jlcpcb" || path === "/v1/jlcpcb/draft") {
		if (!isLoopback(url)) {
			throw new Error("jlcpcb proxy is local-only");
		}
		const pairing = await pairingStore.read();
		return proxyJlcpcbRequest({
			request,
			bodyText,
			uuid: pairing.uuid,
			key: pairing.key,
			origin: extras?.dashboardUrl,
			fetchImpl: extras?.fetchImpl,
			upstreamPath:
				path === "/v1/jlcpcb/draft"
					? "/api/jlcpcb/device-draft"
					: "/api/jlcpcb/device",
		});
	}

	if (
		(path === GPIO_PATH ||
			isFlashPath(path) ||
			isRunPath(path) ||
			isAgentPath(path) ||
			isVerifyPath(path) ||
			isConsolePath(path) ||
			isUiPath(path) ||
			isArduinoProxyPath(path) ||
			path === APP_PATH ||
			path === APP_START_PATH ||
			path === APP_STOP_PATH ||
			path === APP_LIST_PATH) &&
		isLoopback(url) &&
		!hasDeviceSignature(request.headers)
	) {
		if (path === GPIO_PATH) {
			return handleGpio(
				method,
				bodyText,
				url,
				store,
				extras?.gpio,
				extras?.gpioStream,
				extras?.proxy,
				extras?.run,
			);
		}
		if (isRunPath(path)) {
			return handleRun(method, path, bodyText, extras);
		}
		if (isAgentPath(path)) {
			return handleAgent(method, path, bodyText, extras);
		}
		if (
			path === APP_PATH ||
			path === APP_START_PATH ||
			path === APP_STOP_PATH ||
			path === APP_LIST_PATH
		) {
			return await handleApp(method, path, bodyText, extras);
		}
		if (isVerifyPath(path)) {
			return handleVerify(method, path, bodyText, extras);
		}
		if (isConsolePath(path)) {
			return handleConsole(method, path, bodyText, extras);
		}
		if (isUiPath(path)) {
			return await handleUi(method, path, bodyText, extras);
		}
		if (isArduinoProxyPath(path) && path === ARDUINO_PROXY_PATH) {
			return handleArduinoProxy(method, extras);
		}
		return handleFlash(method, path, bodyText, extras);
	}

	if (!deviceAuth.publicKeyPem.trim()) {
		throw new DeviceAuthError("device public key not registered", 401);
	}

	const trusted = clock ? await clock.trusted() : true;
	const grantRaw = grantHeaderValue(request.headers);
	let verified: { issued: number; nonce: string; clockBehind: boolean };
	if (grantRaw) {
		const pairing = await pairingStore.read();
		const offline = await verifyOfflineEnvelope({
			masterPublicKeyPem: deviceAuth.publicKeyPem,
			uuid: pairing.uuid,
			method,
			path,
			body: bodyText,
			headers: request.headers,
			enforceExpiry: trusted,
		});
		verified = offline.verified;
		if (nonces) {
			nonces.consume(verified.nonce);
		}
	} else {
		verified = await verifyDeviceRequest({
			publicKeyPem: deviceAuth.publicKeyPem,
			keyId: deviceAuth.keyId,
			method,
			path,
			body: bodyText,
			headers: request.headers,
			enforceSkew: trusted,
		});
		if (nonces) {
			nonces.consume(verified.nonce);
		}
		if (clock) {
			await clock.sync(verified.issued, verified.clockBehind);
		} else if (verified.clockBehind) {
			throw new DeviceAuthError("expired device signature", 403);
		}
	}

	if (method === "GET" && path === "/v1/pairing") {
		const config = await store.read();
		const pairing = await pairingStore.read();
		return json({
			...publicPairing(pairing),
			hardware: config.hardware,
			hostname: config.tunnel.hostname,
			apiHostname: config.tunnel.apiHostname,
		});
	}

	if (method === "POST" && path === "/v1/pairing/claim") {
		const claim = parsePairingClaim(parseJson(bodyText));
		const current = await pairingStore.read();
		const next = applyClaim(current, claim);
		await pairingStore.write(next);
		return json(publicPairing(next));
	}

	if (method === "GET" && path === "/v1/pairing/credentials") {
		if (!isLoopback(url)) {
			throw new Error("pairing credentials are local-only");
		}
		const config = await store.read();
		return json(
			pairingCredentials(
				await pairingStore.read(),
				publicDeviceUrl(config.tunnel.apiHostname),
			),
		);
	}

	if (method === "POST" && path === "/v1/pairing/transfer") {
		const claim = parsePairingClaim(parseJson(bodyText));
		const current = await pairingStore.read();
		const next = applyTransfer(current, claim);
		await pairingStore.write(next);
		await wipeOwnerSecrets(secretsStore, extras?.revokeOpencode);
		await clearCliSession();
		return json(publicPairing(next));
	}

	if (method === "POST" && path === "/v1/pairing/unpair") {
		const body = parsePairingUnpair(parseJson(bodyText));
		const current = await pairingStore.read();
		const next = applyUnpair(current, body.uuid, body.key);
		await pairingStore.write(next);
		await wipeOwnerSecrets(secretsStore, extras?.revokeOpencode);
		await clearCliSession();
		return json(publicPairing(next));
	}

	if (method === "POST" && path === "/v1/jlcpcb/login") {
		const started = await startJlcpcbLogin(extras?.startJlcpcbLogin);
		return json({
			authorizeUrl: started.authorizeUrl,
			state: started.state,
		});
	}

	if (method === "POST" && path === "/v1/jlcpcb/login/code") {
		const body = asObject(parseJson(bodyText));
		const state = typeof body.state === "string" ? body.state : "";
		const code = typeof body.code === "string" ? body.code : "";
		if (!state || !code) {
			return json({ error: "cli login expired" }, 400);
		}
		return json(await completeJlcpcbLogin(state, code));
	}

	if (isOpencodeProxyPath(path)) {
		return proxySignedOpencode(
			request,
			path,
			url,
			bodyText,
			store,
			pairingStore,
			extras,
		);
	}

	if (method === "GET" && path === "/v1/config") {
		return json(redactDeviceConfig(await store.read()));
	}

	if (method === "PUT" && path === "/v1/config") {
		const body = asObject(parseJson(bodyText));
		const current = await store.read();
		const next: DeviceConfig = {
			...current,
			hardware: current.hardware,
			tunnel:
				body.tunnel !== undefined
					? parseTunnelConfig(body.tunnel)
					: current.tunnel,
		};
		return persist(store, applyTunnel, next);
	}

	if (method === "PUT" && path === "/v1/config/profile") {
		const current = await store.read();
		const next: DeviceConfig = {
			...current,
			profile: parseUserProfile(parseJson(bodyText)),
		};
		return persist(store, applyTunnel, next);
	}

	if (method === "PUT" && path === "/v1/config/tunnel") {
		const current = await store.read();
		const next: DeviceConfig = {
			...current,
			tunnel: parseTunnelConfig(parseJson(bodyText)),
		};
		return persist(store, applyTunnel, next);
	}

	if (method === "GET" && path === "/v1/config/ai-key") {
		const secrets = await secretsStore.read();
		return json({ gpioAiKey: Boolean(secrets.gpioAiKey) });
	}

	if (method === "GET" && path === "/v1/config/secrets") {
		return json(secretsStatus(await secretsStore.read()));
	}

	if (method === "PUT" && path === "/v1/config/secrets") {
		const current = await secretsStore.read();
		const next = mergeDeviceSecrets(
			current,
			parseDeviceSecrets(parseJson(bodyText)),
		);
		await secretsStore.write(next);
		return json(secretsStatus(next));
	}

	if (method === "PUT" && path === "/v1/config/wifi") {
		const wifi = parseWifiConfig(parseJson(bodyText));
		const pairing = await pairingStore.read();
		if (!pairing.uuid || wifi.uuid !== pairing.uuid) {
			throw new Error("pairing uuid mismatch");
		}
		if (!applyWifi) {
			throw new Error("wifi apply is not configured");
		}
		try {
			const result = await applyWifi(wifi);
			return json(publicWifiStatus(result.ssid, true));
		} catch (error) {
			if (error instanceof WifiConnectError) {
				return json(publicWifiFailure(wifi.ssid, error.reason), 400);
			}
			throw error;
		}
	}

	if (method === "PUT" && path === "/v1/config/github") {
		const current = await secretsStore.read();
		const next = mergeDeviceSecrets(
			current,
			parseDeviceSecrets(parseJson(bodyText)),
		);
		if (!next.githubUsername || !next.githubToken) {
			throw new Error("githubUsername and githubToken are required");
		}
		await secretsStore.write(next);
		return json(secretsStatus(next));
	}

	if (method === "GET" && path === LOGS_PATH) {
		const raw = extras?.readLogs ? await extras.readLogs() : "";
		return json({
			text: capLogText(redactLogText(raw)),
			sinceHours: LOGS_SINCE_HOURS,
		});
	}

	if (method === "GET" && path === INFO_PATH) {
		if (!extras?.readInfo) {
			return json({ error: "companion info is unavailable" }, 503);
		}
		try {
			return json(await extras.readInfo());
		} catch {
			return json({ error: "companion info is unavailable" }, 503);
		}
	}

	if (method === "POST" && path === UPDATE_PATH) {
		if (!extras?.applyUpdate) {
			throw new Error("update is not configured");
		}
		await extras.applyUpdate();
		return json({ started: true });
	}

	if (method === "POST" && path === PROJECTS_SYNC_PATH) {
		if (!extras?.applyProjects) {
			throw new Error("projects sync is not configured");
		}
		const target = bodyText.trim()
			? parseProjectSyncPut(parseJson(bodyText))
			: {};
		await extras.applyProjects(target);
		return json({ started: true });
	}

	if (method === "POST" && path === PROJECTS_REMOVE_PATH) {
		if (!extras?.applyProjectRemove) {
			throw new Error("projects remove is not configured");
		}
		return json(
			await extras.applyProjectRemove(
				parseProjectRemovePut(parseJson(bodyText)),
			),
		);
	}

	if (method === "POST" && path === PROJECTS_PUSH_PATH) {
		if (!extras?.applyProjectPush) {
			throw new Error("projects push is not configured");
		}
		const put = parseProjectPushPut(parseJson(bodyText));
		return json(await extras.applyProjectPush(put));
	}

	if (method === "POST" && path === FILES_LIST_PATH) {
		const put = parseBoardFileListPut(parseJson(bodyText));
		return json(
			await listBoardFiles(extras?.projectsDir ?? projectsRoot(), put.name),
		);
	}

	if (method === "POST" && path === FILES_READ_PATH) {
		const put = parseBoardFileReadPut(parseJson(bodyText));
		return json(
			await readBoardFile(
				extras?.projectsDir ?? projectsRoot(),
				put.name,
				put.path,
			),
		);
	}

	if (method === "POST" && path === FILES_RENAME_PATH) {
		const put = parseBoardFileRenamePut(parseJson(bodyText));
		return json(
			await renameBoardFile(
				extras?.projectsDir ?? projectsRoot(),
				put.name,
				put.from,
				put.to,
			),
		);
	}

	if (method === "POST" && path === FILES_REMOVE_PATH) {
		const put = parseBoardFileRemovePut(parseJson(bodyText));
		return json(
			await removeBoardFile(
				extras?.projectsDir ?? projectsRoot(),
				put.name,
				put.path,
			),
		);
	}

	if (method === "PUT" && path === FILES_WRITE_PATH) {
		const put = parseBoardFileWritePut(parseJson(bodyText));
		if (put.base64) {
			return json(
				await writeBoardFileBytes(
					extras?.projectsDir ?? projectsRoot(),
					put.name,
					put.path,
					put.base64,
				),
			);
		}
		return json(
			await writeBoardFile(
				extras?.projectsDir ?? projectsRoot(),
				put.name,
				put.path,
				put.text ?? "",
			),
		);
	}

	if (path === GPIO_PATH) {
		return handleGpio(
			method,
			bodyText,
			url,
			store,
			extras?.gpio,
			extras?.gpioStream,
			extras?.proxy,
			extras?.run,
		);
	}

	if (path === ARDUINO_PROXY_PATH) {
		return handleArduinoProxy(method, extras);
	}

	if (isFlashPath(path)) {
		return handleFlash(method, path, bodyText, extras);
	}

	if (isRunPath(path)) {
		return handleRun(method, path, bodyText, extras);
	}

	if (isAgentPath(path)) {
		return handleAgent(method, path, bodyText, extras);
	}

	if (isAppManagePath(path)) {
		return await handleApp(method, path, bodyText, extras);
	}

	if (isVerifyPath(path)) {
		return handleVerify(method, path, bodyText, extras);
	}

	if (isConsolePath(path)) {
		return handleConsole(method, path, bodyText, extras);
	}

	if (isUiPath(path)) {
		return await handleUi(method, path, bodyText, extras);
	}

	if (method === "GET" && path === "/v1/status") {
		const config = await store.read();
		const secrets = await secretsStore.read();
		const pairing = await pairingStore.read();
		const disk = extras?.readDisk ? extras.readDisk() : null;
		const network = extras?.readNetwork ? extras.readNetwork() : null;
		return json({
			hardware: config.hardware,
			model: readBoardModel(),
			tunnel: {
				configured: Boolean(config.tunnel.token),
				hostname: config.tunnel.hostname,
				apiHostname: config.tunnel.apiHostname,
			},
			secrets: secretsStatus(secrets),
			pairing: publicPairing(pairing),
			disk: disk ?? undefined,
			network: network ?? undefined,
		});
	}

	return json({ error: "not found" }, 404);
}

async function acceptSignedUpgrade(
	request: Request,
	server: {
		upgrade(request: Request, options?: { data: TunnelWsData }): boolean;
	},
	options: {
		path: string;
		stream: TunnelWsData["stream"];
		repo?: string;
		lastEventId?: string;
		label: string;
		allowOrigin: (origin: string) => boolean;
		deviceAuth: DeviceAuthConfig;
		clock: ClockGate;
		nonces: NonceGate;
		prepare?: () => Promise<Response | undefined>;
	},
): Promise<Response | undefined> {
	const origin = request.headers.get("origin") ?? "";
	const upgrade = request.headers.get("upgrade")?.toLowerCase() ?? "";
	console.log(
		`gpio-companion ${options.label}: handshake origin=${origin || "-"} upgrade=${upgrade || "-"}`,
	);
	if (!options.allowOrigin(origin)) {
		console.error(
			`gpio-companion ${options.label}: unauthorized origin ${origin}`,
		);
		return Response.json(
			{ error: `unauthorized ${options.label} origin` },
			{ status: 401 },
		);
	}
	if (!options.deviceAuth.publicKeyPem.trim()) {
		console.error(
			`gpio-companion ${options.label}: device public key not registered`,
		);
		return Response.json(
			{ error: "device public key not registered" },
			{ status: 401 },
		);
	}
	try {
		const trusted = await options.clock.trusted();
		const verified = await verifyDeviceRequest({
			publicKeyPem: options.deviceAuth.publicKeyPem,
			keyId: options.deviceAuth.keyId,
			method: "GET",
			path: options.path,
			body: "",
			headers: debugAuthHeadersFromRequest(request),
			enforceSkew: trusted,
		});
		options.nonces.consume(verified.nonce);
		await options.clock.sync(verified.issued, verified.clockBehind);
		if (options.prepare) {
			const blocked = await options.prepare();
			if (blocked) {
				return blocked;
			}
		}
	} catch (error) {
		if (error instanceof DeviceAuthError) {
			console.error(`gpio-companion ${options.label}: ${error.message}`);
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
	if (
		server.upgrade(request, {
			data: {
				stream: options.stream,
				repo: options.repo,
				lastEventId: options.lastEventId,
			},
		})
	) {
		return undefined;
	}
	console.error(`gpio-companion ${options.label}: upgrade failed`);
	return new Response("upgrade failed", { status: 400 });
}

type ClockGate = {
	trusted(): Promise<boolean>;
	sync(issuedMs: number, clockBehind: boolean): Promise<void>;
};

type NonceGate = {
	consume(nonce: string): void;
};

const MAX_DEVICE_NONCES = 512;

function createClockGate(options: ServeOptions): ClockGate {
	let lastIssuedMs = readClockStamp(options.clockStampPath);
	const apply = options.applyClock ?? defaultApplyClock;
	return {
		async trusted() {
			if (options.clockTrusted) {
				return options.clockTrusted();
			}
			if (
				lastIssuedMs > 0 &&
				Math.abs(Date.now() - lastIssuedMs) <= DEFAULT_DEVICE_MAX_SKEW_MS
			) {
				return true;
			}
			return ntpSynchronized();
		},
		async sync(issuedMs, clockBehind) {
			if (!clockBehind) {
				return;
			}
			if (issuedMs <= lastIssuedMs) {
				throw new DeviceAuthError("expired device signature", 403);
			}
			try {
				await apply(issuedMs);
			} catch {
				// still accept this request; signature already verified
			}
			lastIssuedMs = issuedMs;
			writeClockStamp(options.clockStampPath, issuedMs);
		},
	};
}

function createNonceGate(options: ServeOptions): NonceGate {
	if (options.nonceStore) {
		const store = options.nonceStore;
		return {
			consume(nonce) {
				if (store.has(nonce)) {
					throw new DeviceAuthError("replayed device signature", 403);
				}
				store.add(nonce);
			},
		};
	}
	let nonces = readNonces(options.noncePath);
	return {
		consume(nonce) {
			if (nonces.includes(nonce)) {
				throw new DeviceAuthError("replayed device signature", 403);
			}
			nonces.push(nonce);
			if (nonces.length > MAX_DEVICE_NONCES) {
				nonces = nonces.slice(-MAX_DEVICE_NONCES);
			}
			writeNonces(options.noncePath, nonces);
		},
	};
}

async function defaultApplyClock(issuedMs: number): Promise<void> {
	const unix = Math.floor(issuedMs / 1000);
	if (!Number.isFinite(unix) || unix <= 0) {
		return;
	}
	try {
		const date = Bun.spawn(privileged(["date", "-u", "-s", `@${unix}`]), {
			stdout: "ignore",
			stderr: "ignore",
		});
		await date.exited;
	} catch {
		return;
	}
	try {
		const hw = Bun.spawn(privileged(["fake-hwclock", "save"]), {
			stdout: "ignore",
			stderr: "ignore",
		});
		await hw.exited;
	} catch {
		return;
	}
}

function readClockStamp(path: string | undefined): number {
	if (!path) {
		return 0;
	}
	try {
		const issued = Number(readFileSync(path, "utf8").trim());
		return Number.isFinite(issued) && issued > 0 ? issued : 0;
	} catch {
		return 0;
	}
}

function writeClockStamp(path: string | undefined, issuedMs: number): void {
	if (!path) {
		return;
	}
	void Bun.write(path, `${issuedMs}\n`).catch(() => undefined);
}

async function ntpSynchronized(): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const text = await new Response(proc.stdout).text();
		await proc.exited;
		return text.trim().toLowerCase() === "yes";
	} catch {
		return false;
	}
}

function readNonces(path: string | undefined): string[] {
	if (!path) {
		return [];
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((item): item is string => typeof item === "string");
	} catch {
		return [];
	}
}

function writeNonces(path: string | undefined, nonces: string[]): void {
	if (!path) {
		return;
	}
	void Bun.write(path, `${JSON.stringify(nonces)}\n`).catch(() => undefined);
}

async function persist(
	store: ConfigStore,
	applyTunnel: ApplyTunnel,
	config: DeviceConfig,
): Promise<Response> {
	await store.write(config);
	await applyTunnel(config);
	return json(redactDeviceConfig(config));
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error("invalid json");
	}
}

function asObject(body: unknown): Record<string, unknown> {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("body must be an object");
	}
	return body as Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

async function handleGpio(
	method: string,
	bodyText: string,
	url: URL,
	store: ConfigStore,
	gpio: GpioController | undefined,
	gpioStream?: { publish(): void },
	proxy?: ArduinoProxyController,
	run?: RunController,
): Promise<Response> {
	if (!gpio) {
		return json({ error: "gpio is unavailable" }, 503);
	}
	const hardware = (await store.read()).hardware;
	if (method === "GET") {
		if (url.searchParams.get("target") === "arduino-proxy") {
			if (!proxy) {
				return json({ error: "arduino-proxy is unavailable" }, 503);
			}
			return json(proxy.snapshot(hardware));
		}
		return json(await gpio.snapshot(hardware));
	}
	if (method === "PUT") {
		const command = parseGpioWsCommand(parseJson(bodyText));
		if (isGpioWsRefresh(command)) {
			return json({ error: "refresh is websocket-only" }, 400);
		}
		if (command.target === "arduino-proxy") {
			if (run?.runTarget?.() === "arduino-proxy") {
				return json(
					{ error: "sketch is running — Live GPIO is read-only" },
					409,
				);
			}
			if (!proxy) {
				return json({ error: "arduino-proxy is unavailable" }, 503);
			}
			if (isGpioBusCommand(command)) {
				return json(proxy.bus(command));
			}
			const snapshot = proxy.apply(hardware, command);
			gpioStream?.publish();
			return json(snapshot);
		}
		if (isGpioBusCommand(command)) {
			throw new GpioError("bus ops need arduino-proxy");
		}
		if (run?.runTarget?.() === "header") {
			return json({ error: "sketch is running — Live GPIO is read-only" }, 409);
		}
		const snapshot = await gpio.apply(hardware, command);
		gpioStream?.publish();
		return json(snapshot);
	}
	return json({ error: "method not allowed" }, 405);
}

async function handleFlash(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Promise<Response> {
	if (method === "GET" && path === FLASH_SKETCHES_PATH) {
		return json({
			sketches: listBoardSketches(
				extras?.projectsDir ?? projectsRoot(),
				"firmware",
			),
		});
	}
	const flash = extras?.flash;
	if (!flash) {
		return json({ error: "flash is unavailable" }, 503);
	}
	if (method === "GET" && path === FLASH_PORTS_PATH) {
		return json(await flash.ports());
	}
	if (method === "GET" && path === FLASH_PATH) {
		return json(flash.status());
	}
	if (method === "POST" && path === FLASH_PATH) {
		return json(flash.start(parseJson(bodyText)));
	}
	if (method === "POST" && path === FLASH_STOP_PATH) {
		return json(flash.stop());
	}
	if (method === "POST" && path === FLASH_PROXY_PATH) {
		const put = bodyText.trim() ? parseFlashProxyPut(parseJson(bodyText)) : {};
		invalidateArduinoBoardCache();
		const listed = await flash.ports();
		const live = extras?.proxy?.status();
		const requested =
			(put.port && isUsbArduinoPort(put.port) ? put.port : undefined) ||
			(live?.port && isUsbArduinoPort(live.port) ? live.port : undefined);
		const port = pickProxyFlashPort(listed.ports, requested);
		const selected = listed.ports.find((item) => item.address === port);
		const fqbn =
			put.fqbn || (live?.connected ? live.fqbn : undefined) || selected?.fqbn;
		if (!port) {
			throw new ArduinoProxyError("no arduino connected");
		}
		if (!fqbn) {
			throw new ArduinoProxyError("fqbn is required");
		}
		if (!isArduinoProxyFqbn(fqbn)) {
			throw new ArduinoProxyError(`unsupported fqbn ${fqbn}`);
		}
		extras?.console?.stopUsb();
		extras?.proxy?.release();
		return json(
			flash.start({
				fqbn,
				port,
				dir: resolveArduinoProxyDir(),
			}),
		);
	}
	return json({ error: "method not allowed" }, 405);
}

function handleArduinoProxy(
	method: string,
	extras: DeviceRequestExtras | undefined,
): Response {
	if (method !== "GET") {
		return json({ error: "method not allowed" }, 405);
	}
	const proxy = extras?.proxy;
	if (!proxy) {
		return json({ error: "arduino-proxy is unavailable" }, 503);
	}
	return json(proxy.status());
}

function handleRun(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Response {
	if (method === "GET" && path === RUN_SKETCHES_PATH) {
		return json({
			sketches: listBoardSketches(
				extras?.projectsDir ?? projectsRoot(),
				"host",
			),
		});
	}
	const run = extras?.run;
	if (!run) {
		return json({ error: "run is unavailable" }, 503);
	}
	if (method === "GET" && path === RUN_PATH) {
		return json(run.status());
	}
	if (method === "POST" && path === RUN_PATH) {
		return json(run.start(parseJson(bodyText)));
	}
	if (method === "POST" && path === RUN_STOP_PATH) {
		return json(run.stop());
	}
	return json({ error: "method not allowed" }, 405);
}

function handleAgent(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Response {
	const agent = extras?.agent;
	if (!agent) {
		return json({ error: "agent is unavailable" }, 503);
	}
	if (method === "GET" && path === AGENT_PATH) {
		return json(agent.status());
	}
	if (method === "POST" && path === AGENT_PATH) {
		return json(agent.start(parseJson(bodyText)));
	}
	if (method === "POST" && path === AGENT_STOP_PATH) {
		return json(agent.stop());
	}
	return json({ error: "method not allowed" }, 405);
}

async function handleApp(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Promise<Response> {
	const app = extras?.app;
	if (!app) {
		return json({ error: "app is unavailable" }, 503);
	}
	if (method === "GET" && path === APP_LIST_PATH) {
		return json({
			apps: listBoardApps(extras?.projectsDir ?? projectsRoot()),
		});
	}
	if (method === "GET" && path === APP_PATH) {
		return json(app.status());
	}
	if (method === "POST" && path === APP_START_PATH) {
		return json(await app.start(parseJson(bodyText)));
	}
	if (method === "POST" && path === APP_STOP_PATH) {
		return json(app.stop());
	}
	if (method === "POST" && isAppFrameMintPath(path)) {
		return json(app.mint(appNameFromMintPath(path)));
	}
	return json({ error: "method not allowed" }, 405);
}

function handleVerify(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Response {
	const verify = extras?.verify;
	if (!verify) {
		return json({ error: "verify is unavailable" }, 503);
	}
	if (method === "GET" && path === VERIFY_PATH) {
		return json(verify.status());
	}
	if (method === "POST" && path === VERIFY_PATH) {
		return json(verify.start(parseJson(bodyText)));
	}
	if (method === "POST" && path === VERIFY_STOP_PATH) {
		return json(verify.stop());
	}
	return json({ error: "method not allowed" }, 405);
}

function handleConsole(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Response {
	const hub = extras?.console;
	if (!hub) {
		return json({ error: "console is unavailable" }, 503);
	}
	if (method === "GET" && path === CONSOLE_PATH) {
		return json(hub.snapshot());
	}
	if (method === "POST" && path === CONSOLE_USB_PATH) {
		return json(hub.startUsb(parseJson(bodyText)));
	}
	if (method === "POST" && path === CONSOLE_USB_STOP_PATH) {
		return json(hub.stopUsb());
	}
	return json({ error: "method not allowed" }, 405);
}

async function handleUi(
	method: string,
	path: string,
	bodyText: string,
	extras: DeviceRequestExtras | undefined,
): Promise<Response> {
	const hub = extras?.ui;
	if (!hub) {
		return json({ error: "ui is unavailable" }, 503);
	}
	if (method === "GET" && path === UI_PATH) {
		return json({ sockets: hub.list() });
	}
	if (method === "POST" && path === UI_PATH) {
		return json(hub.command(parseJson(bodyText)));
	}
	const replyId = uiReplyIdFromPath(path);
	if (method === "GET" && replyId) {
		const reply = await hub.waitReply(
			replyId,
			extras?.uiReplyPollMs ?? UI_REPLY_POLL_MS,
		);
		if (!reply) {
			return json({ error: "no reply" }, 404);
		}
		return json({ action: reply.action });
	}
	return json({ error: "method not allowed" }, 405);
}

function isLoopback(url: URL): boolean {
	return (
		url.hostname === "127.0.0.1" ||
		url.hostname === "localhost" ||
		url.hostname === "::1"
	);
}

async function wipeOwnerSecrets(
	secretsStore: SecretsStore,
	revokeOpencode: (() => Promise<void>) | undefined,
): Promise<void> {
	const current = await secretsStore.read();
	await secretsStore.write({
		...current,
		githubUrl: "",
		githubUsername: "",
		githubToken: "",
	});
	if (revokeOpencode) {
		await revokeOpencode();
	}
}

async function proxySignedOpencode(
	request: Request,
	path: string,
	url: URL,
	bodyText: string,
	store: ConfigStore,
	pairingStore: PairingStore,
	extras: DeviceRequestExtras | undefined,
): Promise<Response> {
	let scoped: { search: string; directory: string };
	try {
		scoped = scopeOpencodeSearch({
			path,
			search: url.search,
			repo: request.headers.get(OPENCODE_REPO_HEADER) ?? "",
			projectsDir: extras?.projectsDir ?? projectsRoot(),
		});
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "opencode route is not available";
		return json(
			{ error: message },
			message === "opencode route is not available" ? 404 : 400,
		);
	}
	const pairing = await pairingStore.read();
	try {
		await assertOpencodeProxyGranted({
			claimed: pairing.claimed,
			uuid: pairing.uuid,
			key: pairing.key,
			origin: extras?.dashboardUrl,
			fetchImpl: extras?.fetchImpl,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "opencode proxy revoked";
		return json({ error: message }, 403);
	}
	if (path === OPENCODE_PERMISSION_MODE_PATH) {
		try {
			return await handleOpencodePermissionMode({
				method: request.method.toUpperCase(),
				bodyText,
				store,
				opencodeJsonPath: extras?.opencodeJsonPath,
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "opencode permission mode failed";
			return json({ error: message }, 500);
		}
	}
	const envPath =
		extras?.opencodeEnvPath ??
		process.env.GPIO_COMPANION_OPENCODE_SERVER_ENV ??
		DEFAULT_OPENCODE_SERVER_ENV;
	let auth: Awaited<ReturnType<typeof readOpencodeServerAuth>>;
	try {
		auth = await readOpencodeServerAuth(envPath);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "opencode server password is not set";
		return json({ error: message }, 503);
	}
	const headers = new Headers(request.headers);
	headers.delete(OPENCODE_REPO_HEADER);
	if (scoped.directory) {
		headers.set("x-opencode-directory", scoped.directory);
	}
	try {
		return await proxyOpencodeRequest({
			request: new Request(request.url, { method: request.method, headers }),
			path,
			search: scoped.search,
			bodyText,
			upstream:
				extras?.opencodeUpstream ?? process.env.GPIO_COMPANION_OPENCODE_URL,
			auth,
			fetchImpl: extras?.opencodeFetch,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "opencode proxy failed";
		const status = message.includes("loopback") ? 500 : 502;
		return json({ error: message }, status);
	}
}
