import type { UiCommand, UiSurface } from "gpio-companion-ui";
import { parseUiCommand } from "gpio-companion-ui";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { connectUiLive } from "./api.ts";
import { type ReconnectSocket, startReconnectSocket } from "./hub.ts";

type UiSocketOptions = {
	surface: UiSurface;
	enabled: boolean;
	uuid: string;
	authToken: string;
	isFocused: () => boolean;
	onCommand: (command: UiCommand) => void;
};

export type UiSocketHandle = {
	reply: (id: string, action: string, body?: string) => void;
};

export function useUiSocket(options: UiSocketOptions): UiSocketHandle {
	const { enabled, surface, uuid, authToken } = options;
	const isFocusedRef = useRef(options.isFocused);
	const onCommandRef = useRef(options.onCommand);
	const socketRef = useRef<ReconnectSocket | null>(null);
	isFocusedRef.current = options.isFocused;
	onCommandRef.current = options.onCommand;

	const send = useCallback((json: string) => {
		socketRef.current?.send(json);
	}, []);

	useEffect(() => {
		const trimmed = uuid.trim();
		if (!enabled || !trimmed) {
			return;
		}
		const socket = startReconnectSocket({
			open: async () => {
				const next = await connectUiLive(authToken, trimmed);
				const wsUrl = next.wsUrl?.trim() ?? "";
				if (!wsUrl) {
					throw new Error("missing ui websocket url");
				}
				return wsUrl;
			},
			onOpen() {
				send(
					JSON.stringify({
						op: "hello",
						surface,
						focused: isFocusedRef.current(),
					}),
				);
			},
			onMessage(data) {
				try {
					onCommandRef.current(parseUiCommand(JSON.parse(data)));
				} catch {
					undefined;
				}
			},
		});
		socketRef.current = socket;

		const subscription = AppState.addEventListener("change", (state) => {
			socket.send(
				JSON.stringify({
					op: "hello",
					surface,
					focused: state === "active",
				}),
			);
		});
		return () => {
			subscription.remove();
			socket.stop();
			socketRef.current = null;
		};
	}, [authToken, enabled, surface, uuid, send]);

	return {
		reply(id: string, action: string, body?: string) {
			send(
				JSON.stringify({
					op: "reply",
					id,
					action,
					...(body ? { body } : {}),
				}),
			);
		},
	};
}
