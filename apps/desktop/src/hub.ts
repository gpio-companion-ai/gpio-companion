import type {
	ArduinoProxyStatus,
	FlashStatus,
	GpioSnapshot,
	RunStatus,
} from "./api";

const START_MS = 500;

import {
	asBoardPresence,
	type BoardPresence,
} from "../../../packages/core/src/board-presence.ts";

const MAX_MS = 10_000;

export type HubHandlers = {
	onPresence?: (presence: BoardPresence) => void;
	onFlash?: (status: FlashStatus) => void;
	onRun?: (status: RunStatus) => void;
	onArduinoProxy?: (status: ArduinoProxyStatus) => void;
};

type HubMessage = {
	v: 1;
	type: string;
	payload?: unknown;
};

export function parseHubMessage(input: unknown): HubMessage | null {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input) as unknown;
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as { v?: unknown; type?: unknown; payload?: unknown };
	if (record.v !== 1 || typeof record.type !== "string") {
		return null;
	}
	if (
		record.type !== "flash" &&
		record.type !== "run" &&
		record.type !== "arduinoProxy" &&
		record.type !== "hello" &&
		record.type !== "presence" &&
		record.type !== "ping"
	) {
		return null;
	}
	const message: HubMessage = { v: 1, type: record.type };
	if (record.payload !== undefined) {
		message.payload = record.payload;
	}
	return message;
}

export function gpioSnapshotStatusKey(snapshot: GpioSnapshot): string {
	return `${snapshot.target ?? "header"}|${snapshot.pins
		.map(
			(pin) =>
				`${pin.physical}:${pin.dir ?? ""}:${pin.value ?? ""}:${pin.analog ?? ""}:${pin.hz ?? ""}:${pin.pwm ?? ""}:${pin.adc ?? ""}`,
		)
		.join("|")}`;
}

export function applyGpioMessage(
	prev: GpioSnapshot | null,
	payload: unknown,
): GpioSnapshot | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as GpioSnapshot & { patch?: GpioSnapshot["pins"] };
	if (record.hardware !== "raspberrypi" && record.hardware !== "orangepi") {
		return null;
	}
	if (Array.isArray(record.pins)) {
		return {
			hardware: record.hardware,
			pins: record.pins,
			target: record.target,
			proxy: record.proxy,
		};
	}
	if (!Array.isArray(record.patch)) {
		return null;
	}
	if (
		!prev ||
		prev.hardware !== record.hardware ||
		(record.target && record.target !== prev.target)
	) {
		return {
			hardware: record.hardware,
			pins: record.patch,
			target: record.target,
			proxy: record.proxy,
		};
	}
	const byPhysical = new Map(
		prev.pins.map((pin) => [pin.physical, pin] as const),
	);
	for (const pin of record.patch) {
		byPhysical.set(pin.physical, pin);
	}
	return {
		hardware: record.hardware,
		pins: [...byPhysical.values()].sort((a, b) => a.physical - b.physical),
		target: record.target ?? prev.target,
		proxy: record.proxy ?? prev.proxy,
	};
}

export function asFlashStatus(payload: unknown): FlashStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as FlashStatus;
	if (typeof record.running !== "boolean") {
		return null;
	}
	return record;
}

export function asRunStatus(payload: unknown): RunStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as RunStatus;
	if (typeof record.running !== "boolean") {
		return null;
	}
	if (typeof record.log !== "string") {
		return null;
	}
	return record;
}

export function asArduinoProxyStatus(
	payload: unknown,
): ArduinoProxyStatus | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as ArduinoProxyStatus;
	if (typeof record.connected !== "boolean") {
		return null;
	}
	return record;
}

export type ReconnectSocket = {
	stop(): void;
	pause(): void;
	resume(): void;
	send(data: string): boolean;
};

export function startReconnectSocket(options: {
	open: () => Promise<string>;
	onMessage?: (data: string) => void;
	onError?: (message?: string) => void;
	onOpen?: () => void;
	onClose?: () => void;
	webSocket?: typeof WebSocket;
	delayMs?: number;
	maxDelayMs?: number;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}): ReconnectSocket {
	let stopped = false;
	let paused = false;
	let socket: WebSocket | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let delay = options.delayMs ?? START_MS;
	const maxDelay = options.maxDelayMs ?? MAX_MS;
	const Socket = options.webSocket ?? WebSocket;
	const schedule = options.setTimeoutFn ?? setTimeout;
	const unschedule = options.clearTimeoutFn ?? clearTimeout;

	function clearTimer() {
		if (timer) {
			unschedule(timer);
			timer = null;
		}
	}

	function scheduleReconnect() {
		if (stopped || paused) {
			return;
		}
		clearTimer();
		timer = schedule(() => {
			delay = Math.min(delay * 2, maxDelay);
			void connect();
		}, delay);
	}

	async function connect() {
		if (stopped || paused) {
			return;
		}
		clearTimer();
		try {
			const wsUrl = (await options.open()).trim();
			if (stopped || paused) {
				return;
			}
			if (!wsUrl) {
				throw new Error("missing websocket url");
			}
			socket?.close();
			const next = new Socket(wsUrl);
			socket = next;
			next.addEventListener("open", () => {
				delay = options.delayMs ?? START_MS;
				options.onOpen?.();
			});
			next.addEventListener("message", (event) => {
				options.onMessage?.(String((event as MessageEvent).data ?? ""));
			});
			next.addEventListener("error", () => {
				options.onError?.("debug websocket failed");
				next.close();
			});
			next.addEventListener("close", () => {
				if (socket === next) {
					socket = null;
				}
				if (!stopped && !paused) {
					options.onClose?.();
				}
				scheduleReconnect();
			});
		} catch (caught) {
			options.onError?.(
				caught instanceof Error ? caught.message : "debug websocket failed",
			);
			scheduleReconnect();
		}
	}

	void connect();
	return {
		send(data) {
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				return false;
			}
			socket.send(data);
			return true;
		},
		stop() {
			stopped = true;
			clearTimer();
			socket?.close();
			socket = null;
		},
		pause() {
			if (stopped || paused) {
				return;
			}
			paused = true;
			clearTimer();
			socket?.close();
			socket = null;
		},
		resume() {
			if (stopped || !paused) {
				return;
			}
			paused = false;
			delay = options.delayMs ?? START_MS;
			void connect();
		},
	};
}

export function startHubClient(options: {
	uuid: string;
	mintTicket: () => Promise<{ wsUrl: string }>;
	handlers: HubHandlers;
	webSocket?: typeof WebSocket;
	delayMs?: number;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}): ReconnectSocket {
	return startReconnectSocket({
		webSocket: options.webSocket,
		delayMs: options.delayMs,
		setTimeoutFn: options.setTimeoutFn,
		clearTimeoutFn: options.clearTimeoutFn,
		open: async () => {
			const ticket = await options.mintTicket();
			const wsUrl = ticket.wsUrl?.trim() ?? "";
			if (!wsUrl) {
				throw new Error("hub ticket missing wsUrl");
			}
			return wsUrl;
		},
		onMessage(data) {
			const message = parseHubMessage(data);
			if (!message) {
				return;
			}
			if (message.type === "presence") {
				const presence = asBoardPresence(message.payload);
				if (presence?.uuid === options.uuid)
					options.handlers.onPresence?.(presence);
				return;
			}
			if (message.type === "flash") {
				const status = asFlashStatus(message.payload);
				if (status) {
					options.handlers.onFlash?.(status);
				}
				return;
			}
			if (message.type === "run") {
				const status = asRunStatus(message.payload);
				if (status) {
					options.handlers.onRun?.(status);
				}
				return;
			}
			if (message.type === "arduinoProxy") {
				const status = asArduinoProxyStatus(message.payload);
				if (status) {
					options.handlers.onArduinoProxy?.(status);
				}
			}
		},
	});
}
