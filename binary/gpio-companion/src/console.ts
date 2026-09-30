import {
	CONSOLE_DEFAULT_BAUD,
	CONSOLE_FLUSH_MS,
	CONSOLE_MAX_SOCKETS,
	CONSOLE_USB_REOPEN_MS,
	ConsoleError,
	type ConsoleSnapshot,
	type ConsoleSource,
	capConsoleLog,
	emptyConsoleSnapshot,
	parseConsoleUsbPut,
	parseConsoleWsCommand,
} from "gpio-companion";
import { openTtyReadStream } from "./arduino-proxy.ts";

export type ConsoleSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
};

export type UsbHandle = {
	close(): void;
};

export type ConsoleHub = {
	snapshot(): ConsoleSnapshot;
	startUsb(input: unknown): { started: true };
	stopUsb(): { stopped: true };
	scheduleUsb(port: string, baud?: number): void;
	appendHost(chunk: string): void;
	setHostRunning(running: boolean): void;
	add(ws: ConsoleSocket): void;
	remove(ws: ConsoleSocket): void;
	handle(ws: ConsoleSocket, data: string): void;
};

export function createConsoleHub(options?: {
	openUsb?: (
		port: string,
		baud: number,
		onChunk: (text: string) => void,
		onClose: () => void,
	) => UsbHandle;
	flushMs?: number;
	reopenMs?: number;
}): ConsoleHub {
	const sockets = new Set<ConsoleSocket>();
	const flushMs = options?.flushMs ?? CONSOLE_FLUSH_MS;
	const reopenMs = options?.reopenMs ?? CONSOLE_USB_REOPEN_MS;
	const openUsb = options?.openUsb ?? liveOpenUsb;
	let state = emptyConsoleSnapshot();
	let usb: UsbHandle | null = null;
	let reopenTimer: ReturnType<typeof setTimeout> | null = null;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	const pending: Record<ConsoleSource, string> = { host: "", usb: "" };

	function send(ws: ConsoleSocket, payload: unknown) {
		try {
			ws.send(JSON.stringify(payload));
		} catch {
			sockets.delete(ws);
		}
	}

	function sendAll(payload: unknown) {
		const text = JSON.stringify(payload);
		for (const ws of sockets) {
			try {
				ws.send(text);
			} catch {
				sockets.delete(ws);
			}
		}
	}

	function flush() {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		for (const source of ["host", "usb"] as const) {
			const chunk = pending[source];
			if (!chunk) {
				continue;
			}
			pending[source] = "";
			sendAll({ source, chunk });
		}
	}

	function queue(source: ConsoleSource, chunk: string) {
		if (!chunk) {
			return;
		}
		pending[source] += chunk;
		if (pending[source].includes("\n") || pending[source].length >= 1024) {
			flush();
			return;
		}
		if (!flushTimer) {
			flushTimer = setTimeout(flush, flushMs);
		}
	}

	function closeUsb() {
		if (reopenTimer) {
			clearTimeout(reopenTimer);
			reopenTimer = null;
		}
		const handle = usb;
		usb = null;
		if (handle) {
			try {
				handle.close();
			} catch {
				undefined;
			}
		}
		if (state.usb.open) {
			state = {
				...state,
				usb: { ...state.usb, open: false },
			};
			sendAll({
				source: "usb",
				open: false,
				port: state.usb.port,
				baud: state.usb.baud,
			});
		}
	}

	function openPort(port: string, baud: number) {
		closeUsb();
		state = {
			...state,
			usb: { open: true, port, baud, log: "" },
		};
		sendAll({ source: "usb", open: true, port, baud });
		try {
			usb = openUsb(
				port,
				baud,
				(chunk) => {
					state = {
						...state,
						usb: {
							...state.usb,
							log: capConsoleLog(`${state.usb.log}${chunk}`),
						},
					};
					queue("usb", chunk);
				},
				() => {
					if (usb) {
						closeUsb();
					}
				},
			);
		} catch (caught) {
			state = {
				...state,
				usb: { open: false, port, baud, log: "" },
			};
			throw caught instanceof ConsoleError
				? caught
				: new ConsoleError(
						caught instanceof Error ? caught.message : "usb serial failed",
					);
		}
	}

	return {
		snapshot() {
			return {
				host: { ...state.host },
				usb: { ...state.usb },
			};
		},
		startUsb(input) {
			const put = parseConsoleUsbPut(input);
			openPort(put.port, put.baud);
			return { started: true };
		},
		stopUsb() {
			closeUsb();
			return { stopped: true };
		},
		scheduleUsb(port, baud) {
			closeUsb();
			reopenTimer = setTimeout(() => {
				reopenTimer = null;
				try {
					openPort(port, baud ?? CONSOLE_DEFAULT_BAUD);
				} catch {
					undefined;
				}
			}, reopenMs);
		},
		appendHost(chunk) {
			if (!chunk) {
				return;
			}
			state = {
				...state,
				host: {
					...state.host,
					log: capConsoleLog(`${state.host.log}${chunk}`),
				},
			};
			queue("host", chunk);
		},
		setHostRunning(running) {
			state = {
				...state,
				host: {
					running,
					log: running ? "" : state.host.log,
				},
			};
			sendAll({ source: "host", running });
		},
		add(ws) {
			if (sockets.size >= CONSOLE_MAX_SOCKETS) {
				ws.close(1013, "too many console sockets");
				return;
			}
			sockets.add(ws);
			send(ws, state);
		},
		remove(ws) {
			sockets.delete(ws);
		},
		handle(ws, data) {
			try {
				parseConsoleWsCommand(JSON.parse(data));
				send(ws, state);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "console failed";
				send(ws, { error: message });
			}
		},
	};
}

function liveOpenUsb(
	port: string,
	baud: number,
	onChunk: (text: string) => void,
	onClose: () => void,
): UsbHandle {
	let closed = false;
	let stream: ReturnType<typeof openTtyReadStream> | null = null;
	const decoder = new TextDecoder();
	void (async () => {
		const proc = Bun.spawn(
			[
				"stty",
				"-F",
				port,
				String(baud),
				"cs8",
				"-cstopb",
				"-parenb",
				"raw",
				"-echo",
				"-icrnl",
				"-hupcl",
				"clocal",
				"cread",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const code = await proc.exited;
		if (closed) {
			return;
		}
		if (code !== 0) {
			onClose();
			return;
		}
		try {
			stream = openTtyReadStream(port);
			if (closed) {
				stream.destroy();
				stream = null;
				return;
			}
			stream.on("error", () => {
				if (!closed) {
					onClose();
				}
			});
		} catch {
			onClose();
			return;
		}
		stream.on("data", (buf) => {
			if (closed) {
				return;
			}
			const text = decoder.decode(buf, { stream: true });
			if (text) {
				onChunk(text);
			}
		});
		stream.on("end", () => {
			if (!closed) {
				onClose();
			}
		});
	})();
	return {
		close() {
			closed = true;
			stream?.destroy();
		},
	};
}
