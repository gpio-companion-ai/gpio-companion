import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { mintHubTicket } from "./api.ts";
import { type HubHandlers, startHubClient } from "./hub.ts";

export function useDeviceHub(
	uuid: string,
	token: string | null | undefined,
	handlers: HubHandlers,
): void {
	const onGpio = handlers.onGpio;
	const onFlash = handlers.onFlash;
	const onRun = handlers.onRun;
	const onArduinoProxy = handlers.onArduinoProxy;

	useEffect(() => {
		const trimmed = uuid.trim();
		if (!trimmed || !token) {
			return;
		}
		const authToken = token;
		let closed = false;
		let client: { stop(): void } | null = null;

		function start() {
			client?.stop();
			if (closed) {
				return;
			}
			client = startHubClient({
				uuid: trimmed,
				mintTicket: () => mintHubTicket(authToken, trimmed),
				handlers: { onGpio, onFlash, onRun, onArduinoProxy },
			});
		}

		function onAppState(state: AppStateStatus) {
			if (state === "active") {
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
	}, [uuid, token, onGpio, onFlash, onRun, onArduinoProxy]);
}
