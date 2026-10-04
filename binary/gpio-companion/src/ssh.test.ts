import { describe, expect, test } from "bun:test";
import type {
	SshClientLike,
	SshController,
	SshSocket,
	SshStreamLike,
} from "./ssh.ts";
import { createSshController } from "./ssh.ts";

type Handler = (...args: unknown[]) => void;

type MockClient = {
	client: SshClientLike;
	emit(event: string, ...args: unknown[]): void;
	config: () => Record<string, unknown> | null;
	ended: () => boolean;
	shellCalls: Array<{
		options: { cols: number; rows: number; term: string };
		callback: (error: Error | undefined, stream: SshStreamLike | null) => void;
	}>;
};

function mockClient(): MockClient {
	const handlers = new Map<string, Handler>();
	let config: Record<string, unknown> | null = null;
	let ended = false;
	const shellCalls: MockClient["shellCalls"] = [];
	const client = {
		connect(next: Record<string, unknown>) {
			config = next;
		},
		end() {
			ended = true;
		},
		shell(
			options: { cols: number; rows: number; term: string },
			callback: (
				error: Error | undefined,
				stream: SshStreamLike | null,
			) => void,
		) {
			shellCalls.push({ options, callback });
		},
		on(event: string, listener: Handler) {
			handlers.set(event, listener);
			return client;
		},
	};
	return {
		client: client as unknown as SshClientLike,
		emit(event: string, ...args: unknown[]) {
			handlers.get(event)?.(...args);
		},
		config: () => config,
		ended: () => ended,
		shellCalls,
	};
}

function mockStream() {
	const handlers = new Map<string, Handler>();
	const writes: string[] = [];
	const windows: Array<[number, number]> = [];
	let ended = false;
	const stream = {
		write(data: string) {
			writes.push(data);
		},
		end() {
			ended = true;
		},
		setWindow(rows: number, cols: number) {
			windows.push([rows, cols]);
		},
		on(event: string, listener: Handler) {
			handlers.set(event, listener);
			return stream;
		},
	};
	return {
		stream: stream as unknown as SshStreamLike,
		emit(event: string, ...args: unknown[]) {
			handlers.get(event)?.(...args);
		},
		writes,
		windows,
		ended: () => ended,
	};
}

function frame(ws: TestSocket): unknown {
	return JSON.parse(ws.frames.at(-1) ?? "");
}

type TestSocket = SshSocket & { frames: string[] };

function testSocket(): TestSocket {
	const frames: string[] = [];
	return {
		frames,
		send(data: string) {
			frames.push(data);
		},
		close() {
			undefined;
		},
	};
}

type Fixture = {
	controller: SshController;
	ws: TestSocket;
	mock: MockClient;
};

function buildController(
	mock: MockClient,
	loadKey: () => Promise<string | null> | string | null,
): SshController {
	return createSshController({
		createClient: () => mock.client,
		username: "companion",
		loadKey,
	});
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function keySession(): Promise<Fixture> {
	const ws = testSocket();
	const mock = mockClient();
	const controller = buildController(mock, () => "TEST-KEY");
	controller.handle(ws, JSON.stringify({ op: "open" }));
	await tick();
	return { controller, ws, mock };
}

async function passwordSession(password: string): Promise<Fixture> {
	const ws = testSocket();
	const mock = mockClient();
	const controller = buildController(mock, () => null);
	controller.handle(ws, JSON.stringify({ op: "open" }));
	await tick();
	controller.handle(ws, JSON.stringify({ op: "input", data: `${password}\r` }));
	await tick();
	return { controller, ws, mock };
}

async function readyKeySession(): Promise<Fixture> {
	const fixture = await keySession();
	fixture.mock.emit("ready");
	return fixture;
}

function promptText(ws: TestSocket): string {
	return ws.frames
		.map((item) => JSON.parse(item) as { chunk?: string })
		.filter((item) => typeof item.chunk === "string")
		.map((item) => item.chunk)
		.join("");
}

describe("ssh controller", () => {
	test("connects silently with the provisioned loopback key", async () => {
		const { ws, mock } = await keySession();
		expect(ws.frames[0]).toBe(JSON.stringify({ status: "auth" }));
		expect(mock.config()).toMatchObject({
			host: "127.0.0.1",
			port: 22,
			username: "companion",
			privateKey: "TEST-KEY",
			tryKeyboard: false,
		});
		expect(promptText(ws)).not.toContain("password:");
	});

	test("opens the shell after ready and pipes frames", async () => {
		const { controller, ws, mock } = await readyKeySession();
		const stream = mockStream();
		const shellCall = mock.shellCalls[0];
		if (!shellCall) {
			throw new Error("shell was not requested");
		}
		shellCall.callback(undefined, stream.stream);
		expect(shellCall.options).toEqual({
			cols: 80,
			rows: 24,
			term: "xterm-256color",
		});
		const statuses = ws.frames
			.map((item) => JSON.parse(item) as { status?: string })
			.filter((item) => item.status)
			.map((item) => item.status);
		expect(statuses).toEqual(["auth", "connected"]);
		controller.handle(
			ws,
			JSON.stringify({ op: "resize", cols: 100, rows: 30 }),
		);
		expect(stream.windows).toEqual([[30, 100]]);
		controller.handle(ws, JSON.stringify({ op: "input", data: "ls\n" }));
		expect(stream.writes).toEqual(["ls\n"]);
		stream.emit("data", Buffer.from("hello"));
		expect(frame(ws)).toEqual({ chunk: "hello" });
		stream.emit("close");
		expect(frame(ws)).toEqual({ status: "closed" });
		expect(stream.ended()).toBe(true);
		expect(mock.ended()).toBe(true);
	});

	test("falls back to the password prompt when key auth is refused", async () => {
		const { controller, ws, mock } = await keySession();
		mock.emit("error", new Error("All authentication methods failed"));
		expect(promptText(ws)).toContain("companion@127.0.0.1's password: ");
		controller.handle(ws, JSON.stringify({ op: "input", data: "secret\r" }));
		await tick();
		expect(mock.config()).toMatchObject({
			password: "secret",
			tryKeyboard: true,
		});
		expect(mock.config()?.privateKey).toBeUndefined();
	});

	test("prompts for the password when no key can be provisioned", async () => {
		const { ws, mock } = await passwordSession("secret");
		expect(promptText(ws)).toContain("companion@127.0.0.1's password: ");
		expect(promptText(ws)).toContain("******");
		expect(mock.config()).toMatchObject({
			password: "secret",
			tryKeyboard: true,
		});
	});

	test("rejects a second open while a session is active", async () => {
		const { controller, mock } = await keySession();
		const second = testSocket();
		controller.handle(second, JSON.stringify({ op: "open" }));
		expect(frame(second)).toEqual({ error: "ssh session is already open" });
		expect(mock.shellCalls).toHaveLength(0);
	});

	test("retries up to three times when password authentication fails", async () => {
		const ws = testSocket();
		const mock = mockClient();
		const controller = buildController(mock, () => null);
		controller.handle(ws, JSON.stringify({ op: "open" }));
		await tick();
		controller.handle(ws, JSON.stringify({ op: "input", data: "wrong\r" }));
		await tick();
		mock.emit("error", new Error("All authentication methods failed"));
		expect(promptText(ws)).toContain("Permission denied, try again.");
		controller.handle(ws, JSON.stringify({ op: "input", data: "wronger\r" }));
		await tick();
		mock.emit("error", new Error("All authentication methods failed"));
		expect(promptText(ws).match(/try again\./g)).toHaveLength(2);
		controller.handle(ws, JSON.stringify({ op: "input", data: "right\r" }));
		await tick();
		mock.emit("error", new Error("All authentication methods failed"));
		const last = ws.frames.at(-2) ?? "";
		expect(JSON.parse(last)).toEqual({
			error: "All authentication methods failed",
		});
		expect(frame(ws)).toEqual({ status: "closed" });
		const count = ws.frames.length;
		controller.handle(ws, JSON.stringify({ op: "input", data: "ls" }));
		expect(ws.frames).toHaveLength(count);
	});

	test("reports non-auth client errors and ends the session", async () => {
		const { ws, mock } = await passwordSession("secret");
		mock.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:22"));
		expect(ws.frames.at(-2)).toBe(
			JSON.stringify({ error: "connect ECONNREFUSED 127.0.0.1:22" }),
		);
		expect(frame(ws)).toEqual({ status: "closed" });
	});

	test("keyboard-interactive prompts still render with echo control", async () => {
		const { controller, ws, mock } = await passwordSession("");
		mock.emit(
			"keyboard-interactive",
			"ssh",
			"",
			"en-US",
			[{ prompt: "OTP:", echo: true }],
			() => undefined,
		);
		controller.handle(ws, JSON.stringify({ op: "input", data: "pi\r" }));
		const echoed = promptText(ws);
		expect(echoed).toContain("OTP:");
		expect(echoed).toContain("pi");
		expect(echoed).not.toContain("*");
	});

	test("shell open failure surfaces an error", async () => {
		const { ws, mock } = await readyKeySession();
		const shellCall = mock.shellCalls[0];
		if (!shellCall) {
			throw new Error("shell was not requested");
		}
		shellCall.callback(new Error("channel failed"), null);
		expect(ws.frames.at(-2)).toBe(JSON.stringify({ error: "channel failed" }));
		expect(frame(ws)).toEqual({ status: "closed" });
	});

	test("close command ends the session", async () => {
		const { controller, ws, mock } = await readyKeySession();
		controller.handle(ws, JSON.stringify({ op: "close" }));
		expect(frame(ws)).toEqual({ status: "closed" });
		expect(mock.ended()).toBe(true);
	});

	test("remove disconnects the owning socket", async () => {
		const { controller, ws, mock } = await readyKeySession();
		controller.remove(ws);
		expect(mock.ended()).toBe(true);
	});

	test("stray input from another socket is ignored silently", async () => {
		const { controller, ws, mock } = await readyKeySession();
		const stream = mockStream();
		const shellCall = mock.shellCalls[0];
		if (!shellCall) {
			throw new Error("shell was not requested");
		}
		shellCall.callback(undefined, stream.stream);
		const stranger = testSocket();
		controller.handle(stranger, JSON.stringify({ op: "input", data: "nope" }));
		controller.handle(
			stranger,
			JSON.stringify({ op: "resize", cols: 80, rows: 24 }),
		);
		expect(stranger.frames).toEqual([]);
		controller.handle(ws, JSON.stringify({ op: "input", data: "ls\n" }));
		expect(stream.writes).toEqual(["ls\n"]);
		expect(mock.ended()).toBe(false);
	});

	test("rejects malformed commands", async () => {
		const { controller, ws } = await keySession();
		ws.frames.length = 0;
		controller.handle(ws, "not json");
		const parsed = JSON.parse(ws.frames[0] ?? "{}") as { error?: string };
		expect(typeof parsed.error).toBe("string");
	});
});
