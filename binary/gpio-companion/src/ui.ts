import {
	isUiReplyFresh,
	parseUiCommand,
	parseUiSocketMessage,
	UI_MAX_SOCKETS,
	type UiCommandResult,
	type UiSocketInfo,
	type UiSurface,
} from "gpio-companion";

export type UiSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
};

export type UiReply = {
	action: string;
	body?: string;
	at: number;
};

type Entry = {
	socket: UiSocket;
	id: string;
	surface: UiSurface | "";
	focused: boolean;
	connectedAt: number;
};

type Waiter = {
	resolve(reply: UiReply | null): void;
	timer: ReturnType<typeof setTimeout>;
};

export type UiHub = {
	add(ws: UiSocket): void;
	remove(ws: UiSocket): void;
	handle(ws: UiSocket, data: string): void;
	command(input: unknown): UiCommandResult;
	list(): UiSocketInfo[];
	waitReply(id: string, timeoutMs: number): Promise<UiReply | null>;
	peekReply(id: string): UiReply | null;
};

export function createUiHub(): UiHub {
	const entries = new Map<UiSocket, Entry>();
	const replies = new Map<string, UiReply>();
	const waiters = new Map<string, Set<Waiter>>();
	let nextId = 0;

	function sweep(now = Date.now()) {
		for (const [id, reply] of replies) {
			if (!isUiReplyFresh(reply.at, now)) {
				replies.delete(id);
			}
		}
	}
	function drop(entry: Entry) {
		entries.delete(entry.socket);
	}

	type HelloedEntry = Entry & { surface: UiSurface };

	function helloed(): HelloedEntry[] {
		return [...entries.values()].filter(
			(entry): entry is HelloedEntry => entry.surface !== "",
		);
	}

	return {
		add(ws) {
			if (entries.size >= UI_MAX_SOCKETS) {
				ws.close(1013, "too many ui sockets");
				return;
			}
			nextId += 1;
			entries.set(ws, {
				socket: ws,
				id: `ui-${nextId}`,
				surface: "",
				focused: false,
				connectedAt: Date.now(),
			});
		},
		remove(ws) {
			entries.delete(ws);
		},
		handle(ws, data) {
			const entry = entries.get(ws);
			if (!entry) {
				return;
			}
			try {
				const message = parseUiSocketMessage(JSON.parse(data));
				if (message.op === "hello") {
					entry.surface = message.surface;
					entry.focused = message.focused;
					return;
				}
				sweep();
				const reply: UiReply = {
					action: message.action,
					...(message.body ? { body: message.body } : {}),
					at: Date.now(),
				};
				replies.set(message.id, reply);
				const pending = waiters.get(message.id);
				if (pending) {
					waiters.delete(message.id);
					for (const waiter of pending) {
						clearTimeout(waiter.timer);
						waiter.resolve(reply);
					}
				}
			} catch (error) {
				const text =
					error instanceof Error ? error.message : "ui message failed";
				try {
					ws.send(JSON.stringify({ error: text }));
				} catch {
					drop(entry);
				}
			}
		},
		command(input) {
			const command = parseUiCommand(input);
			sweep();
			const targets = helloed();
			const focused = targets.filter((entry) => entry.focused);
			const chosen = focused.length ? focused : targets;
			const text = JSON.stringify(command);
			let delivered = 0;
			for (const entry of chosen) {
				try {
					entry.socket.send(text);
					delivered += 1;
				} catch {
					drop(entry);
				}
			}
			return {
				delivered,
				fallback: focused.length === 0 && targets.length > 0,
			};
		},
		list() {
			return helloed().map<UiSocketInfo>((entry) => ({
				id: entry.id,
				surface: entry.surface,
				focused: entry.focused,
				connectedAt: entry.connectedAt,
			}));
		},
		async waitReply(id, timeoutMs) {
			const existing = replies.get(id);
			if (existing && isUiReplyFresh(existing.at, Date.now())) {
				return existing;
			}
			return new Promise((resolve) => {
				let pending = waiters.get(id);
				if (!pending) {
					pending = new Set();
					waiters.set(id, pending);
				}
				const waiter: Waiter = {
					timer: setTimeout(() => {
						const set = waiters.get(id);
						if (set) {
							set.delete(waiter);
							if (!set.size) {
								waiters.delete(id);
							}
						}
						resolve(null);
					}, timeoutMs),
					resolve,
				};
				pending.add(waiter);
			});
		},
		peekReply(id) {
			const reply = replies.get(id);
			if (reply && isUiReplyFresh(reply.at, Date.now())) {
				return reply;
			}
			return null;
		},
	};
}
