import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	APP_DIR,
	APP_LIST_MAX,
	APP_MAX_TOKENS,
	APP_PORT_MAX,
	APP_PORT_MIN,
	APP_READY_TIMEOUT_MS,
	APP_TOKEN_TTL_MS,
	AppError,
	type AppFrameGrant,
	type AppFramePath,
	type AppStartPut,
	type AppStatus,
	appEntryCandidates,
	appFrameBasePath,
	type BoardApp,
	capAppLog,
	isAppName,
	isAppTokenFresh,
	newAppToken,
	parseAppPackageName,
	parseAppStartPut,
} from "gpio-companion";
import { killTree } from "./gpio.ts";
import { projectsRoot } from "./projects.ts";

export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type AppProcess = {
	pid?: number;
	exited: Promise<number>;
	kill(signal?: "SIGTERM" | "SIGKILL"): void;
	stdout?: ReadableStream<Uint8Array> | number;
	stderr?: ReadableStream<Uint8Array> | number;
};

export type AppMintResult = AppFrameGrant & {
	name: string;
	token: string;
};

export type AppController = {
	status(): AppStatus;
	start(input: unknown): Promise<{ started: true; name: string; port: number }>;
	stop(): { stopped: true };
	mint(name: string): AppMintResult;
	authorize(frame: AppFramePath): { port: number };
	proxy(
		request: Request,
		frame: AppFramePath,
		search: string,
	): Promise<Response>;
};

export type AppOptions = {
	projectsDir?: string;
	bunBin?: string;
	readyTimeoutMs?: number;
	probeMs?: number;
	fetchImpl?: FetchLike;
	spawn?: (job: {
		dir: string;
		entry: string;
		port: number;
		bin: string;
	}) => AppProcess;
	prober?: (port: number) => Promise<boolean>;
	portPicker?: () => Promise<number | null>;
	onLog?: (chunk: string) => void;
};

const STOP_MS = 2_000;

const PROXY_REQUEST_HEADERS = [
	"content-type",
	"accept",
	"accept-language",
	"last-event-id",
	"range",
	"if-none-match",
	"if-modified-since",
];

const PROXY_STRIP_RESPONSE = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
	"content-encoding",
	"set-cookie",
	"set-cookie2",
]);

const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const CORS_MAX_AGE_SECONDS = "600";

function corsPreflightHeaders(request: Request): Headers {
	const headers = new Headers();
	headers.set("access-control-allow-origin", "*");
	headers.set("access-control-allow-methods", CORS_ALLOW_METHODS);
	headers.set("access-control-max-age", CORS_MAX_AGE_SECONDS);
	const requestHeaders = request.headers.get("access-control-request-headers");
	if (requestHeaders) {
		headers.set("access-control-allow-headers", requestHeaders);
	}
	return headers;
}

export function createAppController(options: AppOptions = {}): AppController {
	const fetcher = options.fetchImpl ?? fetch;
	const probe = options.prober ?? ((port: number) => probeHttp(port, fetcher));
	const spawn = options.spawn ?? liveSpawn;
	let running = false;
	let current: {
		name: string;
		repo: string;
		port: number;
		startedAt: number;
		proc: AppProcess | null;
	} | null = null;
	let log = "";
	const tokens = new Map<string, number>();

	function pruneTokens(now = Date.now()) {
		for (const [token, expiresAt] of tokens) {
			if (!isAppTokenFresh(expiresAt, now)) {
				tokens.delete(token);
			}
		}
	}

	function clearTokens() {
		tokens.clear();
	}

	function authorizeFrame(frame: AppFramePath): { port: number } {
		if (!running || !current || current.name !== frame.name) {
			throw new AppError(`app ${frame.name} is not running`, 404);
		}
		pruneTokens();
		const expiresAt = tokens.get(frame.token);
		if (expiresAt === undefined || !isAppTokenFresh(expiresAt)) {
			throw new AppError("app frame token is invalid or expired", 403);
		}
		tokens.set(frame.token, Date.now() + APP_TOKEN_TTL_MS);
		return { port: current.port };
	}

	function append(text: string) {
		log = capAppLog(`${log}${text}`);
		options.onLog?.(text);
	}

	return {
		status() {
			return {
				running,
				name: current?.name ?? null,
				repo: current?.repo ?? null,
				port: current?.port ?? null,
				startedAt: current?.startedAt ?? null,
				log,
			};
		},
		async start(input) {
			const put: AppStartPut = parseAppStartPut(input);
			if (running || current) {
				throw new AppError(
					current?.name
						? `app ${current.name} is already running`
						: "app already running",
					409,
				);
			}
			const repoDir = resolveRepoDir(put.repo, options.projectsDir);
			const appDir = resolveAppDir(put.repo, put.dir, options.projectsDir);
			const manifest = readAppManifest(appDir);
			const port = options.portPicker
				? await options.portPicker()
				: await allocatePort(fetcher);
			if (port === null) {
				throw new AppError("no free app port", 409);
			}
			running = true;
			log = "";
			const startedAt = Date.now();
			current = {
				name: manifest.name,
				repo: put.repo,
				port,
				startedAt,
				proc: null,
			};
			const bin = options.bunBin ?? "bun";
			const proc = spawn({
				dir: repoDir,
				entry: `${APP_DIR}/${put.dir}/${manifest.entry}`,
				port,
				bin,
			});
			current.proc = proc;
			void readLive(proc.stdout, append);
			void readLive(proc.stderr, append);
			const timeoutMs = options.readyTimeoutMs ?? APP_READY_TIMEOUT_MS;
			const outcome = await Promise.race([
				waitReady(port, probe, options.probeMs ?? 150, timeoutMs).then(
					(ready): "ready" | "timeout" => (ready ? "ready" : "timeout"),
				),
				proc.exited.then((code): string => `exit:${code}`),
			]);
			if (outcome !== "ready") {
				await stopCurrent();
				throw new AppError(
					outcome === "timeout"
						? `app did not listen on port ${port} in time\n${logTail(log)}`
						: `app exited before listening (${outcome.slice("exit:".length)})\n${logTail(log)}`,
				);
			}
			void proc.exited.then(() => {
				running = false;
				current = null;
				clearTokens();
			});
			return { started: true, name: manifest.name, port };
		},
		stop() {
			void stopCurrent();
			return { stopped: true };
		},
		mint(name) {
			const clean = name.trim();
			if (!isAppName(clean)) {
				throw new AppError("app name is invalid");
			}
			if (!running || !current || current.name !== clean) {
				throw new AppError(`app ${clean} is not running`, 404);
			}
			pruneTokens();
			while (tokens.size >= APP_MAX_TOKENS) {
				const oldest = tokens.keys().next().value;
				if (oldest === undefined) {
					break;
				}
				tokens.delete(oldest);
			}
			const token = newAppToken();
			const expiresAt = Date.now() + APP_TOKEN_TTL_MS;
			tokens.set(token, expiresAt);
			return {
				name: clean,
				token,
				path: `${appFrameBasePath(clean, token)}/`,
				expiresAt,
			};
		},
		authorize(frame) {
			return authorizeFrame(frame);
		},
		async proxy(request, frame, search) {
			const { port } = authorizeFrame(frame);
			if (request.method.toUpperCase() === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: corsPreflightHeaders(request),
				});
			}
			const target = `http://127.0.0.1:${port}${frame.suffix}${search}`;
			const headers = new Headers();
			for (const name of PROXY_REQUEST_HEADERS) {
				const value = request.headers.get(name);
				if (value) {
					headers.set(name, value);
				}
			}
			const method = request.method.toUpperCase();
			const init: RequestInit & { duplex?: "half" } = { method, headers };
			if (method !== "GET" && method !== "HEAD") {
				init.body = request.body;
				init.duplex = "half";
			}
			let upstream: Response;
			try {
				upstream = await fetcher(target, init);
			} catch {
				return new Response(
					JSON.stringify({ error: "app server unavailable" }),
					{
						status: 503,
						headers: {
							"content-type": "application/json",
							"access-control-allow-origin": "*",
						},
					},
				);
			}
			const out = new Headers();
			upstream.headers.forEach((value, key) => {
				const lower = key.toLowerCase();
				if (
					PROXY_STRIP_RESPONSE.has(lower) ||
					lower.startsWith("access-control-")
				) {
					return;
				}
				out.set(key, value);
			});
			out.set("referrer-policy", "no-referrer");
			out.set("access-control-allow-origin", "*");
			return new Response(upstream.body, {
				status: upstream.status,
				headers: out,
			});
		},
	};

	async function stopCurrent(): Promise<void> {
		const entry = current;
		running = false;
		current = null;
		clearTokens();
		const proc = entry?.proc;
		if (!proc) {
			return;
		}
		await killTree(proc);
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
	}
}

export function appUpstreamWsUrl(
	port: number,
	suffix: string,
	search = "",
): string {
	return `ws://127.0.0.1:${port}${suffix.startsWith("/") ? suffix : `/${suffix}`}${search}`;
}

function liveSpawn(job: {
	dir: string;
	entry: string;
	port: number;
	bin: string;
}): AppProcess {
	return Bun.spawn([job.bin, "run", job.entry], {
		cwd: job.dir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GPIO_APP_PORT: String(job.port) },
	}) as AppProcess;
}

async function probeHttp(port: number, fetcher: FetchLike): Promise<boolean> {
	try {
		const response = await fetcher(`http://127.0.0.1:${port}/`, {
			signal: AbortSignal.timeout(250),
		});
		response.body?.cancel().catch(() => undefined);
		return true;
	} catch (caught) {
		return caught instanceof Error && caught.name === "TimeoutError";
	}
}

async function waitReady(
	port: number,
	probe: (port: number) => Promise<boolean>,
	probeMs: number,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await probe(port)) {
			return true;
		}
		if (Date.now() >= deadline) {
			return false;
		}
		await Bun.sleep(probeMs);
	}
}

async function allocatePort(fetcher: FetchLike): Promise<number | null> {
	for (let port = APP_PORT_MIN; port <= APP_PORT_MAX; port += 1) {
		let occupied = true;
		try {
			const response = await fetcher(`http://127.0.0.1:${port}/`, {
				signal: AbortSignal.timeout(150),
			});
			response.body?.cancel().catch(() => undefined);
		} catch (caught) {
			occupied = caught instanceof Error && caught.name === "TimeoutError";
		}
		if (!occupied) {
			return port;
		}
	}
	return null;
}

function resolveRepoDir(repo: string, projectsDir?: string): string {
	const root = projectsDir ?? projectsRoot();
	const dir = join(root, repo);
	if (!dir.startsWith(root) || dir.includes("..")) {
		throw new AppError("repo is invalid");
	}
	try {
		if (!statSync(dir).isDirectory()) {
			throw new AppError("repo was not found");
		}
	} catch (caught) {
		if (caught instanceof AppError) {
			throw caught;
		}
		throw new AppError("repo was not found");
	}
	return dir;
}

export function listBoardApps(destRoot: string): BoardApp[] {
	if (!destRoot.startsWith("/") || destRoot.includes("..")) {
		return [];
	}
	let projects: string[] = [];
	try {
		projects = readdirSync(destRoot);
	} catch {
		return [];
	}
	const apps: BoardApp[] = [];
	for (const project of projects) {
		if (project.startsWith(".") || project === "node_modules") {
			continue;
		}
		const appRoot = join(destRoot, project, APP_DIR);
		if (!isDir(appRoot)) {
			continue;
		}
		for (const dir of readdirSync(appRoot)) {
			if (apps.length >= APP_LIST_MAX) {
				return apps;
			}
			if (dir.startsWith(".") || dir === "node_modules") {
				continue;
			}
			const appDir = join(appRoot, dir);
			if (!isDir(appDir)) {
				continue;
			}
			try {
				const manifest = readAppManifest(appDir);
				if (
					!apps.some((item) => item.project === project && item.dir === dir)
				) {
					apps.push({
						project,
						dir,
						name: manifest.name,
						entry: manifest.entry,
					});
				}
			} catch {
				// no valid package.json — not a board app
			}
		}
	}
	return apps;
}

function readAppManifest(appDir: string): { name: string; entry: string } {
	const manifestPath = join(appDir, "package.json");
	let pkg: unknown;
	try {
		pkg = JSON.parse(readFileSync(manifestPath, "utf8") as unknown as string);
	} catch {
		throw new AppError("app package.json is missing or invalid");
	}
	const name = parseAppPackageName(pkg);
	const main = (pkg as { main?: unknown }).main;
	const entry = appEntryCandidates(main).find((candidate) =>
		statIsFile(join(appDir, candidate)),
	);
	if (!entry) {
		throw new AppError("app needs package.json main, server.ts, or index.ts");
	}
	return { name, entry };
}

function resolveAppDir(
	repo: string,
	dir: string,
	projectsDir?: string,
): string {
	const root = projectsDir ?? projectsRoot();
	const repoDir = join(root, repo);
	if (!repoDir.startsWith(root) || repoDir.includes("..")) {
		throw new AppError("repo is invalid");
	}
	const appDir = join(repoDir, APP_DIR, dir);
	if (!appDir.startsWith(repoDir) || appDir.includes("..")) {
		throw new AppError("dir is invalid");
	}
	try {
		if (!statSync(appDir).isDirectory()) {
			throw new AppError("app was not found");
		}
	} catch (caught) {
		if (caught instanceof AppError) {
			throw caught;
		}
		throw new AppError("app was not found");
	}
	return appDir;
}

async function readLive(
	stream: ReadableStream<Uint8Array> | number | undefined,
	append: (text: string) => void,
): Promise<void> {
	if (!stream || typeof stream === "number") {
		return;
	}
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		append(decoder.decode(value, { stream: true }));
	}
}

function logTail(log: string): string {
	return log.slice(-500);
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function statIsFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
