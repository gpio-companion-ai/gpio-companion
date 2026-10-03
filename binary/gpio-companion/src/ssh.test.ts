import { describe, expect, test } from "bun:test";
import type { SshClientLike, SshController, SshSocket, SshStreamLike } from "./ssh.ts";
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
			callback: (error: Error | undefined, stream: SshStreamLike | null) => void,
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

function openSession(): {
	controller: SshController;
	ws: TestSocket;
	mock: MockClient;
} {
	const ws = testSocket();
	const mock = mockClient();
	const controller = createSshController({ createClient: () => mock.client });
	controller.handle(ws, JSON.stringify({ op: "open" }));
	return { controller, ws, mock };
}

function authSession(): {
	controller: SshController;
	ws: TestSocket;
	mock: MockClient;
} {
	const { controller, ws, mock } = openSession();
	promptAuth(controller, ws, mock);
	return { controller, ws, mock };
}

function promptAuth(
	controller: SshController,
	ws: TestSocket,
	mock: MockClient,
	finish: (answers: string[]) => void = () => undefined,
) {
	mock.emit(
		"keyboard-interactive",
		"ssh",
		"",
		"en-US",
		[{ prompt: "password:", echo: false }],
		finish,
	);
}

describe("ssh controller", () => {
	test("collects the password with masking and opens the shell", () => {
		const { controller, ws, mock } = authSession();
		const finishCalls: string[][] = [];
		promptAuth(controller, ws, mock, (answers) => {
			finishCalls.push(answers);
		});
		controller.handle(ws, JSON.stringify({ op: "input", data: "secret" }));
		const echoed = ws.frames
			.map((item) => JSON.parse(item) as { chunk?: string })
			.filter((item) => typeof item.chunk === "string")
			.map((item) => item.chunk)
			.join("");
		expect(echoed).toContain("password:");
		expect(echoed).toContain("******");
		expect(echoed).not.toContain("secret");
		controller.handle(ws, JSON.stringify({ op: "input", data: "\r" }));
		expect(finishCalls).toEqual([["secret"]]);
		expect(mock.config()).toMatchObject({
			host: "127.0.0.1",
			port: 22,
			tryKeyboard: true,
		});
		mock.emit("ready");
		const shellCall = mock.shellCalls[0];
		if (!shellCall) {
			throw new Error("shell was not requested");
		}
		const stream = mockStream();
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
		controller.handle(ws, JSON.stringify({ op: "resize", cols: 100, rows: 30 }));
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

	test("rejects a second open while a session is active", () => {
		const { controller, ws, mock } = openSession();
		const second = testSocket();
		controller.handle(second, JSON.stringify({ op: "open" }));
		expect(frame(second)).toEqual({ error: "ssh session is already open" });
		expect(mock.shellCalls).toHaveLength(0);
		expect(ws.frames[0]).toBe(JSON.stringify({ status: "auth" }));
	});

	test("reports client errors and ends the session", () => {
		const { controller, ws, mock } = authSession();
		mock.emit("error", new Error("All authentication methods failed"));
		expect(frame(ws)).toEqual({ status: "closed" });
		expect(ws.frames.at(-2)).toBe(
			JSON.stringify({ error: "All authentication methods failed" }),
		);
		controller.handle(ws, JSON.stringify({ op: "input", data: "ls" }));
		expect(frame(ws)).toEqual({ error: "ssh session is not open" });
	});

	test("close command ends the session", () => {
		const { controller, ws, mock } = authSession();
		controller.handle(ws, JSON.stringify({ op: "close" }));
		expect(frame(ws)).toEqual({ status: "closed" });
		expect(mock.ended()).toBe(true);
	});

	test("remove disconnects the owning socket", () => {
		const { controller, ws, mock } = authSession();
		controller.remove(ws);
		expect(mock.ended()).toBe(true);
	});

	test("echo prompts keep typed text visible", () => {
		const ws = testSocket();
		const mock = mockClient();
		const controller = createSshController({ createClient: () => mock.client });
		controller.handle(ws, JSON.stringify({ op: "open" }));
		mock.emit("keyboard-interactive", "ssh", "", "en-US", [{ prompt: "login:", echo: true }], () =>
			undefined,
		);
		controller.handle(ws, JSON.stringify({ op: "input", data: "pi\r" }));
		const echoed = ws.frames
			.map((item) => JSON.parse(item) as { chunk?: string })
			.filter((item) => typeof item.chunk === "string")
			.map((item) => item.chunk)
			.join("");
		expect(echoed).toContain("pi");
		expect(echoed).not.toContain("*");
	});

	test("shell open failure surfaces an error", () => {
		const { controller, ws, mock } = authSession();
		mock.emit("ready");
		const shellCall = mock.shellCalls[0];
		if (!shellCall) {
			throw new Error("shell was not requested");
		}
		shellCall.callback(new Error("channel failed"), null);
		expect(ws.frames.at(-2)).toBe(JSON.stringify({ error: "channel failed" }));
		expect(frame(ws)).toEqual({ status: "closed" });
	});

	test("rejects malformed commands", () => {
		const { controller, ws } = openSession();
		ws.frames.length = 0;
		controller.handle(ws, "not json");
		const parsed = JSON.parse(ws.frames[0] ?? "{}") as { error?: string };
		expect(typeof parsed.error).toBe("string");
	});
});
