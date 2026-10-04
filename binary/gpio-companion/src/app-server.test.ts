import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AppError,
	generateDeviceKeyPair,
	parseAppFramePath,
	signDeviceRequest,
} from "gpio-companion";
import {
	type AppController,
	type AppProcess,
	appUpstreamWsUrl,
	createAppController,
	type FetchLike,
	listBoardApps,
} from "./app-server.ts";
import { filePairingStore } from "./pairing.ts";
import { fileSecretsStore } from "./secrets.ts";
import { startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const ROOT = join(tmpdir(), "gpio-companion-app-test");
const REPO = join(ROOT, "demo-repo");

mkdirSync(join(REPO, "app", "panel"), { recursive: true });
writeFileSync(
	join(REPO, "app", "panel", "package.json"),
	JSON.stringify({ name: "led-panel" }),
);
writeFileSync(join(REPO, "app", "panel", "server.ts"), "export {};\n");

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
});

function fakeProc(): AppProcess {
	let resolveExit: (code: number) => void;
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	return {
		exited,
		kill() {
			resolveExit(0);
		},
		stdout: new Blob(["listening\n"]).stream() as ReadableStream<Uint8Array>,
		stderr: new Blob([]).stream() as ReadableStream<Uint8Array>,
	};
}

function refuser(): FetchLike {
	return async () => {
		throw new TypeError("fetch failed");
	};
}

function harness(options?: {
	prober?: (port: number) => Promise<boolean>;
	fetchImpl?: FetchLike;
}) {
	return createAppController({
		projectsDir: ROOT,
		spawn: () => fakeProc(),
		portPicker: async () => 4600,
		prober:
			options?.prober ??
			(async () => {
				await Bun.sleep(1);
				return true;
			}),
		fetchImpl: options?.fetchImpl ?? refuser(),
	});
}

async function startedApp(): Promise<AppController> {
	const app = harness();
	await app.start({ repo: "demo-repo", dir: "panel" });
	return app;
}

describe("app controller start", () => {
	test("starts and reports status", async () => {
		const app = await startedApp();
		const status = app.status();
		expect(status.running).toBe(true);
		expect(status.name).toBe("led-panel");
		expect(status.repo).toBe("demo-repo");
		expect(status.port).toBeGreaterThanOrEqual(4600);
		expect(status.port).toBeLessThanOrEqual(4619);
		expect(status.log).toContain("listening");
		app.stop();
	});

	test("rejects a second app while one runs", async () => {
		const app = await startedApp();
		try {
			await app.start({ repo: "demo-repo", dir: "panel" });
			expect.unreachable();
		} catch (caught) {
			expect(caught).toBeInstanceOf(AppError);
			expect((caught as AppError).status).toBe(409);
			expect((caught as AppError).message).toContain("led-panel");
		}
		app.stop();
	});

	test("rejects unknown repo and entry", async () => {
		const app = harness();
		await expect(app.start({ repo: "missing", dir: "panel" })).rejects.toThrow(
			"repo was not found",
		);
		await expect(app.start({ repo: "demo-repo", dir: "nope" })).rejects.toThrow(
			"app was not found",
		);
	});

	test("fails when the app never listens", async () => {
		const controller = createAppController({
			projectsDir: ROOT,
			spawn: () => fakeProc(),
			prober: async () => false,
			readyTimeoutMs: 50,
			probeMs: 10,
			fetchImpl: refuser(),
		});
		await expect(
			controller.start({ repo: "demo-repo", dir: "panel" }),
		).rejects.toThrow("did not listen");
		expect(controller.status().running).toBe(false);
	});

	test("fails when every port is occupied", async () => {
		const busy: FetchLike = async () => new Response("busy");
		const app = createAppController({
			projectsDir: ROOT,
			spawn: () => fakeProc(),
			prober: async () => true,
			fetchImpl: busy,
		});
		await expect(
			app.start({ repo: "demo-repo", dir: "panel" }),
		).rejects.toThrow("no free app port");
	});
});

describe("app controller tokens and proxy", () => {
	test("mint rejects unknown app", async () => {
		const app = await startedApp();
		expect(() => app.mint("other-panel")).toThrow(AppError);
		app.stop();
	});

	test("mint then authorize proxies to loopback", async () => {
		const targets: Array<{ url: string; init: RequestInit }> = [];
		const app = createAppController({
			projectsDir: ROOT,
			spawn: () => fakeProc(),
			portPicker: async () => 4600,
			prober: async () => true,
			fetchImpl: async (input, init = {}) => {
				targets.push({ url: String(input), init });
				return new Response("<h1>hi</h1>", {
					status: 200,
					headers: {
						"content-type": "text/html",
						"set-cookie": "evil=1",
						"access-control-allow-origin": "*",
					},
				});
			},
		});
		await app.start({ repo: "demo-repo", dir: "panel" });
		const grant = app.mint("led-panel");
		expect(grant.name).toBe("led-panel");
		expect(grant.path).toStartWith(`/v1/app/led-panel/${grant.token}/`);
		expect(grant.expiresAt).toBeGreaterThan(Date.now());

		const frame = parseAppFramePath(
			`/v1/app/led-panel/${grant.token}/api/data`,
		);
		expect(frame).not.toBeNull();
		const response = await app.proxy(
			new Request("https://api-x.gpio-companion.com/v1/app/led-panel/x", {
				method: "GET",
				headers: { accept: "text/html" },
			}),
			frame as never,
			"?x=1",
		);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.url).toBe(`http://127.0.0.1:4600/api/data?x=1`);
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		await expect(response.text()).resolves.toBe("<h1>hi</h1>");
		app.stop();
	});

	test("preflight answers OPTIONS without forwarding", async () => {
		const targets: Array<{ url: string; init: RequestInit }> = [];
		const app = createAppController({
			projectsDir: ROOT,
			spawn: () => fakeProc(),
			portPicker: async () => 4600,
			prober: async () => true,
			fetchImpl: async (input, init = {}) => {
				targets.push({ url: String(input), init });
				return new Response("nope", { status: 500 });
			},
		});
		await app.start({ repo: "demo-repo", dir: "panel" });
		const grant = app.mint("led-panel");
		const frame = parseAppFramePath(
			`/v1/app/led-panel/${grant.token}/api/state`,
		);
		expect(frame).not.toBeNull();
		const response = await app.proxy(
			new Request("https://api-x.gpio-companion.com/v1/app/led-panel/x", {
				method: "OPTIONS",
				headers: {
					origin: "null",
					"access-control-request-method": "POST",
					"access-control-request-headers": "content-type",
				},
			}),
			frame as never,
			"",
		);
		expect(targets).toHaveLength(0);
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-allow-methods")).toContain(
			"POST",
		);
		expect(response.headers.get("access-control-allow-headers")).toBe(
			"content-type",
		);
		expect(response.headers.get("access-control-max-age")).toBe("600");
		app.stop();
	});

	test("authorize rejects bad tokens and stopped apps", async () => {
		const app = await startedApp();
		const grant = app.mint("led-panel");
		const bad = parseAppFramePath(`/v1/app/led-panel/${"b".repeat(43)}/`);
		expect(() => app.authorize(bad as never)).toThrow(
			"app frame token is invalid or expired",
		);
		app.stop();
		const good = parseAppFramePath(`/v1/app/led-panel/${grant.token}/`);
		expect(() => app.authorize(good as never)).toThrow("not running");
	});

	test("proxy maps upstream failure to 503", async () => {
		const app = createAppController({
			projectsDir: ROOT,
			spawn: () => fakeProc(),
			portPicker: async () => 4600,
			prober: async () => true,
			fetchImpl: refuser(),
		});
		await app.start({ repo: "demo-repo", dir: "panel" });
		const grant = app.mint("led-panel");
		const frame = parseAppFramePath(`/v1/app/led-panel/${grant.token}/`);
		const response = await app.proxy(
			new Request("https://x/v1/app/led-panel/y"),
			frame as never,
			"",
		);
		expect(response.status).toBe(503);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		app.stop();
	});
});

describe("app ws url", () => {
	test("appUpstreamWsUrl joins suffix and search", () => {
		expect(appUpstreamWsUrl(4600, "/sock", "?t=1")).toBe(
			"ws://127.0.0.1:4600/sock?t=1",
		);
		expect(appUpstreamWsUrl(4601, "sock")).toBe("ws://127.0.0.1:4601/sock");
	});
});

describe("listBoardApps", () => {
	test("lists apps with package.json across projects", () => {
		mkdirSync(join(ROOT, "other-repo", "app", "dash"), { recursive: true });
		writeFileSync(
			join(ROOT, "other-repo", "app", "dash", "package.json"),
			JSON.stringify({ name: "dash-ui", main: "src/main.ts" }),
		);
		mkdirSync(join(ROOT, "other-repo", "app", "dash", "src"));
		writeFileSync(
			join(ROOT, "other-repo", "app", "dash", "src", "main.ts"),
			"export {};\n",
		);
		mkdirSync(join(ROOT, "demo-repo", "app", "broken"));
		writeFileSync(
			join(ROOT, "demo-repo", "app", "broken", "package.json"),
			JSON.stringify({ name: "Not Kebab" }),
		);
		const apps = listBoardApps(ROOT);
		expect(apps).toContainEqual({
			project: "demo-repo",
			dir: "panel",
			name: "led-panel",
			entry: "server.ts",
		});
		expect(apps).toContainEqual({
			project: "other-repo",
			dir: "dash",
			name: "dash-ui",
			entry: "src/main.ts",
		});
		expect(apps.some((item) => item.dir === "broken")).toBe(false);
	});

	test("returns empty for a bad root", () => {
		expect(listBoardApps("relative")).toEqual([]);
		expect(listBoardApps("/nope/../..")).toEqual([]);
	});
});

const apiDir = join(tmpdir(), "gpio-companion-app-api");
mkdirSync(apiDir, { recursive: true });
const keys = await generateDeviceKeyPair();

const upstreamHits: Array<{ url: string }> = [];
const apiApp = createAppController({
	projectsDir: ROOT,
	spawn: () => fakeProc(),
	portPicker: async () => 4600,
	prober: async () => true,
	fetchImpl: (async (input: string | URL, _init?: RequestInit) => {
		upstreamHits.push({ url: String(input) });
		return new Response("<h1>panel</h1>", {
			status: 200,
			headers: {
				"content-type": "text/html",
				"set-cookie": "session=1",
			},
		});
	}) as FetchLike,
});

const echoServer = Bun.serve({
	port: 4600,
	hostname: "127.0.0.1",
	fetch(request, server) {
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			if (server.upgrade(request)) {
				return undefined as never;
			}
		}
		return new Response("echo-root");
	},
	websocket: {
		message(ws, message) {
			ws.send(typeof message === "string" ? `echo:${message}` : message);
		},
	},
});

const api = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(apiDir, "config.json"), "raspberrypi"),
	secrets: fileSecretsStore(join(apiDir, "secrets.env")),
	pairing: filePairingStore(
		join(apiDir, "pairing.json"),
		"pair-uuid",
		"pair-key",
	),
	applyTunnel: async () => undefined,
	deviceAuth: { keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
	app: apiApp,
	projectsDir: ROOT,
});

afterAll(() => {
	api.stop();
	echoServer.stop();
	rmSync(apiDir, { recursive: true, force: true });
});

describe("app http api", () => {
	test("loopback unsigned start, status, stop", async () => {
		const listed = await fetch(`${api.url}v1/app/list`);
		expect(listed.status).toBe(200);
		const listBody = (await listed.json()) as {
			apps: Array<{ project: string; dir: string; name: string }>;
		};
		expect(
			listBody.apps.some(
				(item) =>
					item.project === "demo-repo" &&
					item.dir === "panel" &&
					item.name === "led-panel",
			),
		).toBe(true);

		const start = await fetch(`${api.url}v1/app/start`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repo: "demo-repo", dir: "panel" }),
		});
		expect(start.status).toBe(200);
		const body = (await start.json()) as { started: boolean; port: number };
		expect(body.started).toBe(true);
		expect(body.port).toBe(4600);

		const status = await fetch(`${api.url}v1/app`);
		expect(status.status).toBe(200);
		const snap = (await status.json()) as { running: boolean; name: string };
		expect(snap.running).toBe(true);
		expect(snap.name).toBe("led-panel");

		const stop = await fetch(`${api.url}v1/app/stop`, { method: "POST" });
		expect(await stop.json()).toEqual({ stopped: true });
		const after = (await (await fetch(`${api.url}v1/app`)).json()) as {
			running: boolean;
		};
		expect(after.running).toBe(false);
	});

	test("loopback unsigned mint is refused", async () => {
		await apiApp.start({ repo: "demo-repo", dir: "panel" });
		const mint = await fetch(`${api.url}v1/app/led-panel/frame`, {
			method: "POST",
		});
		expect(mint.status).toBe(401);
		await expect(mint.json()).resolves.toMatchObject({
			error: expect.stringContaining("signature"),
		});
	});

	test("signed mint returns a grant and the frame proxies", async () => {
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "POST",
			path: "/v1/app/led-panel/frame",
			body: "",
		});
		const mint = await fetch(`${api.url}v1/app/led-panel/frame`, {
			method: "POST",
			headers: auth,
		});
		expect(mint.status).toBe(200);
		const grant = (await mint.json()) as {
			name: string;
			token: string;
			path: string;
			expiresAt: number;
		};
		expect(grant.name).toBe("led-panel");
		expect(grant.path).toStartWith("/v1/app/led-panel/");

		upstreamHits.length = 0;
		const page = await fetch(`${api.url}v1/app/led-panel/${grant.token}/`);
		expect(page.status).toBe(200);
		expect(upstreamHits[0]?.url).toBe(`http://127.0.0.1:4600/`);
		expect(page.headers.get("set-cookie")).toBeNull();
		expect(page.headers.get("access-control-allow-origin")).toBe("*");
		expect(page.headers.get("referrer-policy")).toBe("no-referrer");
		await expect(page.text()).resolves.toBe("<h1>panel</h1>");

		const sub = await fetch(
			`${api.url}v1/app/led-panel/${grant.token}/api/data?x=1`,
		);
		expect(sub.status).toBe(200);
		expect(upstreamHits[1]?.url).toBe("http://127.0.0.1:4600/api/data?x=1");
	});

	test("frame with a bad token or foreign origin is refused", async () => {
		const bad = await fetch(`${api.url}v1/app/led-panel/${"b".repeat(43)}/`);
		expect(bad.status).toBe(403);
		const grant = apiApp.mint("led-panel");
		const foreign = await fetch(`${api.url}v1/app/led-panel/${grant.token}/`, {
			headers: { origin: "https://evil.example" },
		});
		expect(foreign.status).toBe(401);
	});

	test("signed mint for a stopped app is 404", async () => {
		apiApp.stop();
		const auth = await signDeviceRequest({
			privateKeyPem: keys.privateKeyPem,
			keyId: keys.keyId,
			method: "POST",
			path: "/v1/app/other/frame",
			body: "",
		});
		const mint = await fetch(`${api.url}v1/app/other/frame`, {
			method: "POST",
			headers: auth,
		});
		expect(mint.status).toBe(404);
	});
});

describe("app ws bridge", () => {
	test("bridges browser ws to the app upstream", async () => {
		await apiApp.start({ repo: "demo-repo", dir: "panel" });
		const grant = apiApp.mint("led-panel");
		const wsUrl = `${String(api.url).replace("http://", "ws://")}v1/app/led-panel/${grant.token}/sock`;
		const socket = new WebSocket(wsUrl);
		const opened = new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve());
			socket.addEventListener("error", () => reject(new Error("ws failed")));
		});
		await Promise.race([
			opened,
			Bun.sleep(2_000).then(() => {
				throw new Error("ws open timed out");
			}),
		]);
		const reply = new Promise<string>((resolve) => {
			socket.addEventListener("message", (event) =>
				resolve(String(event.data)),
			);
		});
		socket.send("ping");
		await expect(
			Promise.race([reply, Bun.sleep(2_000).then(() => "timeout")]),
		).resolves.toBe("echo:ping");
		socket.close();
	});
});

describe("app frame CORS regression guards", () => {
	test("authorized frame GET carries allow-origin", async () => {
		const grant = apiApp.mint("led-panel");
		const page = await fetch(
			`${api.url}v1/app/led-panel/${grant.token}/api/state`,
			{ headers: { origin: "null" } },
		);
		expect(page.status).toBe(200);
		expect(page.headers.get("access-control-allow-origin")).toBe("*");
		expect(page.headers.get("referrer-policy")).toBe("no-referrer");
		expect(page.headers.get("set-cookie")).toBeNull();
		await expect(page.text()).resolves.toBe("<h1>panel</h1>");
	});

	test("frame OPTIONS preflight carries full CORS headers", async () => {
		const grant = apiApp.mint("led-panel");
		const pre = await fetch(
			`${api.url}v1/app/led-panel/${grant.token}/api/state`,
			{
				method: "OPTIONS",
				headers: {
					origin: "null",
					"access-control-request-method": "POST",
					"access-control-request-headers": "content-type, x-custom",
				},
			},
		);
		expect(pre.status).toBe(204);
		expect(pre.headers.get("access-control-allow-origin")).toBe("*");
		expect(pre.headers.get("access-control-allow-methods")).toBe(
			"GET, POST, PUT, PATCH, DELETE, OPTIONS",
		);
		expect(pre.headers.get("access-control-allow-headers")).toBe(
			"content-type, x-custom",
		);
		expect(pre.headers.get("access-control-max-age")).toBe("600");
	});

	test("dead token error stays readable through CORS", async () => {
		const dead = await fetch(
			`${api.url}v1/app/led-panel/${"b".repeat(43)}/api/state`,
			{ headers: { origin: "null" } },
		);
		expect(dead.status).toBe(403);
		expect(dead.headers.get("access-control-allow-origin")).toBe("*");
		await expect(dead.json()).resolves.toMatchObject({
			error: expect.stringContaining("token"),
		});
	});

	test("foreign origin error carries allow-origin", async () => {
		const grant = apiApp.mint("led-panel");
		const foreign = await fetch(
			`${api.url}v1/app/led-panel/${grant.token}/api/state`,
			{ headers: { origin: "https://evil.example" } },
		);
		expect(foreign.status).toBe(401);
		expect(foreign.headers.get("access-control-allow-origin")).toBe("*");
	});

	test("device api OPTIONS outside frames stays a bare 204", async () => {
		const bare = await fetch(`${api.url}v1/app`, { method: "OPTIONS" });
		expect(bare.status).toBe(204);
		expect(bare.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("stopped app frame error carries allow-origin", async () => {
		const grant = apiApp.mint("led-panel");
		await fetch(`${api.url}v1/app/stop`, { method: "POST" });
		const gone = await fetch(
			`${api.url}v1/app/led-panel/${grant.token}/api/state`,
			{ headers: { origin: "null" } },
		);
		expect(gone.status).toBe(404);
		expect(gone.headers.get("access-control-allow-origin")).toBe("*");
		await expect(gone.json()).resolves.toMatchObject({
			error: expect.stringContaining("not running"),
		});
	});
});
