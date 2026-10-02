import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	debugAuthQuery,
	generateDeviceKeyPair,
	isUiPath,
	signDeviceRequest,
	UI_MAX_SOCKETS,
	UI_PATH,
	UI_REPLY_POLL_MS,
	UiError,
} from "gpio-companion";
import { filePairingStore } from "./pairing.ts";
import { fileSecretsStore } from "./secrets.ts";
import { startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";
import { createUiHub, type UiHub, type UiSocket } from "./ui.ts";

type FakeSocket = {
	sent: string[];
	closed: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
};

function fakeSocket(): FakeSocket & UiSocket {
	const socket: FakeSocket = { sent: [], closed: 0 };
	return {
		get sent() {
			return socket.sent;
		},
		get closed() {
			return socket.closed;
		},
		send(data: string) {
			socket.sent.push(data);
		},
		close() {
			socket.closed += 1;
		},
	} as FakeSocket & UiSocket;
}

describe("ui hub", () => {
	test("delivers to focused sockets only", () => {
		const hub = createUiHub();
		const web = fakeSocket();
		const desktop = fakeSocket();
		hub.add(web);
		hub.add(desktop);
		hub.handle(
			web,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		hub.handle(
			desktop,
			JSON.stringify({ op: "hello", surface: "desktop", focused: false }),
		);
		const result = hub.command({ type: "toast", text: "hi" });
		expect(result).toEqual({ delivered: 1, fallback: false });
		expect(web.sent).toHaveLength(1);
		expect(desktop.sent).toHaveLength(0);
		expect(JSON.parse(web.sent[0])).toEqual({ type: "toast", text: "hi" });
	});

	test("falls back to every socket when none focused", () => {
		const hub = createUiHub();
		const a = fakeSocket();
		const b = fakeSocket();
		hub.add(a);
		hub.add(b);
		hub.handle(
			a,
			JSON.stringify({ op: "hello", surface: "web", focused: false }),
		);
		hub.handle(
			b,
			JSON.stringify({ op: "hello", surface: "mobile", focused: false }),
		);
		const result = hub.command({ type: "dock", tab: "console" });
		expect(result).toEqual({ delivered: 2, fallback: true });
	});

	test("delivered zero with no sockets", () => {
		const hub = createUiHub();
		expect(hub.command({ type: "toast", text: "hi" })).toEqual({
			delivered: 0,
			fallback: false,
		});
	});

	test("caps sockets and lists helloed clients", () => {
		const hub = createUiHub();
		for (let index = 0; index < UI_MAX_SOCKETS - 1; index += 1) {
			hub.add(fakeSocket());
		}
		const lister = fakeSocket();
		hub.add(lister);
		hub.handle(
			lister,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		const extra = fakeSocket();
		hub.add(extra);
		expect(extra.closed).toBe(1);
		expect(hub.list()).toEqual([
			{
				id: "ui-8",
				surface: "web",
				focused: true,
				connectedAt: expect.any(Number),
			},
		]);
	});

	test("rejects unknown commands", () => {
		const hub = createUiHub();
		expect(() => hub.command({ type: "flash" })).toThrow(UiError);
		expect(() => hub.command({ type: "toast", text: "" })).toThrow(UiError);
		expect(() =>
			hub.command({ type: "preview", repo: "blink-led", path: "../x" }),
		).toThrow(UiError);
	});

	test("delivers preview to focused sockets", () => {
		const hub = createUiHub();
		const web = fakeSocket();
		hub.add(web);
		hub.handle(
			web,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		const result = hub.command({
			type: "preview",
			repo: "blink-led",
			path: "host/blink/main.c",
		});
		expect(result).toEqual({ delivered: 1, fallback: false });
		expect(JSON.parse(web.sent[0])).toEqual({
			type: "preview",
			repo: "blink-led",
			path: "host/blink/main.c",
		});
	});

	test("hello re-focus updates delivery", () => {
		const hub = createUiHub();
		const ws = fakeSocket();
		hub.add(ws);
		hub.handle(
			ws,
			JSON.stringify({ op: "hello", surface: "web", focused: false }),
		);
		hub.handle(
			ws,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		expect(hub.command({ type: "toast", text: "x" })).toEqual({
			delivered: 1,
			fallback: false,
		});
	});

	test("modal reply flow and retention", async () => {
		const hub = createUiHub();
		const ws = fakeSocket();
		hub.add(ws);
		hub.handle(
			ws,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		const waiting = hub.waitReply("m1", UI_REPLY_POLL_MS);
		hub.handle(ws, JSON.stringify({ op: "reply", id: "m1", action: "Yes" }));
		expect(await waiting).toEqual({ action: "Yes", at: expect.any(Number) });
		expect(hub.peekReply("m1")?.action).toBe("Yes");
	});

	test("unknown socket message errors back", () => {
		const hub = createUiHub();
		const ws = fakeSocket();
		hub.add(ws);
		hub.handle(ws, JSON.stringify({ op: "refresh" }));
		expect(JSON.parse(ws.sent[0])).toEqual({ error: "unknown ui message" });
	});

	test("wait times out with no reply", async () => {
		const hub = createUiHub();
		expect(await hub.waitReply("m2", 10)).toBeNull();
	});
});

const dir = await mkdtemp(join(tmpdir(), "ui-api-"));
const keys = await generateDeviceKeyPair();
const uiHub = createUiHub();

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(dir, "config.json"), "raspberrypi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
	applyTunnel: async () => undefined,
	deviceAuth: { keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
	ui: uiHub,
	uiReplyPollMs: 50,
});

afterAll(() => {
	server.stop();
});

async function signedUiWsQuery(): Promise<string> {
	const headers = await signDeviceRequest({
		privateKeyPem: keys.privateKeyPem,
		keyId: keys.keyId,
		method: "GET",
		path: UI_PATH,
	});
	return debugAuthQuery(headers);
}

describe("ui http", () => {
	test("loopback unsigned listing", async () => {
		const response = await fetch(`${server.url}v1/ui`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ sockets: [] });
	});

	test("agent posts a command with no app open", async () => {
		const response = await fetch(`${server.url}v1/ui`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "toast", text: "hello" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ delivered: 0, fallback: false });
	});

	test("bad command is 400", async () => {
		const response = await fetch(`${server.url}v1/ui`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "curl" }),
		});
		expect(response.status).toBe(400);
	});

	test("reply route 404s after the poll window", async () => {
		const response = await fetch(`${server.url}v1/ui/reply/nope`);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "no reply" });
	});

	test("reply route returns a kept click", async () => {
		const ws = fakeSocket();
		uiHub.add(ws);
		uiHub.handle(
			ws,
			JSON.stringify({ op: "hello", surface: "web", focused: true }),
		);
		uiHub.handle(
			ws,
			JSON.stringify({ op: "reply", id: "kept", action: "Yes" }),
		);
		const response = await fetch(`${server.url}v1/ui/reply/kept`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ action: "Yes" });
		uiHub.remove(ws);
	});
});

describe("ui websocket auth", () => {
	test("unsigned upgrade is refused", async () => {
		const response = await fetch(`${server.url}v1/ui`, {
			headers: { upgrade: "websocket", connection: "upgrade" },
		});
		expect(response.status).toBe(401);
	});

	test("signed upgrade from an allowed origin is accepted", async () => {
		const query = await signedUiWsQuery();
		const ws = new WebSocket(
			`${String(server.url).replace(/^http/, "ws")}v1/ui?${query}`,
		);
		await new Promise<void>((resolve, reject) => {
			ws.addEventListener("open", () => resolve());
			ws.addEventListener("error", () => reject(new Error("ws error")));
		});
		ws.send(JSON.stringify({ op: "hello", surface: "web", focused: true }));
		ws.close();
	});

	test("path helper rejects lookalikes", () => {
		expect(isUiPath("/v1/ui/reply/x")).toBe(true);
		expect(isUiPath("/v1/uiX")).toBe(false);
	});
});
