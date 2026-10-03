import { isAbsolute, resolve } from "node:path";

export type Fetcher = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export type CliIo = {
	cwd: string;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	fetchImpl?: Fetcher;
	env?: NodeJS.ProcessEnv;
};

const DEFAULT_LOOPBACK = "http://127.0.0.1:4150";

function baseUrl(io: CliIo, extra: string[]): string {
	for (let i = 0; i < extra.length; i += 1) {
		if (extra[i] === "--url" && extra[i + 1])
			return extra[i + 1].replace(/\/+$/, "");
		const m = /^--url=(.+)$/.exec(extra[i] ?? "");
		if (m) return m[1].replace(/\/+$/, "");
	}
	const env = io.env ?? process.env;
	const fromEnv = (env.GPIO_COMPANION_URL ?? "").trim().replace(/\/+$/, "");
	if (fromEnv) return fromEnv;
	const port = Number(env.GPIO_COMPANION_PORT ?? "4150");
	if (Number.isFinite(port) && port > 0) {
		if (port !== 4150) return `http://127.0.0.1:${port}`;
	}
	return DEFAULT_LOOPBACK;
}

function wantsJson(args: string[]): boolean {
	return args.includes("--json");
}

function flag(args: string[], ...names: string[]): string | undefined {
	for (let i = 0; i < args.length; i += 1) {
		for (const name of names) {
			if (args[i] === name && i + 1 < args.length) return args[i + 1];
			const m = new RegExp(`^${escapeReg(name)}=(.+)$`).exec(args[i] ?? "");
			if (m) return m[1];
		}
	}
	return undefined;
}

function escapeReg(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFlag(args: string[], ...names: string[]): boolean {
	return args.some((a) => names.includes(a));
}

function repeatFlag(args: string[], ...names: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		for (const name of names) {
			if (args[i] === name && i + 1 < args.length) {
				out.push(args[i + 1] as string);
			} else {
				const m = new RegExp(`^${escapeReg(name)}=(.+)$`).exec(args[i] ?? "");
				if (m) out.push(m[1]);
			}
		}
	}
	return out;
}

function stripGlobal(args: string[]): string[] {
	return args.filter((a) => a !== "--json" && !a.startsWith("--url"));
}

function absolutize(cwd: string, p: string): string {
	if (isAbsolute(p)) return p;
	return resolve(cwd, p);
}

async function call(
	io: CliIo,
	method: string,
	path: string,
	body?: unknown,
	extraArgs: string[] = [],
): Promise<number> {
	const url = `${baseUrl(io, extraArgs)}${path}`;
	const fetchImpl = io.fetchImpl ?? ((input, init) => fetch(input, init));
	const init: RequestInit = {
		method,
		headers: { accept: "application/json" },
	};
	if (body !== undefined) {
		(init.headers as Record<string, string>)["content-type"] =
			"application/json";
		init.body = JSON.stringify(body);
	}
	let response: Response;
	try {
		response = await fetchImpl(url, init);
	} catch (caught) {
		io.stderr(caught instanceof Error ? caught.message : "request failed");
		return 1;
	}
	const text = await response.text().catch(() => "");
	let data: unknown = null;
	try {
		data = text ? (JSON.parse(text) as unknown) : null;
	} catch {
		data = text;
	}
	if (!response.ok) {
		const message =
			(data as { error?: string } | null)?.error ??
			(typeof data === "string" && data
				? data
				: `request failed (${response.status})`);
		io.stderr(message);
		return 1;
	}
	if (wantsJson(extraArgs)) {
		io.stdout(JSON.stringify(data, null, 2));
		return 0;
	}
	io.stdout(summarize(path, method, data));
	return 0;
}

function summarize(path: string, method: string, data: unknown): string {
	const d = data as Record<string, unknown> | null;
	if (path === "/v1/run" && method === "POST") return "sketch started";
	if (path === "/v1/run/stop") return "sketch stopped";
	if (path === "/v1/run" && method === "GET") {
		const running = (d as { running?: boolean } | null)?.running;
		if (running) return `running\n${logTail(d)}`;
		const last = (d as { last?: { ok?: boolean } | null } | null)?.last;
		if (last) return `idle ok=${last.ok ? "true" : "false"}\n${logTail(d)}`;
		return "idle";
	}
	if (path === "/v1/run/sketches") {
		const sketches =
			(d as { sketches?: Array<{ name?: string }> } | null)?.sketches ?? [];
		if (!sketches.length) return "no sketches";
		return sketches
			.map((s) => s.name ?? "")
			.filter(Boolean)
			.join("\n");
	}
	if (path === "/v1/flash" && method === "POST") return "flash started";
	if (path === "/v1/flash/stop") return "flash stopped";
	if (path === "/v1/flash/proxy") return "proxy flash started";
	if (path === "/v1/flash" && method === "GET") {
		const running = (d as { running?: boolean } | null)?.running;
		if (running) return "running";
		const last = (d as { last?: { ok?: boolean; log?: string } | null } | null)
			?.last;
		if (last)
			return `idle ok=${last.ok ? "true" : "false"}\n${(last.log ?? "").slice(-2000)}`;
		return "idle";
	}
	if (path === "/v1/flash/ports") {
		const ports =
			(d as { ports?: Array<{ address?: string; fqbn?: string }> } | null)
				?.ports ?? [];
		if (!ports.length) return "no ports";
		return ports
			.map((p) => `${p.address ?? ""}${p.fqbn ? ` ${p.fqbn}` : ""}`.trim())
			.join("\n");
	}
	if (path === "/v1/flash/sketches") {
		const sketches =
			(d as { sketches?: Array<{ name?: string }> } | null)?.sketches ?? [];
		if (!sketches.length) return "no sketches";
		return sketches
			.map((s) => s.name ?? "")
			.filter(Boolean)
			.join("\n");
	}
	if (path === "/v1/arduino-proxy") {
		const s = d as {
			connected?: boolean;
			board?: string;
			fqbn?: string;
			port?: string;
		} | null;
		if (!s?.connected) return "disconnected";
		return `connected${s.board ? ` board=${s.board}` : ""}${s.fqbn ? ` fqbn=${s.fqbn}` : ""}${s.port ? ` port=${s.port}` : ""}`;
	}
	if (path === "/v1/gpio" && method === "GET") {
		return JSON.stringify(data);
	}
	if (path === "/v1/gpio" && method === "PUT") return "ok";
	if (path === "/v1/verify" && method === "POST") return "verify started";
	if (path === "/v1/verify/stop") return "verify stopped";
	if (path === "/v1/verify") {
		const running = (d as { running?: boolean } | null)?.running;
		return running ? "running" : "idle";
	}
	if (path === "/v1/console" && method === "GET") return JSON.stringify(data);
	if (path === "/v1/console/usb") return "usb console started";
	if (path === "/v1/console/usb/stop") return "usb console stopped";
	if (path === "/v1/ui" && method === "GET") {
		const sockets = (d as { sockets?: unknown[] } | null)?.sockets ?? [];
		if (!sockets.length) return "no apps open";
		return JSON.stringify(data);
	}
	if (path === "/v1/ui" && method === "POST") {
		const r = d as { delivered?: number; fallback?: boolean } | null;
		return `delivered=${r?.delivered ?? 0}${r?.fallback ? " fallback=true" : ""}`;
	}
	if (path.startsWith("/v1/ui/reply/")) {
		const action = (d as { action?: string } | null)?.action;
		return action ? `reply: ${action}` : JSON.stringify(data);
	}
	if (path === "/v1/app" && method === "GET") {
		const s = d as {
			running?: boolean;
			name?: string | null;
			port?: number | null;
			log?: string;
		} | null;
		if (s?.running) {
			return `running name=${s.name ?? ""} port=${s.port ?? ""}\n${logTail(d)}`;
		}
		return s?.name ? `idle last=${s.name}\n${logTail(d)}` : "idle";
	}
	if (path === "/v1/app/list") {
		const apps =
			(
				d as {
					apps?: Array<{ name?: string; project?: string; dir?: string }>;
				} | null
			)?.apps ?? [];
		if (!apps.length) return "no apps";
		return apps
			.map((a) => `${a.name ?? ""} (${a.project ?? ""}/app/${a.dir ?? ""})`)
			.join("\n");
	}
	if (path === "/v1/app/start") {
		const s = d as { name?: string; port?: number } | null;
		return `app started name=${s?.name ?? ""} port=${s?.port ?? ""}`;
	}
	if (path === "/v1/app/stop") return "app stopped";
	return JSON.stringify(data);
}

function logTail(d: unknown): string {
	const log = (d as { log?: string } | null)?.log ?? "";
	return log.slice(-2000);
}

export async function run(argv: string[], io: CliIo): Promise<number> {
	const [group, ...rest] = argv;
	if (!group || group === "help" || group === "--help" || group === "-h") {
		io.stdout(helpText());
		return 0;
	}
	const jsonArgs = argv;
	if (
		rest.length === 1 &&
		(rest[0] === "help" || rest[0] === "--help" || rest[0] === "-h")
	) {
		io.stdout(helpText());
		return 0;
	}
	switch (group) {
		case "sketch":
		case "run": {
			if (group === "run" && (rest.length === 0 || rest[0]?.startsWith("--"))) {
				return sketchRun(stripGlobal(rest), io, jsonArgs);
			}
			const [sub, ...subRest] = group === "run" ? rest : rest;
			const subArgs = stripGlobal(subRest);
			if (group === "run" && !sub) {
				return sketchRun(subArgs, io, jsonArgs);
			}
			if (sub === "run") return sketchRun(subArgs, io, jsonArgs);
			if (sub === "status" || sub === "get")
				return call(io, "GET", "/v1/run", undefined, jsonArgs);
			if (sub === "stop") return call(io, "POST", "/v1/run/stop", {}, jsonArgs);
			if (sub === "list" || sub === "sketches")
				return call(io, "GET", "/v1/run/sketches", undefined, jsonArgs);
			io.stderr(`unknown sketch command: ${sub ?? ""}\n${helpText()}`);
			return 1;
		}
		case "flash": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (sub === "start") {
				const fqbn = flag(subArgs, "--fqbn");
				const dir = flag(subArgs, "--path", "--dir");
				const port = flag(subArgs, "--port");
				if (!fqbn || !dir) {
					io.stderr(
						"usage: gpio-companion flash start --fqbn <fqbn> --path <dir> [--port <port>]",
					);
					return 1;
				}
				return call(
					io,
					"POST",
					"/v1/flash",
					{
						fqbn,
						dir: absolutize(io.cwd, dir),
						...(port ? { port } : {}),
					},
					jsonArgs,
				);
			}
			if (sub === "status")
				return call(io, "GET", "/v1/flash", undefined, jsonArgs);
			if (sub === "stop")
				return call(io, "POST", "/v1/flash/stop", {}, jsonArgs);
			if (sub === "ports")
				return call(io, "GET", "/v1/flash/ports", undefined, jsonArgs);
			if (sub === "list" || sub === "sketches")
				return call(io, "GET", "/v1/flash/sketches", undefined, jsonArgs);
			if (sub === "proxy") {
				const fqbn = flag(subArgs, "--fqbn");
				const port = flag(subArgs, "--port");
				return call(
					io,
					"POST",
					"/v1/flash/proxy",
					{
						...(fqbn ? { fqbn } : {}),
						...(port ? { port } : {}),
					},
					jsonArgs,
				);
			}
			io.stderr(`unknown flash command: ${sub ?? ""}\n${helpText()}`);
			return 1;
		}
		case "gpio": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (sub === "get" || sub === "status" || sub === undefined) {
				return call(io, "GET", "/v1/gpio", undefined, jsonArgs);
			}
			if (sub === "set") {
				const physical = Number(flag(subArgs, "--physical", "--pin"));
				const dir = flag(subArgs, "--dir", "--direction") ?? "out";
				const valueRaw = flag(subArgs, "--value");
				const analogRaw = flag(subArgs, "--analog");
				const target = flag(subArgs, "--target");
				if (!Number.isInteger(physical)) {
					io.stderr(
						"usage: gpio-companion gpio set --physical <1-40> --dir in|out|pwm [--value 0|1] [--analog 0-255]",
					);
					return 1;
				}
				const body: Record<string, unknown> = { physical, dir };
				if (valueRaw !== undefined) body.value = Number(valueRaw);
				if (analogRaw !== undefined) body.analog = Number(analogRaw);
				if (target) body.target = target;
				return call(io, "PUT", "/v1/gpio", body, jsonArgs);
			}
			if (sub === "tone") {
				const physical = Number(flag(subArgs, "--physical", "--pin"));
				const hz = Number(flag(subArgs, "--hz", "--freq"));
				const target = flag(subArgs, "--target");
				if (!Number.isInteger(physical) || !Number.isInteger(hz)) {
					io.stderr(
						"usage: gpio-companion gpio tone --physical <1-40> --hz <31-65535>",
					);
					return 1;
				}
				return call(
					io,
					"PUT",
					"/v1/gpio",
					{
						physical,
						op: "tone",
						hz,
						...(target ? { target } : {}),
					},
					jsonArgs,
				);
			}
			if (sub === "notone") {
				const physical = Number(flag(subArgs, "--physical", "--pin"));
				const target = flag(subArgs, "--target");
				if (!Number.isInteger(physical)) {
					io.stderr("usage: gpio-companion gpio notone --physical <1-40>");
					return 1;
				}
				return call(
					io,
					"PUT",
					"/v1/gpio",
					{
						physical,
						op: "notone",
						...(target ? { target } : {}),
					},
					jsonArgs,
				);
			}
			io.stderr(`unknown gpio command: ${sub ?? ""}\n${helpText()}`);
			return 1;
		}
		case "proxy": {
			const [sub] = rest;
			if (!sub || sub === "status" || sub === "get") {
				return call(io, "GET", "/v1/arduino-proxy", undefined, jsonArgs);
			}
			io.stderr(`unknown proxy command: ${sub}\n${helpText()}`);
			return 1;
		}
		case "verify": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (sub === "start") {
				const repo = flag(subArgs, "--repo", "--name");
				if (!repo) {
					io.stderr("usage: gpio-companion verify start --repo <name>");
					return 1;
				}
				return call(io, "POST", "/v1/verify", { repo }, jsonArgs);
			}
			if (sub === "status")
				return call(io, "GET", "/v1/verify", undefined, jsonArgs);
			if (sub === "stop")
				return call(io, "POST", "/v1/verify/stop", {}, jsonArgs);
			io.stderr(`unknown verify command: ${sub ?? ""}\n${helpText()}`);
			return 1;
		}
		case "console": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (!sub || sub === "status")
				return call(io, "GET", "/v1/console", undefined, jsonArgs);
			if (sub === "usb-start") {
				const port = flag(subArgs, "--port");
				const baudRaw = flag(subArgs, "--baud");
				if (!port) {
					io.stderr(
						"usage: gpio-companion console usb-start --port <port> [--baud <baud>]",
					);
					return 1;
				}
				return call(
					io,
					"POST",
					"/v1/console/usb",
					{
						port,
						...(baudRaw ? { baud: Number(baudRaw) } : {}),
					},
					jsonArgs,
				);
			}
			if (sub === "usb-stop")
				return call(io, "POST", "/v1/console/usb/stop", {}, jsonArgs);
			io.stderr(`unknown console command: ${sub}\n${helpText()}`);
			return 1;
		}
		case "ui": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (!sub || sub === "list")
				return call(io, "GET", "/v1/ui", undefined, jsonArgs);
			if (sub === "toast") {
				const text =
					flag(subArgs, "--text") ??
					subRest.filter((a) => !a.startsWith("--")).join(" ");
				if (!text) {
					io.stderr("usage: gpio-companion ui toast --text <message>");
					return 1;
				}
				return call(io, "POST", "/v1/ui", { type: "toast", text }, jsonArgs);
			}
			if (sub === "navigate") {
				const target = flag(subArgs, "--target") ?? subRest[0];
				if (!target) {
					io.stderr(
						"usage: gpio-companion ui navigate --target <project|code|devices|...>",
					);
					return 1;
				}
				return call(
					io,
					"POST",
					"/v1/ui",
					{ type: "navigate", target },
					jsonArgs,
				);
			}
			if (sub === "dock") {
				const tab = flag(subArgs, "--tab") ?? subRest[0];
				if (!tab) {
					io.stderr(
						"usage: gpio-companion ui dock --tab <console|gpio|flash|problems>",
					);
					return 1;
				}
				return call(io, "POST", "/v1/ui", { type: "dock", tab }, jsonArgs);
			}
			if (sub === "palette") {
				const open = hasFlag(subArgs, "--open")
					? true
					: hasFlag(subArgs, "--close")
						? false
						: undefined;
				if (open === undefined) {
					io.stderr("usage: gpio-companion ui palette --open|--close");
					return 1;
				}
				return call(io, "POST", "/v1/ui", { type: "palette", open }, jsonArgs);
			}
			if (sub === "preview") {
				const repo = flag(subArgs, "--repo");
				const path = flag(subArgs, "--path");
				if (!repo || !path) {
					io.stderr(
						"usage: gpio-companion ui preview --repo <name> --path <host/blink/main.c>",
					);
					return 1;
				}
				return call(
					io,
					"POST",
					"/v1/ui",
					{ type: "preview", repo, path },
					jsonArgs,
				);
			}
			if (sub === "modal") {
				const id = flag(subArgs, "--id");
				const title = flag(subArgs, "--title");
				const body = flag(subArgs, "--body");
				const buttons = repeatFlag(subArgs, "--button");
				if (!id || !title || !body || !buttons.length) {
					io.stderr(
						"usage: gpio-companion ui modal --id <id> --title <t> --body <b> --button <label> [--button <label>]",
					);
					return 1;
				}
				return call(
					io,
					"POST",
					"/v1/ui",
					{ type: "modal", id, title, body, buttons },
					jsonArgs,
				);
			}
			if (sub === "reply") {
				const id = flag(subArgs, "--id") ?? subRest[0];
				if (!id) {
					io.stderr("usage: gpio-companion ui reply --id <modal-id>");
					return 1;
				}
				return call(
					io,
					"GET",
					`/v1/ui/reply/${encodeURIComponent(id)}`,
					undefined,
					jsonArgs,
				);
			}
			if (sub === "app") {
				const appId = flag(subArgs, "--id", "--name");
				if (!appId) {
					io.stderr(
						"usage: gpio-companion ui app --id <name> [--view split|modal|page] [--title <t>]",
					);
					return 1;
				}
				const view = flag(subArgs, "--view");
				const title = flag(subArgs, "--title");
				return call(
					io,
					"POST",
					"/v1/ui",
					{
						type: "app",
						appId,
						...(view ? { view } : {}),
						...(title ? { title } : {}),
					},
					jsonArgs,
				);
			}
			io.stderr(`unknown ui command: ${sub}\n${helpText()}`);
			return 1;
		}
		case "app": {
			const [sub, ...subRest] = rest;
			const subArgs = stripGlobal(subRest);
			if (!sub || sub === "status")
				return call(io, "GET", "/v1/app", undefined, jsonArgs);
			if (sub === "list")
				return call(io, "GET", "/v1/app/list", undefined, jsonArgs);
			if (sub === "start") {
				const repo = flag(subArgs, "--repo");
				const dir = flag(subArgs, "--dir", "--name");
				if (!repo || !dir) {
					io.stderr(
						"usage: gpio-companion app start --repo <repo> --dir <app-folder>",
					);
					return 1;
				}
				return call(io, "POST", "/v1/app/start", { repo, dir }, jsonArgs);
			}
			if (sub === "stop") return call(io, "POST", "/v1/app/stop", {}, jsonArgs);
			io.stderr(`unknown app command: ${sub ?? ""}\n${helpText()}`);
			return 1;
		}
		case "status":
			return call(io, "GET", "/v1/status", undefined, jsonArgs);
		case "health":
			return call(io, "GET", "/health", undefined, jsonArgs);
		default:
			io.stderr(`unknown command: ${group}\n${helpText()}`);
			return 1;
	}
}

async function sketchRun(
	args: string[],
	io: CliIo,
	jsonArgs: string[],
): Promise<number> {
	const dir = flag(args, "--path", "--dir");
	if (!dir) {
		io.stderr("usage: gpio-companion sketch run --path <sketch-dir>");
		return 1;
	}
	return call(
		io,
		"POST",
		"/v1/run",
		{ dir: absolutize(io.cwd, dir) },
		jsonArgs,
	);
}

function helpText(): string {
	return [
		"gpio-companion serve | version | sketch | flash | gpio | proxy | verify | console | ui | app | status | health",
		"  sketch run --path <sketch-dir>",
		"  sketch status [--json]",
		"  sketch stop",
		"  sketch list",
		"  flash start --fqbn <fqbn> --path <dir> [--port <port>]",
		"  flash status | flash stop | flash ports | flash list",
		"  flash proxy [--fqbn <fqbn>] [--port <port>]",
		"  gpio get",
		"  gpio set --physical <1-40> --dir in|out|pwm [--value 0|1] [--analog 0-255]",
		"  gpio tone --physical <n> --hz <hz>",
		"  gpio notone --physical <n>",
		"  proxy status",
		"  verify start --repo <name> | verify status | verify stop",
		"  console status | console usb-start --port <p> [--baud <b>] | console usb-stop",
		"  ui list | ui toast --text <m> | ui navigate --target <t> | ui dock --tab <t>",
		"  ui palette --open|--close | ui preview --repo <n> --path <p>",
		"  ui modal --id <id> --title <t> --body <b> --button <l> [--button <l>]",
		"  ui reply --id <modal-id>",
		"  ui app --id <name> [--view split|modal|page] [--title <t>]",
		"  app start --repo <repo> --dir <app-folder>",
		"  app status | app list | app stop",
		"  status | health",
		"Local loopback only (default http://127.0.0.1:4150, or GPIO_COMPANION_URL).",
	].join("\n");
}
