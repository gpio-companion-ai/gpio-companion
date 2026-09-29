import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
	type JlcpcbOrderBundle,
	parseJlcpcbDraft,
} from "../../../packages/core/src/jlcpcb-draft.ts";
import { partsFromSearch } from "../../../packages/core/src/jlcpcb-parts.ts";

const ISSUER =
	process.env.GPIO_JLCPCB_AUTH_ISSUER ||
	"https://c138e26ec90148fd88735d42f445004c-auth.webcreas.com";
const CLIENT_ID =
	process.env.GPIO_JLCPCB_AUTH_CLIENT_ID || "__gpio_companion_927ffcf9";
const DASHBOARD =
	process.env.GPIO_COMPANION_DASHBOARD_URL || "https://gpio-companion.com";
const LOOPBACK = process.env.GPIO_JLCPCB_LOOPBACK || "http://127.0.0.1:4150";
export const CLI_REDIRECT_URI =
	process.env.GPIO_JLCPCB_REDIRECT_URI ||
	"https://gpio-companion.com/auth/cli/callback";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type Io = {
	cwd: string;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	fetchImpl?: Fetcher;
	home?: string;
};

type Mode = "dashboard" | "cli";

export async function run(argv: string[], io: Io): Promise<number> {
	const [command, ...rest] = argv;
	if (!command || command === "help" || command === "--help") {
		io.stdout(helpText());
		return 0;
	}
	if (command === "login-start") return loginStartCommand(io);
	if (command === "login") return login(rest, io);
	if (command === "logout") return logout(io);
	if (command === "whoami") return whoami(io);
	if (command === "parts") return parts(rest, io);
	if (command === "draft") return draft(rest, io);
	io.stderr(`unknown command: ${command}`);
	return 1;
}

type LoginExchange = {
	err?: unknown;
	tokens?: { access: string; refresh: string; expiresIn: number };
};

export async function startCliLogin(options: {
	redirectURI?: string;
	readCode: () => Promise<string>;
	authorize?: (
		redirectURI: string,
	) => Promise<{
		url: string;
		challenge: { verifier?: string; state?: string };
	}>;
	exchange?: (
		code: string,
		redirectURI: string,
		verifier: string,
	) => Promise<LoginExchange>;
	persist?: (tokens: {
		access: string;
		refresh: string;
		expiresIn: number;
	}) => Promise<void>;
	onStarted?: (started: { authorizeUrl: string; state: string }) => void;
}): Promise<void> {
	const redirectURI = options.redirectURI || CLI_REDIRECT_URI;
	const authorize =
		options.authorize ??
		(async (uri) => {
			const { createClient } = await loadAuthClient();
			const client = createClient({ clientID: CLIENT_ID, issuer: ISSUER });
			return client.authorize(uri, "code", { pkce: true, provider: "github" });
		});
	const authorized = await authorize(redirectURI);
	const verifier = authorized.challenge.verifier;
	const state = authorized.challenge.state;
	if (!verifier || !state) {
		throw new Error("PKCE challenge was not created");
	}
	options.onStarted?.({ authorizeUrl: authorized.url, state });
	const raw = await options.readCode();
	const { callbackCodeFromInput } = await loadCliStorage();
	const code = callbackCodeFromInput(raw, state);
	const exchange =
		options.exchange ??
		(async (nextCode, uri, nextVerifier) => {
			const { createClient } = await loadAuthClient();
			const client = createClient({ clientID: CLIENT_ID, issuer: ISSUER });
			return client.exchange(nextCode, uri, nextVerifier);
		});
	const exchanged = await exchange(code, redirectURI, verifier);
	if (exchanged.err || !exchanged.tokens?.access || !exchanged.tokens.refresh) {
		throw new Error("Authorization code exchange failed");
	}
	if (options.persist) {
		await options.persist(exchanged.tokens);
		return;
	}
	const { fileAuthStorage, defaultCliTokenPath, AUTH_STORAGE_KEYS } =
		await loadCliStorage();
	const storage = fileAuthStorage(defaultCliTokenPath(CLIENT_ID));
	const expiresAt = Date.now() + exchanged.tokens.expiresIn * 1000;
	storage.set(AUTH_STORAGE_KEYS.token, exchanged.tokens.access);
	storage.set(AUTH_STORAGE_KEYS.refresh, exchanged.tokens.refresh);
	storage.set(AUTH_STORAGE_KEYS.expiresAt, String(expiresAt));
}

async function loginStartCommand(io: Io): Promise<number> {
	let printed = false;
	try {
		await startCliLogin({
			onStarted(started) {
				printed = true;
				io.stdout(JSON.stringify(started));
			},
			readCode: () => readStdin(),
		});
		await writeMode(io, "cli");
		return 0;
	} catch (caught) {
		if (!printed) {
			io.stderr(caught instanceof Error ? caught.message : "login failed");
		}
		return 1;
	}
}

async function login(args: string[], io: Io): Promise<number> {
	const flags = flagsOf(args);
	if (flags.has("dashboard")) {
		const response = await fetchJson(io, `${LOOPBACK}/v1/jlcpcb`);
		if (!response.ok) {
			io.stderr(response.error || "dashboard login failed");
			return 1;
		}
		await writeMode(io, "dashboard");
		io.stdout("logged in via the dashboard");
		return 0;
	}
	const code = flags.get("code");
	const host = flags.get("host");
	try {
		const { OpenAuthsterCliClient } = await loadCli();
		const auth = new OpenAuthsterCliClient({
			issuer: ISSUER,
			clientID: CLIENT_ID,
			hostname: host,
		});
		await auth.login({
			open: !flags.has("no-browser") && !code,
			readCode: code
				? async () => code
				: flags.has("no-browser")
					? async () => readStdin()
					: undefined,
		});
		await writeMode(io, "cli");
		io.stdout("logged in");
		return 0;
	} catch (caught) {
		io.stderr(caught instanceof Error ? caught.message : "login failed");
		return 1;
	}
}

async function logout(io: Io): Promise<number> {
	await writeMode(io, null);
	try {
		const { OpenAuthsterCliClient } = await loadCli();
		const auth = new OpenAuthsterCliClient({
			issuer: ISSUER,
			clientID: CLIENT_ID,
		});
		auth.logout();
	} catch {
		// Dashboard mode has no OpenAuthster session.
	}
	io.stdout("logged out");
	return 0;
}

async function whoami(io: Io): Promise<number> {
	const mode = await readMode(io);
	if (!mode) {
		io.stderr("not logged in");
		return 1;
	}
	const status = await api(io, mode, "GET", "/jlcpcb");
	if (!status.ok) {
		io.stderr(status.error || "not logged in");
		return 1;
	}
	const configured = Boolean(
		(status.data as { configured?: boolean } | undefined)?.configured,
	);
	io.stdout(`${mode} configured=${configured}`);
	return 0;
}

async function parts(args: string[], io: Io): Promise<number> {
	const query = args
		.filter((arg) => !arg.startsWith("--"))
		.join(" ")
		.trim();
	if (!query) {
		io.stderr("component code or keyword is required");
		return 1;
	}
	const mode = await requireMode(io);
	if (!mode) return 1;
	const path = mode === "dashboard" ? "/jlcpcb" : "/jlcpcb/parts";
	const status = await api(io, mode, "POST", path, { query });
	if (!status.ok) {
		io.stderr(status.error || "jlcpcb request failed");
		return 1;
	}
	const found = partsFromSearch(status.data);
	if (found.length === 0) {
		io.stdout("no parts");
		return 0;
	}
	for (const part of found) {
		io.stdout(
			[part.componentCode, part.name, part.package, part.stock, part.price]
				.filter((item) => item !== undefined && item !== "")
				.join("\t"),
		);
	}
	return 0;
}

async function draft(args: string[], io: Io): Promise<number> {
	const [action, ...rest] = args;
	if (action === "init") return draftInit(rest, io);
	if (action === "add-part") return draftAdd(rest, io);
	if (action === "show") return draftShow(io);
	if (action === "push") return draftPush(io);
	io.stderr("draft commands: init, add-part, show, push");
	return 1;
}

async function draftInit(args: string[], io: Io): Promise<number> {
	const flags = flagsOf(args);
	const repo = flags.get("repo") || basename(io.cwd);
	const pcb = await firstMatch(io.cwd, "pcb", [".zip", ".gbr"]);
	const prints = await printsFromManifest(io.cwd);
	const bundle: JlcpcbOrderBundle = {
		version: 1,
		repo,
		parts: [],
		prints,
		assembly: { lines: [] },
		updatedAt: new Date().toISOString(),
	};
	if (pcb) bundle.pcb = { file: pcb };
	const parsed = parseJlcpcbDraft(bundle);
	if (!parsed) {
		io.stderr("order draft is invalid");
		return 1;
	}
	await writeDraft(io, parsed);
	io.stdout(`wrote ${draftPath(io.cwd)}`);
	return 0;
}

async function draftAdd(args: string[], io: Io): Promise<number> {
	const flags = flagsOf(args);
	const code = args.find(
		(arg) => !arg.startsWith("--") && arg !== flags.get("qty"),
	);
	const qty = Number(flags.get("qty") || "1");
	if (!code || !Number.isInteger(qty) || qty < 1) {
		io.stderr("usage: draft add-part C2040 --qty 2");
		return 1;
	}
	const current = (await readDraft(io)) ?? {
		version: 1 as const,
		repo: basename(io.cwd),
		parts: [],
		prints: [],
		assembly: { lines: [] },
		updatedAt: new Date().toISOString(),
	};
	const next = parseJlcpcbDraft({
		...current,
		parts: [
			...current.parts.filter(
				(part) => part.componentCode.toUpperCase() !== code.toUpperCase(),
			),
			{ componentCode: code, qty },
		],
		assembly: {
			...current.assembly,
			lines: [
				...current.assembly.lines.filter(
					(line) => line.componentCode.toUpperCase() !== code.toUpperCase(),
				),
				{ componentCode: code, qty },
			],
		},
	});
	if (!next) {
		io.stderr("order draft is invalid");
		return 1;
	}
	await writeDraft(io, next);
	io.stdout(`${next.parts.at(-1)?.componentCode} qty ${qty}`);
	return 0;
}

async function draftShow(io: Io): Promise<number> {
	const draft = await readDraft(io);
	if (!draft) {
		io.stderr("no order draft");
		return 1;
	}
	io.stdout(JSON.stringify(draft, null, 2));
	return 0;
}

async function draftPush(io: Io): Promise<number> {
	const draft = await readDraft(io);
	if (!draft) {
		io.stderr("no order draft");
		return 1;
	}
	const mode = await requireMode(io);
	if (!mode) return 1;
	const path = mode === "dashboard" ? "/jlcpcb/draft" : "/jlcpcb/draft";
	const status = await api(io, mode, "PUT", path, draft);
	if (!status.ok) {
		io.stderr(status.error || "order draft is invalid");
		return 1;
	}
	io.stdout("draft pushed");
	return 0;
}

async function api(
	io: Io,
	mode: Mode,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
	if (mode === "dashboard") {
		return fetchJson(io, `${LOOPBACK}/v1${path}`, method, body);
	}
	const token = await accessToken();
	if (!token) {
		return { ok: false, error: "not logged in" };
	}
	const cloudPath = path === "/jlcpcb" ? "/jlcpcb/credentials" : path;
	return fetchJson(
		io,
		`${DASHBOARD}/api/mobile${cloudPath}`,
		method,
		body,
		token,
	);
}

async function accessToken(): Promise<string | null> {
	if (process.env.GPIO_JLCPCB_TOKEN) return process.env.GPIO_JLCPCB_TOKEN;
	try {
		const { OpenAuthsterCliClient } = await loadCli();
		const auth = new OpenAuthsterCliClient({
			issuer: ISSUER,
			clientID: CLIENT_ID,
		});
		if (!auth.isAuthenticated) return null;
		return await auth.getValidAccessToken();
	} catch {
		return null;
	}
}

async function fetchJson(
	io: Io,
	url: string,
	method = "GET",
	body?: unknown,
	token?: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
	const headers = new Headers({ accept: "application/json" });
	if (token) headers.set("authorization", `Bearer ${token}`);
	const init: RequestInit = { method, headers };
	if (body !== undefined) {
		headers.set("content-type", "application/json");
		init.body = JSON.stringify(body);
	}
	const fetcher = io.fetchImpl ?? ((input, init) => fetch(input, init));
	let response: Response;
	try {
		response = await fetcher(url, init);
	} catch (caught) {
		return {
			ok: false,
			error: caught instanceof Error ? caught.message : "request failed",
		};
	}
	const payload = (await response.json().catch(() => null)) as {
		ok?: boolean;
		data?: unknown;
		error?: string;
	} | null;
	if (!response.ok || payload?.ok === false) {
		return { ok: false, error: payload?.error || "request failed" };
	}
	return { ok: true, data: payload?.data ?? payload };
}

function printFile(file: string | undefined): string | null {
	if (!file || file.includes("/") || file.includes("\\") || file.startsWith(".")) {
		return null;
	}
	if (file.endsWith(".glb")) return `model/${file.slice(0, -4)}.stl`;
	if (file.endsWith(".stl")) return `model/${file}`;
	return null;
}

async function printsFromManifest(
	cwd: string,
): Promise<JlcpcbOrderBundle["prints"]> {
	try {
		const raw = JSON.parse(
			await readFile(join(cwd, "model", "manifest.json"), "utf8"),
		) as { parts?: Array<{ name?: string; file?: string }> };
		const prints: JlcpcbOrderBundle["prints"] = [];
		for (const part of raw.parts ?? []) {
			const file = printFile(part.file);
			if (!part.name || !file) continue;
			prints.push({ name: part.name, file });
		}
		return prints;
	} catch {
		return [];
	}
}

async function firstMatch(
	cwd: string,
	dir: string,
	suffixes: string[],
): Promise<string | null> {
	const glob = new Bun.Glob(`${dir}/**/*`);
	for await (const path of glob.scan({ cwd, onlyFiles: true })) {
		if (suffixes.some((suffix) => path.endsWith(suffix))) {
			return path;
		}
	}
	return null;
}

function draftPath(cwd: string): string {
	return join(cwd, "order", "jlcpcb.json");
}

async function readDraft(io: Io): Promise<JlcpcbOrderBundle | null> {
	try {
		return parseJlcpcbDraft(
			JSON.parse(await readFile(draftPath(io.cwd), "utf8")),
		);
	} catch {
		return null;
	}
}

async function writeDraft(io: Io, draft: JlcpcbOrderBundle): Promise<void> {
	const path = draftPath(io.cwd);
	await mkdir(join(io.cwd, "order"), { recursive: true });
	await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`);
}

function configDir(io: Io): string {
	return (
		io.home ||
		process.env.GPIO_JLCPCB_HOME ||
		join(homedir(), ".config", "gpio-jlcpcb")
	);
}

async function readMode(io: Io): Promise<Mode | null> {
	try {
		const raw = JSON.parse(
			await readFile(join(configDir(io), "mode.json"), "utf8"),
		) as { mode?: string };
		return raw.mode === "dashboard" || raw.mode === "cli" ? raw.mode : null;
	} catch {
		return null;
	}
}

async function writeMode(io: Io, mode: Mode | null): Promise<void> {
	const dir = configDir(io);
	await mkdir(dir, { recursive: true });
	if (!mode) {
		await writeFile(join(dir, "mode.json"), "{}\n");
		return;
	}
	await writeFile(join(dir, "mode.json"), `${JSON.stringify({ mode })}\n`);
}

async function requireMode(io: Io): Promise<Mode | null> {
	const mode = await readMode(io);
	if (!mode) {
		io.stderr("not logged in");
		return null;
	}
	return mode;
}

function flagsOf(
	args: string[],
): Map<string, string> & { has(name: string): boolean } {
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? "";
		if (!arg.startsWith("--")) continue;
		const name = arg.slice(2);
		const next = args[index + 1];
		if (next && !next.startsWith("--")) {
			flags.set(name, next);
			index += 1;
		} else {
			flags.set(name, "true");
		}
	}
	return flags;
}

async function readStdin(): Promise<string> {
	return (await Bun.stdin.text()).trim();
}

async function loadAuthClient(): Promise<{
	createClient(options: { clientID: string; issuer: string }): {
		authorize(
			redirectURI: string,
			type: "code",
			options: { pkce: boolean; provider?: string },
		): Promise<{
			url: string;
			challenge: { verifier?: string; state?: string };
		}>;
		exchange(
			code: string,
			redirectURI: string,
			verifier: string,
		): Promise<LoginExchange>;
	};
}> {
	const specifier = ["openauthster-shared", "client"].join("/");
	return import(specifier);
}

async function loadCliStorage(): Promise<{
	fileAuthStorage: (path: string) => {
		set(key: string, value: string): void;
	};
	defaultCliTokenPath: (clientID: string) => string;
	AUTH_STORAGE_KEYS: { token: string; refresh: string; expiresAt: string };
	callbackCodeFromInput: (input: string, expectedState?: string) => string;
}> {
	const specifier = ["openauthster-shared", "client/cli"].join("/");
	return import(specifier);
}

async function loadCli(): Promise<{
	OpenAuthsterCliClient: new (options: {
		issuer: string;
		clientID: string;
		hostname?: string;
	}) => {
		isAuthenticated: boolean;
		login(options?: {
			open?: boolean;
			readCode?: () => Promise<string>;
		}): Promise<unknown>;
		logout(): void;
		getValidAccessToken(): Promise<string>;
	};
}> {
	const specifier = ["openauthster-shared", "client/cli"].join("/");
	return import(specifier);
}

function helpText(): string {
	return [
		"gpio-jlcpcb login [--dashboard] [--code URL] [--host HOST]",
		"gpio-jlcpcb logout",
		"gpio-jlcpcb whoami",
		"gpio-jlcpcb parts <LCSC code or keyword>",
		"gpio-jlcpcb draft init [--repo owner/name]",
		"gpio-jlcpcb draft add-part C2040 --qty 2",
		"gpio-jlcpcb draft show",
		"gpio-jlcpcb draft push",
	].join("\n");
}
