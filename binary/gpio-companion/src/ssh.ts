import {
	parseSshWsCommand,
	SSH_DEFAULT_COLS,
	SSH_DEFAULT_ROWS,
} from "gpio-companion";
import { Client } from "ssh2";

export type SshSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
};

export type SshStreamLike = {
	write(data: string): void;
	end(): void;
	setWindow(rows: number, cols: number, height: number, width: number): void;
	on(event: "data", listener: (chunk: Buffer) => void): unknown;
	on(event: "close", listener: () => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
};

export type SshPrompt = { prompt: string; echo: boolean };

export type SshClientLike = {
	connect(config: {
		host: string;
		port: number;
		username: string;
		tryKeyboard: boolean;
		readyTimeout: number;
	}): void;
	end(): void;
	shell(
		options: { cols: number; rows: number; term: string },
		callback: (error: Error | undefined, stream: SshStreamLike | null) => void,
	): void;
	on(
		event: "keyboard-interactive",
		listener: (
			name: string,
			instructions: string,
			language: string,
			prompts: SshPrompt[],
			finish: (answers: string[]) => void,
		) => void,
	): unknown;
	on(event: "ready", listener: () => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
};

export type SshController = {
	handle(ws: SshSocket, data: string): void;
	remove(ws: SshSocket): void;
};

export function createSshController(options?: {
	createClient?: () => SshClientLike;
	host?: string;
	port?: number;
	username?: string;
}): SshController {
	const createClient = options?.createClient ?? defaultClient;
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? 22;
	const username = options?.username ?? runtimeUsername();
	let socket: SshSocket | null = null;
	let client: SshClientLike | null = null;
	let stream: SshStreamLike | null = null;
	let decoder: TextDecoder | null = null;
	let collecting: {
		echo: boolean;
		finish: (answers: string[]) => void;
	} | null = null;
	let answer = "";

	function send(ws: SshSocket, payload: unknown) {
		try {
			ws.send(JSON.stringify(payload));
		} catch {
			undefined;
		}
	}

	function endSession() {
		collecting = null;
		answer = "";
		const activeStream = stream;
		stream = null;
		const activeClient = client;
		client = null;
		socket = null;
		decoder = null;
		if (activeStream) {
			try {
				activeStream.end();
			} catch {
				undefined;
			}
		}
		if (activeClient) {
			try {
				activeClient.end();
			} catch {
				undefined;
			}
		}
	}

	function fail(ws: SshSocket, message: string) {
		send(ws, { error: message });
		send(ws, { status: "closed" });
		endSession();
	}

	function start(ws: SshSocket) {
		if (client) {
			send(ws, { error: "ssh session is already open" });
			return;
		}
		socket = ws;
		decoder = new TextDecoder();
		send(ws, { status: "auth" });
		const conn = createClient();
		client = conn;
		conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
			const text = prompts
				.map((item) => item.prompt)
				.join(" ")
				.trim();
			send(ws, { chunk: `\r\n${text || "Password:"} ` });
			collecting = {
				echo: prompts.some((item) => item.echo),
				finish,
			};
			answer = "";
		});
		conn.on("ready", () => {
			conn.shell(
				{ cols: SSH_DEFAULT_COLS, rows: SSH_DEFAULT_ROWS, term: "xterm-256color" },
				(error, opened) => {
					if (error || !opened) {
						fail(ws, error?.message ?? "ssh shell failed");
						return;
					}
					stream = opened;
					send(ws, { status: "connected" });
					opened.on("data", (chunk) => {
						const text = decoder?.decode(chunk, { stream: true });
						if (text) {
							send(ws, { chunk: text });
						}
					});
					opened.on("close", () => {
						send(ws, { status: "closed" });
						endSession();
					});
					opened.on("error", (streamError) => {
						fail(ws, streamError.message);
					});
				},
			);
		});
		conn.on("error", (error) => {
			fail(ws, error.message || "ssh failed");
		});
		conn.connect({
			host,
			port,
			username,
			tryKeyboard: true,
			readyTimeout: 10_000,
		});
	}

	function feed(ws: SshSocket, data: string) {
		const pending = collecting;
		if (!pending) {
			return;
		}
		for (const char of data) {
			if (char === "\r" || char === "\n") {
				send(ws, { chunk: "\r\n" });
				const finish = pending.finish;
				const value = answer;
				collecting = null;
				answer = "";
				finish([value]);
				return;
			}
			if (char === "\x7f" || char === "\b") {
				answer = answer.slice(0, -1);
				continue;
			}
			if (char < " ") {
				continue;
			}
			answer += char;
			send(ws, { chunk: pending.echo ? char : "*" });
		}
	}

	return {
		handle(ws, data) {
			let command;
			try {
				command = parseSshWsCommand(JSON.parse(data));
			} catch (error) {
				send(ws, {
					error: error instanceof Error ? error.message : "ssh failed",
				});
				return;
			}
			if (command.op === "open") {
				start(ws);
				return;
			}
			if (command.op === "close") {
				const active = socket === ws;
				endSession();
				if (active) {
					send(ws, { status: "closed" });
				}
				return;
			}
			if (socket !== ws) {
				send(ws, { error: "ssh session is not open" });
				return;
			}
			if (command.op === "input") {
				if (collecting) {
					feed(ws, command.data);
					return;
				}
				try {
					stream?.write(command.data);
				} catch {
					undefined;
				}
				return;
			}
			try {
				stream?.setWindow(command.rows, command.cols, 0, 0);
			} catch {
				undefined;
			}
		},
		remove(ws) {
			if (socket === ws) {
				endSession();
			}
		},
	};
}

function runtimeUsername(): string {
	try {
		const info = process.getuid?.();
		if (info !== undefined && info === 0) {
			return "root";
		}
		return process.env.USER || process.env.LOGNAME || "root";
	} catch {
		return "root";
	}
}

function defaultClient(): SshClientLike {
	return new Client() as unknown as SshClientLike;
}
