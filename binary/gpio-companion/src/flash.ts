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

export type FlashBackend = {
	listPorts(): Promise<string>;
	compileAndUpload(job: FlashPut): Promise<{ ok: boolean; log: string }>;
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
};

const SKETCH_EXT = [".c", ".ino"];

export function createFlashController(backend: FlashBackend): FlashController {
	let running = false;
	let last: FlashResult | null = null;
	return {
		status() {
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
			const startedAt = Date.now();
			void (async () => {
				try {
					await backend.beforeUpload?.(put);
					const result = await backend.compileAndUpload(put);
					last = {
						ok: result.ok,
						fqbn: put.fqbn,
						dir: put.dir,
						port: put.port,
						log: capFlashLog(result.log),
						startedAt,
						finishedAt: Date.now(),
					};
					await backend.afterUpload?.(put, result);
				} catch (caught) {
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
				} finally {
					running = false;
				}
			})();
			return { started: true };
		},
	};
}

export function createArduinoFlash(hooks?: {
	beforeUpload?: FlashBackend["beforeUpload"];
	afterUpload?: FlashBackend["afterUpload"];
}): FlashController {
	return createFlashController({
		beforeUpload: hooks?.beforeUpload,
		afterUpload: hooks?.afterUpload,
		listPorts: () => listArduinoBoardsCached(),
		async compileAndUpload(job) {
			invalidateArduinoBoardCache();
			const coreLog = await ensureArduinoCore(job.fqbn);
			const compile = await spawnResult([
				"arduino-cli",
				"compile",
				"--fqbn",
				job.fqbn,
				job.dir,
			]);
			if (compile.code !== 0) {
				return { ok: false, log: joinLogs(coreLog, compile.log) };
			}
			const uploadCmd = ["arduino-cli", "upload", "--fqbn", job.fqbn];
			if (job.port) {
				uploadCmd.push("--port", job.port);
			}
			uploadCmd.push(job.dir);
			const upload = await spawnResult(uploadCmd);
			return {
				ok: upload.code === 0,
				log: joinLogs(coreLog, compile.log, upload.log),
			};
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
): FlashController {
	return createFlashController({
		async listPorts() {
			return portsJson;
		},
		compileAndUpload: upload,
		hasSketch: () => hasSketch,
	});
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
		listed = await spawnText([
			"arduino-cli",
			"core",
			"list",
			"--format",
			"json",
		]);
	} catch {
		listed = "[]";
	}
	if (parseArduinoCoreList(listed).includes(core)) {
		return "";
	}
	const logs: string[] = [];
	if (core.startsWith("esp32:")) {
		const add = await spawnResult([
			"arduino-cli",
			"config",
			"add",
			"board_manager.additional_urls",
			ESP32_BOARD_MANAGER_URL,
		]);
		if (add.log) {
			logs.push(add.log);
		}
	}
	const install = await spawnResult([
		"nice",
		"-n",
		"15",
		"arduino-cli",
		"core",
		"install",
		core,
	]);
	logs.push(install.log);
	if (install.code !== 0) {
		throw new FlashError(
			joinLogs(...logs) || `failed to install ${core}`,
		);
	}
	return joinLogs(`installed ${core}`, ...logs);
}

function joinLogs(...parts: string[]): string {
	return parts.filter((part) => part.trim().length > 0).join("\n").trim();
}

async function spawnText(
	cmd: string[],
	timeoutMs?: number,
): Promise<string> {
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
