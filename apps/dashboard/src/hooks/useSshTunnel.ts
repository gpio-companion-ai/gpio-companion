import { POST as signSshLive } from "@api/ssh-live";
import { asSshWsError, parseSshWsCommand } from "gpio-companion";
import { useCallback, useEffect, useRef, useState } from "react";
import { unwrapAction } from "../lib/action.ts";

export type SshTunnelStatus =
	| "idle"
	| "connecting"
	| "auth"
	| "live"
	| "closed";

export type SshTunnel = {
	status: SshTunnelStatus;
	error: string;
	connect: () => void;
	disconnect: () => void;
	send: (data: string) => void;
	resize: (cols: number, rows: number) => void;
};

export function useSshTunnel(
	uuid: string,
	onChunk: (chunk: string) => void,
): SshTunnel {
	const [status, setStatus] = useState<SshTunnelStatus>("idle");
	const [error, setError] = useState("");
	const chunkRef = useRef(onChunk);
	const socketRef = useRef<WebSocket | null>(null);
	chunkRef.current = onChunk;

	const applyStatus = useCallback((next: SshTunnelStatus) => {
		setStatus(next);
	}, []);

	const disconnect = useCallback(() => {
		const socket = socketRef.current;
		socketRef.current = null;
		if (socket) {
			try {
				socket.close(1000, "client disconnect");
			} catch {
				undefined;
			}
		}
		applyStatus("closed");
	}, [applyStatus]);

	const connect = useCallback(() => {
		const trimmed = uuid.trim();
		if (!trimmed || typeof window === "undefined") {
			return;
		}
		const existing = socketRef.current;
		if (existing) {
			try {
				existing.close(1000, "reconnect");
			} catch {
				undefined;
			}
			socketRef.current = null;
		}
		setError("");
		applyStatus("connecting");
		void (async () => {
			try {
				const signed = unwrapAction(await signSshLive(trimmed));
				const wsUrl = signed.wsUrl.trim();
				if (!wsUrl) {
					throw new Error("missing ssh websocket url");
				}
				const next = new WebSocket(wsUrl);
				socketRef.current = next;
				next.addEventListener("open", () => {
					if (socketRef.current === next) {
						next.send(JSON.stringify({ op: "open" }));
					}
				});
				next.addEventListener("message", (event) => {
					if (socketRef.current !== next) {
						return;
					}
					try {
						const parsed = JSON.parse(String(event.data ?? ""));
						const wsError = asSshWsError(parsed);
						if (wsError) {
							setError(wsError);
							return;
						}
						if (parsed && typeof parsed === "object") {
							const record = parsed as Record<string, unknown>;
							if (record.status === "auth") {
								applyStatus("auth");
								return;
							}
							if (record.status === "connected") {
								applyStatus("live");
								return;
							}
							if (record.status === "closed") {
								applyStatus("closed");
								return;
							}
						}
						if (typeof parsed.chunk === "string") {
							chunkRef.current(parsed.chunk);
						}
					} catch {
						undefined;
					}
				});
				next.addEventListener("close", () => {
					if (socketRef.current === next) {
						socketRef.current = null;
						applyStatus("closed");
					}
				});
			} catch (err) {
				setError(err instanceof Error ? err.message : "ssh failed");
				applyStatus("closed");
			}
		})();
	}, [applyStatus, uuid]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset the tunnel when the selected board changes
	useEffect(() => {
		applyStatus("idle");
		setError("");
	}, [applyStatus, uuid]);

	useEffect(() => {
		return () => {
			const socket = socketRef.current;
			socketRef.current = null;
			if (socket) {
				try {
					socket.close(1000, "unmount");
				} catch {
					undefined;
				}
			}
		};
	}, []);

	const send = useCallback((data: string) => {
		const socket = socketRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(parseSshWsCommand({ op: "input", data })));
		}
	}, []);

	const resize = useCallback((cols: number, rows: number) => {
		const socket = socketRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(
				JSON.stringify(parseSshWsCommand({ op: "resize", cols, rows })),
			);
		}
	}, []);

	return { status, error, connect, disconnect, send, resize };
}
