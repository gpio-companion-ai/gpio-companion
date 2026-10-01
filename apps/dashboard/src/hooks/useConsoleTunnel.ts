import { POST as signConsoleLive } from "@api/console-live";
import {
	applyConsoleMessage,
	asConsoleWsError,
	type ConsoleSnapshot,
	emptyConsoleSnapshot,
} from "gpio-companion";
import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapAction } from "../lib/action.ts";

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

export function useConsoleTunnel(
	uuid: string,
	onError?: (message: string) => void,
): ConsoleTunnel {
	const onErrorRef = useRef(onError);
	const snapshotRef = useRef<ConsoleSnapshot>(emptyConsoleSnapshot());
	const [snapshot, setSnapshot] = useState<ConsoleSnapshot>(
		emptyConsoleSnapshot(),
	);
	const [status, setStatus] = useState<ConsoleTunnelStatus>(
		uuid.trim() ? "connecting" : "idle",
	);
	onErrorRef.current = onError;

	useEffect(() => {
		const trimmed = uuid.trim();
		snapshotRef.current = emptyConsoleSnapshot();
		setSnapshot(emptyConsoleSnapshot());
		if (!trimmed || typeof window === "undefined") {
			setStatus("idle");
			return;
		}
		let closed = false;
		let socket: WebSocket | null = null;
		let timer = 0;
		let delay = 500;
		setStatus("connecting");

		async function connect() {
			if (closed) {
				return;
			}
			try {
				const signed = unwrapAction(await signConsoleLive(trimmed));
				if (closed) {
					return;
				}
				const wsUrl = signed.wsUrl.trim();
				if (!wsUrl) {
					throw new Error("missing console websocket url");
				}
				socket?.close();
				const next = new WebSocket(wsUrl);
				socket = next;
				next.addEventListener("open", () => {
					delay = 500;
					if (socket === next) {
						setStatus("live");
					}
				});
				next.addEventListener("message", (event) => {
					if (socket !== next) {
						return;
					}
					try {
						const parsed = JSON.parse(String(event.data ?? ""));
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
				});
				next.addEventListener("close", () => {
					if (socket === next) {
						socket = null;
					}
					if (!closed) {
						setStatus("reconnecting");
						schedule();
					}
				});
			} catch {
				if (!closed) {
					setStatus("reconnecting");
					schedule();
				}
			}
		}

		function schedule() {
			if (closed) {
				return;
			}
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				delay = Math.min(delay * 2, 10_000);
				void connect();
			}, delay);
		}

		void connect();
		return () => {
			closed = true;
			window.clearTimeout(timer);
			socket?.close();
		};
	}, [uuid]);

	const clear = useCallback(() => {
		snapshotRef.current = emptyConsoleSnapshot();
		setSnapshot(emptyConsoleSnapshot());
	}, []);

	return { status, snapshot, clear };
}
