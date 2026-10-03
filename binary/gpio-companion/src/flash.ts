import { readdirSync, statSync } from "node:fs";
import {
	arduinoCoreForFqbn,
	capFlashLog,
	ESP32_BOARD_MANAGER_URL,
	FlashError,
	type FlashPort,
	type FlashPut,
	type FlashResult,
	type FlashStatus,
	parseArduinoBoardList,
	parseArduinoCoreList,
	parseFlashPut,
} from "gpio-companion";
import { restoreUploadCarrier } from "./arduino-proxy.ts";
import { type KillableProc, killTree } from "./gpio.ts";

export type FlashJobContext = {
	setProc(proc: KillableProc | null): void;
	cancelled(): boolean;
};

export type FlashBackend = {
	listPorts(): Promise<string>;
	compileAndUpload(
		job: FlashPut,
		ctx?: FlashJobContext,
	): Promise<{ ok: boolean; log: string }>;
	hasSketch?: (dir: string) => boolean;
	beforeUpload?: (job: FlashPut) => void | Promise<void>;
	afterUpload?: (
		job: FlashPut,
		result: { ok: boolean; log: string },
	) => void | Promise<void>;
};

export type FlashController = {
	status(): FlashStatus;
	ports(): Promise<{ ports: FlashPort[] }>;
	start(input: unknown): { started: true };
	stop(): { stopped: true };
};

export type FlashControllerOptions = {
	maxJobMs?: number;
};

export type FlashRunnerResult = { code: number; log: string };

export type FlashRunner = (
	cmd: string[],
	timeoutMs: number,
	ctx?: FlashJobContext,
) => Promise<FlashRunnerResult>;

const SKETCH_EXT = [".c", ".ino"];

export const FLASH_COMPILE_TIMEOUT_MS = 180_000;
export const FLASH_COMPILE_ESP_TIMEOUT_MS = 300_000;
export const FLASH_UPLOAD_TIMEOUT_MS = 60_000;
export const FLASH_UPLOAD_ESP_TIMEOUT_MS = 180_000;
export const FLASH_CORE_INSTALL_TIMEOUT_MS = 600_000;
export const FLASH_UPLOAD_ATTEMPTS = 3;
export const FLASH_UPLOAD_RETRY_SETTLE_MS = 1_200;
export const FLASH_MAX_JOB_MS = 8 * 60_000;
export const FLASH_MAX_JOB_MS_ENV = "GPIO_COMPANION_FLASH_MAX_MS";

const RETRYABLE_UPLOAD_FAILURE =
	/timed out|not in sync|programmer is not responding|stk500|device or resource busy|ser_open|lost communication|failed to open port|no device found/i;

function flashMaxJobMs(): number {
	const raw = Number(process.env[FLASH_MAX_JOB_MS_ENV] ?? "");
	if (Number.isFinite(raw) && raw >= 1_000) {
		return raw;
	}
	return FLASH_MAX_JOB_MS;
}

export function createFlashController(
	backend: FlashBackend,
	options: FlashControllerOptions = {},
): FlashController {
	const maxJobMs = options.maxJobMs ?? flashMaxJobMs();
	let running = false;
	let last: FlashResult | null = null;
	let current: KillableProc | null = null;
	let cancelled = false;
	let finalized = false;
	let startedAt = 0;
	let job: FlashPut | null = null;
	let seq = 0;
	let watchdog: ReturnType<typeof setTimeout> | null = null;

	function clearWatchdog(): void {
		if (watchdog) {
			clearTimeout(watchdog);
			watchdog = null;
		}
	}

	function killCurrent(): void {
		const proc = current;
		current = null;
		if (proc) {
			void killTree(proc).catch(() => undefined);
		}
	}

	function finalizeStale(reason: string): void {
		if (!running || finalized) {
			return;
		}
		seq += 1;
		cancelled = true;
		finalized = true;
		killCurrent();
		last = {
			ok: false,
			fqbn: job?.fqbn ?? "",
			dir: job?.dir ?? "",
			port: job?.port,
			log: reason,
			startedAt,
			finishedAt: Date.now(),
		};
		running = false;
		job = null;
		clearWatchdog();
	}

	return {
		status() {
			if (running && Date.now() - startedAt > maxJobMs) {
				finalizeStale(`flash timed out after ${Math.round(maxJobMs / 1000)}s`);
			}
			return { running, last };
		},
		async ports() {
			return { ports: parseArduinoBoardList(await backend.listPorts()) };
		},
		start(input) {
			const put = parseFlashPut(input);
			assertSketchDir(put.dir, backend.hasSketch);
			if (running) {
				throw new FlashError("flash already running", 409);
			}
			running = true;
			cancelled = false;
			finalized = false;
			job = put;
			startedAt = Date.now();
			seq += 1;
			const id = seq;
			clearWatchdog();
			watchdog = setTimeout(() => {
				finalizeStale(`flash timed out after ${Math.round(maxJobMs / 1000)}s`);
			}, maxJobMs);
			void (async () => {
				try {
					await backend.beforeUpload?.(put);
					const result = await backend.compileAndUpload(put, {
						setProc(proc) {
							current = proc;
						},
						cancelled() {
							return cancelled;
						},
					});
				if (!finalized) {
					last = {
						ok: result.ok,
						fqbn: put.fqbn,
						dir: put.dir,
						port: put.port,
						log: capFlashLog(result.log),
						startedAt,
						finishedAt: Date.now(),
					};
				}
				await backend.afterUpload?.(put, result);
			} catch (caught) {
				if (!finalized) {
					last = {
							ok: false,
							fqbn: put.fqbn,
							dir: put.dir,
							port: put.port,
							log: capFlashLog(
								caught instanceof Error ? caught.message : "flash failed",
							),
							startedAt,
							finishedAt: Date.now(),
						};
					}
				} finally {
					if (id === seq) {
						current = null;
						running = false;
						job = null;
						clearWatchdog();
					}
				}
			})();
			return { started: true };
		},
		stop() {
			if (!running || finalized) {
				return { stopped: true };
			}
			seq += 1;
			cancelled = true;
			finalized = true;
			killCurrent();
			last = {
				ok: false,
				fqbn: job?.fqbn ?? "",
				dir: job?.dir ?? "",
				port: job?.port,
				log: "stopped",
				startedAt,
				finishedAt: Date.now(),
			};
			running = false;
			job = null;
			clearWatchdog();
			return { stopped: true };
		},
	};
}

export type ArduinoFlashOptions = {
	runner?: FlashRunner;
	carrier?: (port: string) => Promise<void>;
	listPorts?: () => Promise<string>;
	ensureCore?: (fqbn: string) => Promise<string>;
	uploadAttempts?: number;
	settleMs?: number;
};

export function createArduinoFlash(
	hooks?: {
		beforeUpload?: FlashBackend["beforeUpload"];
		afterUpload?: FlashBackend["afterUpload"];
	},
	options: ArduinoFlashOptions = {},
): FlashController {
	const runner = options.runner ?? runWithTimeout;
	const carrier = options.carrier ?? restoreUploadCarrier;
	const listPorts = options.listPorts ?? (() => listArduinoBoardsCached());
	const ensureCore = options.ensureCore ?? ensureArduinoCore;
	const attempts = options.uploadAttempts ?? FLASH_UPLOAD_ATTEMPTS;
	const settleMs = options.settleMs ?? FLASH_UPLOAD_RETRY_SETTLE_MS;
	return createFlashController({
		beforeUpload: hooks?.beforeUpload,
		afterUpload: hooks?.afterUpload,
		listPorts,
		async compileAndUpload(job, ctx) {
			invalidateArduinoBoardCache();
			const coreLog = await ensureCore(job.fqbn);
			const esp = isEspFqbn(job.fqbn);
			const compile = await runner(
				["arduino-cli", "compile", "--fqbn", job.fqbn, job.dir],
				esp ? FLASH_COMPILE_ESP_TIMEOUT_MS : FLASH_COMPILE_TIMEOUT_MS,
				ctx,
			);
			const logs = [coreLog, compile.log];
			if (compile.code !== 0) {
				return { ok: false, log: joinLogs(...logs) };
			}
			for (let attempt = 1; attempt <= attempts; attempt += 1) {
				if (ctx?.cancelled()) {
					return { ok: false, log: joinLogs(...logs, "stopped") };
				}
				if (attempt > 1) {
					logs.push(`--- attempt ${attempt}/${attempts} ---`);
				}
				const uploadCmd = ["arduino-cli", "upload", "--fqbn", job.fqbn];
				if (job.port) {
					uploadCmd.push("--port", job.port);
				}
				uploadCmd.push(job.dir);
				const upload = await runner(
					uploadCmd,
					esp ? FLASH_UPLOAD_ESP_TIMEOUT_MS : FLASH_UPLOAD_TIMEOUT_MS,
					ctx,
				);
				logs.push(upload.log);
				if (upload.code === 0) {
					return { ok: true, log: joinLogs(...logs) };
				}
				if (attempt >= attempts || ctx?.cancelled()) {
					break;
				}
				if (/no device found/i.test(upload.log)) {
					const present = await portStillPresent(listPorts, job.port);
					if (!present) {
						logs.push(`${job.port ?? "port"} disappeared; not retrying`);
						break;
					}
				}
				if (!RETRYABLE_UPLOAD_FAILURE.test(upload.log)) {
					break;
				}
				if (job.port) {
					await carrier(job.port);
				}
				await Bun.sleep(settleMs);
			}
			return { ok: false, log: joinLogs(...logs) };
		},
	});
}

export function memoryFlash(
	portsJson = '{"detected_ports":[]}',
	upload: (
		job: FlashPut,
	) => Promise<{ ok: boolean; log: string }> = async () => ({
		ok: true,
		log: "ok",
	}),
	hasSketch = true,
	options: FlashControllerOptions = {},
): FlashController {
	return createFlashController(
		{
			async listPorts() {
				return portsJson;
			},
			compileAndUpload: upload,
			hasSketch: () => hasSketch,
		},
		options,
	);
}

async function portStillPresent(
	listPorts: () => Promise<string>,
	port: string | undefined,
): Promise<boolean> {
	if (!port) {
		return true;
	}
	invalidateArduinoBoardCache();
	try {
		const listed = parseArduinoBoardList(await listPorts());
		return listed.some((item) => item.address === port);
	} catch {
		return true;
	}
}

function isEspFqbn(fqbn: string): boolean {
	return /:esp32/i.test(fqbn);
}

async function runWithTimeout(
	cmd: string[],
	timeoutMs: number,
	ctx?: FlashJobContext,
): Promise<FlashRunnerResult> {
	if (ctx?.cancelled()) {
		return { code: 1, log: "stopped" };
	}
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	ctx?.setProc?.(proc);
	let timedOut = false;
	try {
		const timed = Promise.race([
			proc.exited,
			Bun.sleep(timeoutMs).then(() => {
				timedOut = true;
				void killTree(proc).catch(() => {
					try {
						proc.kill("SIGKILL");
					} catch {
						undefined;
					}
				});
				return -1;
			}),
		]);
		const [stdout, stderr, code] = await Promise.all([
			readPipe(proc.stdout),
			readPipe(proc.stderr),
			timed,
		]);
		const log = `${stdout}\n${stderr}`.trim();
		if (timedOut) {
			return {
				code: code === -1 ? 1 : code,
				log: `${log}\n${cmd[0]} timed out after ${Math.round(timeoutMs / 1000)}s`,
			};
		}
		return { code, log };
	} finally {
		ctx?.setProc?.(null);
	}
}

function assertSketchDir(
	dir: string,
	hasSketch?: (dir: string) => boolean,
): void {
	if (hasSketch) {
		if (!hasSketch(dir)) {
			throw new FlashError("dir needs a .c or .ino sketch");
		}
		return;
	}
	try {
		if (!statSync(dir).isDirectory()) {
			throw new FlashError("dir is not a directory");
		}
	} catch (caught) {
		if (caught instanceof FlashError) {
			throw caught;
		}
		throw new FlashError("dir was not found");
	}
	const names = readdirSync(dir);
	if (!names.some((name) => SKETCH_EXT.some((ext) => name.endsWith(ext)))) {
		throw new FlashError("dir needs a .c or .ino sketch");
	}
}

const BOARD_LIST_TTL_MS = 20_000;
const BOARD_LIST_TIMEOUT_MS = 15_000;
let boardListCache: { at: number; json: string } | null = null;
let boardListInflight: Promise<string> | null = null;

export function invalidateArduinoBoardCache(): void {
	boardListCache = null;
}

async function listArduinoBoardsCached(): Promise<string> {
	if (boardListCache && Date.now() - boardListCache.at < BOARD_LIST_TTL_MS) {
		return boardListCache.json;
	}
	if (boardListInflight) {
		return boardListInflight;
	}
	boardListInflight = spawnText(
		["nice", "-n", "15", "arduino-cli", "board", "list", "--format", "json"],
		BOARD_LIST_TIMEOUT_MS,
	)
		.then((json) => {
			if (parseArduinoBoardList(json).length > 0) {
				boardListCache = { at: Date.now(), json };
			}
			return json;
		})
		.catch(() => boardListCache?.json ?? '{"detected_ports":[]}')
		.finally(() => {
			boardListInflight = null;
		});
	return boardListInflight;
}

export async function ensureArduinoCore(fqbn: string): Promise<string> {
	const core = arduinoCoreForFqbn(fqbn);
	if (!core) {
		return "";
	}
	let listed = "[]";
	try {
		listed = await spawnText(
			["arduino-cli", "core", "list", "--format", "json"],
			20_000,
		);
	} catch {
		listed = "[]";
	}
	if (parseArduinoCoreList(listed).includes(core)) {
		return "";
	}
	const logs: string[] = [];
	if (core.startsWith("esp32:")) {
		const add = await spawnResult(
			[
				"arduino-cli",
				"config",
				"add",
				"board_manager.additional_urls",
				ESP32_BOARD_MANAGER_URL,
			],
			20_000,
		);
		if (add.log) {
			logs.push(add.log);
		}
	}
	const install = await spawnResult(
		["nice", "-n", "15", "arduino-cli", "core", "install", core],
		FLASH_CORE_INSTALL_TIMEOUT_MS,
	);
	logs.push(install.log);
	if (install.code !== 0) {
		throw new FlashError(joinLogs(...logs) || `failed to install ${core}`);
	}
	return joinLogs(`installed ${core}`, ...logs);
}

function joinLogs(...parts: string[]): string {
	return parts
		.filter((part) => part.trim().length > 0)
		.join("\n")
		.trim();
}

async function spawnText(cmd: string[], timeoutMs?: number): Promise<string> {
	const result = await spawnResult(cmd, timeoutMs);
	if (result.code !== 0) {
		throw new FlashError(result.log || `${cmd[0]} failed`);
	}
	return result.log;
}

async function spawnResult(
	cmd: string[],
	timeoutMs?: number,
): Promise<{ code: number; log: string }> {
	const proc = Bun.spawn(cmd, {
		stdout: "pipe",
		stderr: "pipe",
		timeout: timeoutMs,
	});
	const [stdout, stderr, code] = await Promise.all([
		readPipe(proc.stdout),
		readPipe(proc.stderr),
		proc.exited,
	]);
	return { code, log: `${stdout}\n${stderr}`.trim() };
}

async function readPipe(
	stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
	if (!stream || typeof stream === "number") {
		return "";
	}
	return new Response(stream).text();
}
