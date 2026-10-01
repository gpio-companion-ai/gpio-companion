import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { connectConsoleLive } from "./api.ts";
import { startReconnectSocket } from "./hub.ts";

export type ConsoleSnapshot = {
	host: { running: boolean; log: string };
	usb: { open: boolean; port: string; baud: number; log: string };
};

export type ConsoleTunnelStatus =
	| "idle"
	| "connecting"
	| "live"
	| "reconnecting";

export type ConsoleTunnel = {
	status: ConsoleTunnelStatus;
	snapshot: ConsoleSnapshot;
	clear: () => void;
};

function emptySnapshot(): ConsoleSnapshot {
	return {
		host: { running: false, log: "" },
		usb: { open: false, port: "", baud: 115200, log: "" },
	};
}

function asConsoleWsError(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const record = payload as {
		error?: unknown;
		host?: unknown;
		usb?: unknown;
		source?: unknown;
	};
	if (
		record.host ||
		record.usb ||
		record.source === "host" ||
		record.source === "usb"
	) {
		return null;
	}
	return typeof record.error === "string" && record.error.trim()
		? record.error
		: null;
}

function applyConsoleMessage(
	prev: ConsoleSnapshot,
	input: unknown,
): ConsoleSnapshot | null {
	if (!input || typeof input !== "object") {
		return null;
	}
	const record = input as Record<string, unknown>;
	if (
		record.host &&
		typeof record.host === "object" &&
		record.usb &&
		typeof record.usb === "object"
	) {
		return record as unknown as ConsoleSnapshot;
	}
	if (record.source === "host" && typeof record.chunk === "string") {
		return {
			...prev,
			host: { ...prev.host, log: `${prev.host.log}${record.chunk}` },
		};
	}
	if (record.source === "usb" && typeof record.chunk === "string") {
		return {
			...prev,
			usb: { ...prev.usb, log: `${prev.usb.log}${record.chunk}` },
		};
	}
	if (record.source === "host" && typeof record.running === "boolean") {
		return {
			...prev,
			host: {
				running: record.running,
				log: record.running ? "" : prev.host.log,
			},
		};
	}
	if (record.source === "usb" && typeof record.open === "boolean") {
		return {
			...prev,
			usb: {
				open: record.open,
				port: typeof record.port === "string" ? record.port : prev.usb.port,
				baud: typeof record.baud === "number" ? record.baud : prev.usb.baud,
				log: record.open ? "" : prev.usb.log,
			},
		};
	}
	return null;
}

export function useConsoleTunnel(
	uuid: string,
	token: string | null | undefined,
	onError?: (message: string) => void,
): ConsoleTunnel {
	const onErrorRef = useRef(onError);
	const snapshotRef = useRef<ConsoleSnapshot>(emptySnapshot());
	const [snapshot, setSnapshot] = useState<ConsoleSnapshot>(emptySnapshot());
	const [status, setStatus] = useState<ConsoleTunnelStatus>(
		uuid.trim() && token ? "connecting" : "idle",
	);
	onErrorRef.current = onError;

	useEffect(() => {
		const trimmed = uuid.trim();
		snapshotRef.current = emptySnapshot();
		setSnapshot(emptySnapshot());
		if (!trimmed || !token) {
			setStatus("idle");
			return;
		}
		const authToken = token;
		let closed = false;
		let client: ReturnType<typeof startReconnectSocket> | null = null;
		setStatus("connecting");

		function start() {
			client?.stop();
			if (closed) {
				return;
			}
			client = startReconnectSocket({
				headers: { Origin: "https://gpio-companion.com" },
				open: async () => {
					const next = await connectConsoleLive(authToken, trimmed);
					const wsUrl = next.wsUrl?.trim() ?? "";
					if (!wsUrl) {
						throw new Error("missing console websocket url");
					}
					return wsUrl;
				},
				onOpen() {
					setStatus("live");
				},
				onClose() {
					if (!closed) {
						setStatus("reconnecting");
					}
				},
				onMessage(data) {
					try {
						const parsed = JSON.parse(data);
						const error = asConsoleWsError(parsed);
						if (error) {
							onErrorRef.current?.(error);
							return;
						}
						const merged = applyConsoleMessage(snapshotRef.current, parsed);
						if (!merged) {
							return;
						}
						snapshotRef.current = merged;
						setSnapshot(merged);
					} catch {
						undefined;
					}
				},
			});
		}

		function onAppState(state: AppStateStatus) {
			if (state === "active") {
				setStatus("connecting");
				start();
				return;
			}
			client?.stop();
			client = null;
		}

		if (AppState.currentState === "active") {
			start();
		}
		const sub = AppState.addEventListener("change", onAppState);
		return () => {
			closed = true;
			sub.remove();
			client?.stop();
		};
	}, [uuid, token]);

	const clear = useCallback(() => {
		snapshotRef.current = emptySnapshot();
		setSnapshot(emptySnapshot());
	}, []);

	return { status, snapshot, clear };
}
