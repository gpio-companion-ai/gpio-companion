import type { UiCommand, UiSurface } from "gpio-companion-ui";
import { parseUiCommand } from "gpio-companion-ui";
import { useEffect, useRef } from "react";
import { connectUiLive } from "../api";

type UiSocketOptions = {
	surface: UiSurface;
	enabled: boolean;
	uuid: string;
	isFocused: () => boolean;
	onCommand: (command: UiCommand) => void;
};

export type UiSocketHandle = {
	reply: (id: string, action: string, body?: string) => void;
};

export function useUiSocket(options: UiSocketOptions): UiSocketHandle {
	const { enabled, surface, uuid } = options;
	const isFocusedRef = useRef(options.isFocused);
	const onCommandRef = useRef(options.onCommand);
	const socketRef = useRef<WebSocket | null>(null);
	isFocusedRef.current = options.isFocused;
	onCommandRef.current = options.onCommand;

	useEffect(() => {
		const trimmed = uuid.trim();
		if (!enabled || !trimmed) {
			return;
		}
		let closed = false;
		let timer = 0;
		let delay = 500;

		function hello() {
			const current = socketRef.current;
			if (current && current.readyState === WebSocket.OPEN) {
				current.send(
					JSON.stringify({
						op: "hello",
						surface,
						focused: isFocusedRef.current(),
					}),
				);
			}
		}

		async function connect() {
			if (closed) {
				return;
			}
			try {
				const signed = await connectUiLive(trimmed);
				if (closed) {
					return;
				}
				const wsUrl = signed.wsUrl.trim();
				if (!wsUrl) {
					throw new Error("missing ui websocket url");
				}
				socketRef.current?.close();
				const next = new WebSocket(wsUrl);
				socketRef.current = next;
				next.addEventListener("open", () => {
					delay = 500;
					hello();
				});
				next.addEventListener("message", (event) => {
					if (socketRef.current !== next) {
						return;
					}
					try {
						onCommandRef.current(
							parseUiCommand(JSON.parse(String(event.data ?? ""))),
						);
					} catch {
						undefined;
					}
				});
				next.addEventListener("close", () => {
					if (socketRef.current === next) {
						socketRef.current = null;
					}
					schedule();
				});
			} catch {
				schedule();
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
		window.addEventListener("focus", hello);
		window.addEventListener("blur", hello);
		document.addEventListener("visibilitychange", hello);
		return () => {
			closed = true;
			window.clearTimeout(timer);
			window.removeEventListener("focus", hello);
			window.removeEventListener("blur", hello);
			document.removeEventListener("visibilitychange", hello);
			socketRef.current?.close();
			socketRef.current = null;
		};
	}, [enabled, surface, uuid]);

	return {
		reply(id: string, action: string, body?: string) {
			const current = socketRef.current;
			if (current && current.readyState === WebSocket.OPEN) {
				current.send(
					JSON.stringify({
						op: "reply",
						id,
						action,
						...(body ? { body } : {}),
					}),
				);
			}
		},
	};
}
