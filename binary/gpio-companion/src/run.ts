import {
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	type ArduinoProxyStatus,
	capRunLog,
	type GpioSnapshot,
	type HardwareId,
	isArduinoProxySketchName,
	parseRunPut,
	RunError,
	type RunPut,
	type RunResult,
	type RunStatus,
} from "gpio-companion";
import type { ArduinoProxyController } from "./arduino-proxy.ts";
import { type GpioController, killTree } from "./gpio.ts";

export type RunController = {
	status(): RunStatus;
	start(input: unknown): { started: true };
	stop(): { stopped: true };
	statusPath?(): string | null;
};

export type HostRunOptions = {
	hardware: HardwareId | (() => HardwareId | Promise<HardwareId>);
	gpio?: GpioController;
	proxy?: ArduinoProxyController;
	hostDir?: string;
	compileAndRun?: (job: {
		dir: string;
		pinmapPath: string;
		outPath: string;
		hostDir: string;
		proxy?: boolean;
		setProc?: (proc: RunProcess | null) => void;
		cancelled?: () => boolean;
		statusPath?: string;
	}) => Promise<{ ok: boolean; log: string; proc?: RunProcess }>;
	hasSketch?: (dir: string) => boolean;
	onLog?: (chunk: string) => void;
	onRunning?: (running: boolean) => void;
	isBusy?: () => boolean;
	proxyRestoreMs?: { delay?: number; retry?: number };
};

export type RunProcess = {
	pid?: number;
	exited: Promise<number>;
	kill(signal?: "SIGTERM" | "SIGKILL"): void;
	stdout?: ReadableStream<Uint8Array> | number;
	stderr?: ReadableStream<Uint8Array> | number;
};

const SKETCH_EXT = [".c", ".ino"];
const COMPILE_MS = 60_000;
const STOP_MS = 2_000;
export const PROXY_RESTORE_MS = 400;
export const PROXY_RESTORE_RETRY_MS = 1_500;

export function createRunController(options: HostRunOptions): RunController {
	let running = false;
	let cancelled = false;
	let log = "";
	let last: RunResult | null = null;
	let current: RunProcess | null = null;
	let statusPath: string | null = null;
	return {
		status() {
			return { running, log, last };
		},
		statusPath() {
			return statusPath;
		},
		start(input) {
			const put = parseRunPut(input);
			assertSketchDir(put.dir, options.hasSketch);
			if (running) {
				throw new RunError("run already running", 409);
			}
			if (options.isBusy?.()) {
				throw new RunError("verify already running", 409);
			}
			running = true;
			cancelled = false;
			log = "";
			options.onRunning?.(true);
			const startedAt = Date.now();
			void runJob(put, options, startedAt, {
				append(text) {
					log = capRunLog(`${log}${text}`);
					options.onLog?.(text);
				},
				setProc(proc) {
					current = proc;
				},
				cancelled() {
					return cancelled;
				},
				setStatusPath(path) {
					statusPath = path;
				},
			})
				.then((result) => {
					last = result;
					log = result.log;
				})
				.catch((caught) => {
					last = {
						ok: false,
						dir: put.dir,
						log: capRunLog(
							caught instanceof Error ? caught.message : "run failed",
						),
						startedAt,
						finishedAt: Date.now(),
					};
					log = last.log;
				})
				.finally(() => {
					current = null;
					running = false;
					statusPath = null;
					options.onRunning?.(false);
				});
			return { started: true };
		},
		stop() {
			cancelled = true;
			const proc = current;
			if (proc) {
				void killTree(proc).then(async () => {
					const done = await Promise.race([
						proc.exited.then(() => true),
						Bun.sleep(STOP_MS).then(() => false),
					]);
					if (!done) {
						try {
							proc.kill("SIGKILL");
						} catch {
							undefined;
						}
					}
				});
			}
			return { stopped: true };
		},
	};
}

export function createHostRun(options: HostRunOptions): RunController {
	return createRunController({
		...options,
		compileAndRun: options.compileAndRun ?? liveCompileAndRun,
	});
}

export function memoryRun(
	upload: (job: RunPut) => Promise<{
		ok: boolean;
		log: string;
		proc?: RunProcess;
	}> = async () => ({ ok: true, log: "ok" }),
	hasSketch = true,
): RunController {
	return createRunController({
		hardware: "raspberrypi",
		hasSketch: () => hasSketch,
		async compileAndRun(job) {
			return upload({ dir: job.dir });
		},
	});
}

function assertSketchDir(
	dir: string,
	hasSketch?: (dir: string) => boolean,
): void {
	if (hasSketch) {
		if (!hasSketch(dir)) {
			throw new RunError("dir needs a .c or .ino sketch");
		}
		return;
	}
	try {
		if (!statSync(dir).isDirectory()) {
			throw new RunError("dir is not a directory");
		}
	} catch (caught) {
		if (caught instanceof RunError) {
			throw caught;
		}
		throw new RunError("dir was not found");
	}
	if (!sketchFiles(dir).length) {
		throw new RunError("dir needs a .c or .ino sketch");
	}
}

async function runJob(
	put: RunPut,
	options: HostRunOptions,
	startedAt: number,
	hooks: {
		append(text: string): void;
		setProc(proc: RunProcess | null): void;
		cancelled(): boolean;
		setStatusPath(path: string | null): void;
	},
): Promise<RunResult> {
	const stopped = (): RunResult => ({
		ok: true,
		dir: put.dir,
		log: "stopped",
		startedAt,
		finishedAt: Date.now(),
	});
	if (hooks.cancelled()) {
		return stopped();
	}
	const hostDir = options.hostDir ?? resolveHostDir();
	const work = join(tmpdir(), "gpio-companion-run", String(startedAt));
	mkdirSync(work, { recursive: true });
	const pinmapPath = join(work, "pins.txt");
	const outPath = join(work, "sketch");
	const statusFile = join(work, "gpio-host-status.json");
	hooks.setStatusPath(statusFile);
	const proxySketch = isArduinoProxySketchName(basename(put.dir));
	let restore: { port: string; fqbn?: string } | null = null;
	let restoreHeld = false;
	try {
		if (proxySketch) {
			const proxy = options.proxy;
			if (!proxy?.status().connected) {
				throw new RunError("arduino-proxy not connected");
			}
			const port = proxy.status().port;
			if (port) {
				restore = { port, fqbn: proxy.status().fqbn };
			}
			proxy.hold(true);
			restoreHeld = true;
			proxy.release();
			writeFileSync(pinmapPath, formatProxyPinmap(proxy.status()));
		} else if (options.gpio?.releaseAll) {
			await options.gpio.releaseAll();
		}
		const hardware =
			typeof options.hardware === "function"
				? await options.hardware()
				: options.hardware;
		if (!proxySketch && options.gpio) {
			writeFileSync(
				pinmapPath,
				formatPinmap(await options.gpio.snapshot(hardware)),
			);
		} else if (!proxySketch) {
			writeFileSync(pinmapPath, `hardware ${hardware}\n`);
		}
		if (hooks.cancelled()) {
			return stopped();
		}
		const compile = options.compileAndRun ?? liveCompileAndRun;
		const result = await compile({
			dir: put.dir,
			pinmapPath,
			outPath,
			hostDir,
			proxy: proxySketch,
			setProc: hooks.setProc,
			cancelled: hooks.cancelled,
			statusPath: statusFile,
		});
		if (hooks.cancelled()) {
			if (result.proc) {
				await killTree(result.proc);
			}
			return {
				ok: true,
				dir: put.dir,
				log: capRunLog(result.log || "stopped"),
				startedAt,
				finishedAt: Date.now(),
			};
		}
		if (!result.ok || !result.proc) {
			return {
				ok: result.ok,
				dir: put.dir,
				log: capRunLog(result.log),
				startedAt,
				finishedAt: Date.now(),
			};
		}
		hooks.setProc(result.proc);
		const [stdout, stderr] = await Promise.all([
			readLive(result.proc.stdout, hooks.append),
			readLive(result.proc.stderr, hooks.append),
		]);
		const code = await result.proc.exited;
		return {
			ok: code === 0,
			dir: put.dir,
			log: capRunLog(`${result.log}\n${stdout}\n${stderr}`.trim()),
			startedAt,
			finishedAt: Date.now(),
		};
	} finally {
		hooks.setStatusPath(null);
		if (!proxySketch) {
			try {
				unlinkSync(statusFile);
			} catch {
				undefined;
			}
		}
		if (restoreHeld && options.proxy) {
			options.proxy.hold(false);
			if (restore) {
				void restoreArduinoProxy(
					options.proxy,
					restore.port,
					restore.fqbn,
					options,
				);
			}
		}
	}
}

async function restoreArduinoProxy(
	proxy: ArduinoProxyController,
	port: string,
	fqbn: string | undefined,
	options: HostRunOptions,
): Promise<void> {
	const delayMs = options.proxyRestoreMs?.delay ?? PROXY_RESTORE_MS;
	const retryMs = options.proxyRestoreMs?.retry ?? PROXY_RESTORE_RETRY_MS;
	if (delayMs > 0) {
		await Bun.sleep(delayMs);
	}
	try {
		await proxy.attach(port, fqbn);
	} catch {
		if (retryMs > 0) {
			await Bun.sleep(retryMs);
		}
		await proxy.attach(port, fqbn).catch(() => undefined);
	}
}

async function liveCompileAndRun(job: {
	dir: string;
	pinmapPath: string;
	outPath: string;
	hostDir: string;
	proxy?: boolean;
	setProc?: (proc: RunProcess | null) => void;
	cancelled?: () => boolean;
	statusPath?: string;
}): Promise<{ ok: boolean; log: string; proc?: RunProcess }> {
	if (job.cancelled?.()) {
		return { ok: true, log: "stopped" };
	}
	const sketches = sketchFiles(job.dir);
	if (!sketches.length) {
		return { ok: false, log: "dir needs a .c or .ino sketch" };
	}
	const shim = job.proxy ? "arduino-proxy.c" : "arduino.c";
	const compile = await spawnResult(
		[
			"gcc",
			"-O2",
			"-Wall",
			"-std=c11",
			"-I",
			job.hostDir,
			"-o",
			job.outPath,
			join(job.hostDir, "main.c"),
			join(job.hostDir, shim),
			"-x",
			"c",
			...sketches,
			...(job.proxy ? ["-lpthread"] : ["-lgpiod", "-lpthread"]),
		],
		COMPILE_MS,
		job,
	);
	if (job.cancelled?.()) {
		return { ok: true, log: compile.log || "stopped" };
	}
	if (compile.code !== 0) {
		return { ok: false, log: compile.log || "gcc failed" };
	}
	if (job.cancelled?.()) {
		return { ok: true, log: compile.log || "stopped" };
	}
	const proc = Bun.spawn([job.outPath, "--pinmap", job.pinmapPath], {
		cwd: job.dir,
		stdout: "pipe",
		stderr: "pipe",
		env:
			job.proxy || !job.statusPath
				? undefined
				: { ...process.env, GPIO_HOST_STATUS: job.statusPath },
	});
	if (job.cancelled?.()) {
		await killTree(proc);
		return { ok: true, log: compile.log || "stopped" };
	}
	return {
		ok: true,
		log: compile.log,
		proc,
	};
}

export function formatPinmap(snapshot: GpioSnapshot): string {
	const lines = [`hardware ${snapshot.hardware}`];
	for (const pin of snapshot.pins) {
		if (pin.type === "power") {
			lines.push(`${pin.physical} power`);
			continue;
		}
		if (pin.type === "gnd") {
			lines.push(`${pin.physical} gnd`);
			continue;
		}
		if (pin.reserved) {
			lines.push(`${pin.physical} reserved`);
			continue;
		}
		if (pin.unresolved || !pin.chip || pin.line === undefined) {
			lines.push(`${pin.physical} unresolved`);
			continue;
		}
		const adc = pin.adc !== undefined ? " adc" : "";
		lines.push(`${pin.physical} gpio ${pin.chip} ${pin.line}${adc}`);
	}
	return `${lines.join("\n")}\n`;
}

export function formatProxyPinmap(status: ArduinoProxyStatus): string {
	const lines = [
		"target arduino-proxy",
		`port ${status.port ?? ""}`,
		`baud ${status.baud ?? 57600}`,
	];
	for (const pin of status.pins) {
		if (pin.reserved) {
			lines.push(`${pin.physical} reserved`);
			continue;
		}
		const flags = [
			pin.adc !== undefined ? "adc" : "",
			pin.alt?.includes("PWM") ? "pwm" : "",
		]
			.filter(Boolean)
			.join(" ");
		lines.push(`${pin.physical} gpio ${flags}`.trim());
	}
	return `${lines.join("\n")}\n`;
}

function sketchFiles(dir: string): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => SKETCH_EXT.some((ext) => name.endsWith(ext)))
			.map((name) => join(dir, name));
	} catch {
		return [];
	}
}

function resolveHostDir(): string {
	const installed = "/usr/local/lib/gpio-companion/gpio-host";
	const source = new URL("../../../native/gpio-host", import.meta.url).pathname;
	if (statExists(join(installed, "arduino.c"))) {
		return installed;
	}
	return source;
}

function statExists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

async function spawnResult(
	cmd: string[],
	timeoutMs: number,
	hooks?: {
		setProc?: (proc: RunProcess | null) => void;
		cancelled?: () => boolean;
	},
): Promise<{ code: number; log: string }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	hooks?.setProc?.(proc);
	try {
		const timed = Promise.race([
			proc.exited,
			Bun.sleep(timeoutMs).then(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					undefined;
				}
				return 1;
			}),
		]);
		const [stdout, stderr, code] = await Promise.all([
			readPipe(proc.stdout),
			readPipe(proc.stderr),
			timed,
		]);
		return { code, log: `${stdout}\n${stderr}`.trim() };
	} finally {
		hooks?.setProc?.(null);
	}
}

async function readLive(
	stream: ReadableStream<Uint8Array> | number | undefined,
	append: (text: string) => void,
): Promise<string> {
	if (!stream || typeof stream === "number") {
		return "";
	}
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		const chunk = decoder.decode(value, { stream: true });
		text += chunk;
		append(chunk);
	}
	return text;
}

async function readPipe(
	stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
	if (!stream || typeof stream === "number") {
		return "";
	}
	return new Response(stream).text();
}
