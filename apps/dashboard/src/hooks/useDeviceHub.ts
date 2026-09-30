import {
	type ArduinoProxyStatus,
	asArduinoProxyStatus,
	asFlashStatus,
	asRunStatus,
	type FlashStatus,
	HUB_PATH,
	parseHubMessage,
	type RunStatus,
} from "gpio-companion";
import { useEffect } from "react";

export type DeviceHubHandlers = {
	onFlash?: (status: FlashStatus) => void;
	onRun?: (status: RunStatus) => void;
	onArduinoProxy?: (status: ArduinoProxyStatus) => void;
};

export function hubBrowserUrl(uuid: string, location: Location): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${location.host}${HUB_PATH}?uuid=${encodeURIComponent(uuid.trim())}`;
}

export function useDeviceHub(uuid: string, handlers: DeviceHubHandlers): void {
	const onFlash = handlers.onFlash;
	const onRun = handlers.onRun;
	const onArduinoProxy = handlers.onArduinoProxy;

	useEffect(() => {
		const trimmed = uuid.trim();
		if (!trimmed || typeof window === "undefined") {
			return;
		}
		let closed = false;
		let socket: WebSocket | null = null;
		let timer = 0;
		let delay = 500;

		function connect() {
			if (closed) {
				return;
			}
			socket = new WebSocket(hubBrowserUrl(trimmed, window.location));
			socket.addEventListener("open", () => {
				delay = 500;
			});
			socket.addEventListener("message", (event) => {
				const message = parseHubMessage(String(event.data ?? ""));
				if (!message) {
					return;
				}
				if (message.type === "flash") {
					const status = asFlashStatus(message.payload);
					if (status) {
						onFlash?.(status);
					}
					return;
				}
				if (message.type === "run") {
					const status = asRunStatus(message.payload);
					if (status) {
						onRun?.(status);
					}
					return;
				}
				if (message.type === "arduinoProxy") {
					const status = asArduinoProxyStatus(message.payload);
					if (status) {
						onArduinoProxy?.(status);
					}
				}
			});
			socket.addEventListener("close", () => {
				if (closed) {
					return;
				}
				timer = window.setTimeout(() => {
					delay = Math.min(delay * 2, 10_000);
					connect();
				}, delay);
			});
		}

		connect();
		return () => {
			closed = true;
			window.clearTimeout(timer);
			socket?.close();
		};
	}, [uuid, onFlash, onRun, onArduinoProxy]);
}
