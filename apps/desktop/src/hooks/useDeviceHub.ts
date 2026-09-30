import { useEffect } from "react";
import { mintHubTicket } from "../api";
import { type HubHandlers, startHubClient } from "../hub";

export function useDeviceHub(uuid: string, handlers: HubHandlers): void {
	const onFlash = handlers.onFlash;
	const onRun = handlers.onRun;
	const onArduinoProxy = handlers.onArduinoProxy;

	useEffect(() => {
		const trimmed = uuid.trim();
		if (!trimmed) {
			return;
		}
		const client = startHubClient({
			uuid: trimmed,
			mintTicket: () => mintHubTicket(trimmed),
			handlers: { onFlash, onRun, onArduinoProxy },
		});
		return () => {
			client.stop();
		};
	}, [uuid, onFlash, onRun, onArduinoProxy]);
}
