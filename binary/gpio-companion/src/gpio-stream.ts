import {
	GPIO_MAX_SOCKETS,
	GPIO_STREAM_MS,
	type GpioSnapshot,
	type GpioTarget,
	gpioPatchFrame,
	type HardwareId,
	isGpioBusCommand,
	isGpioWsRefresh,
	parseGpioWsCommand,
} from "gpio-companion";
import type { ArduinoProxyController } from "./arduino-proxy.ts";
import type { GpioController } from "./gpio.ts";

export type GpioStreamSocket = {
	send(data: string): void;
	close(code?: number, reason?: string): void;
};

export type GpioSketchTarget = "header" | "arduino-proxy";

export function createGpioStream(options: {
	gpio: GpioController;
	hardware: () => Promise<HardwareId>;
	proxy?: ArduinoProxyController;
	intervalMs?: number;
	sketchTarget?: () => GpioSketchTarget | null;
}): {
	add(ws: GpioStreamSocket): void;
	remove(ws: GpioStreamSocket): void;
	publish(): void;
	handle(ws: GpioStreamSocket, data: string): Promise<void>;
} {
	const sockets = new Set<GpioStreamSocket>();
	const targets = new Map<GpioStreamSocket, GpioTarget>();
	const intervalMs = options.intervalMs ?? GPIO_STREAM_MS;
	let timer: ReturnType<typeof setInterval> | null = null;
	let lastSnapshot: GpioSnapshot | null = null;
	let busy = false;

	async function snapshotFor(target: GpioTarget): Promise<GpioSnapshot> {
		const hardware = await options.hardware();
		if (target === "arduino-proxy") {
			if (!options.proxy) {
				throw new Error("arduino-proxy is unavailable");
			}
			return options.proxy.snapshot(hardware);
		}
		return options.gpio.snapshot(hardware);
	}

	async function broadcast(forceFull = false) {
		if (busy || sockets.size === 0) {
			return;
		}
		busy = true;
		try {
			const header = await snapshotFor("header");
			lastSnapshot = header;
			for (const ws of sockets) {
				const target = targets.get(ws) ?? "header";
				const next =
					target === "arduino-proxy" ? await snapshotFor(target) : header;
				const frame = forceFull ? next : gpioPatchFrame(null, next);
				if (!frame) {
					continue;
				}
				try {
					ws.send(JSON.stringify(frame));
				} catch {
					sockets.delete(ws);
					targets.delete(ws);
				}
			}
		} catch {
			undefined;
		} finally {
			busy = false;
			if (sockets.size === 0) {
				stopTimer();
			}
		}
	}

	async function pushFull(ws: GpioStreamSocket) {
		const started = Date.now();
		while (busy && Date.now() - started < 2_000) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		if (!sockets.has(ws)) {
			return;
		}
		const target = targets.get(ws) ?? "header";
		const snapshot =
			target === "header" && lastSnapshot
				? lastSnapshot
				: await snapshotFor(target).catch(() => lastSnapshot);
		if (snapshot) {
			try {
				ws.send(JSON.stringify(snapshot));
			} catch {
				sockets.delete(ws);
				targets.delete(ws);
			}
			return;
		}
		await broadcast(true);
	}

	function startTimer() {
		if (timer) {
			return;
		}
		timer = setInterval(() => {
			void broadcast();
		}, intervalMs);
	}

	function stopTimer() {
		if (!timer) {
			return;
		}
		clearInterval(timer);
		timer = null;
	}

	return {
		add(ws) {
			if (sockets.size >= GPIO_MAX_SOCKETS) {
				ws.close(1013, "too many gpio sockets");
				return;
			}
			sockets.add(ws);
			targets.set(ws, "header");
			startTimer();
			void pushFull(ws);
		},
		remove(ws) {
			sockets.delete(ws);
			targets.delete(ws);
			if (sockets.size === 0) {
				stopTimer();
				lastSnapshot = null;
			}
		},
		publish() {
			void broadcast(true);
		},
		async handle(ws, data) {
			try {
				const command = parseGpioWsCommand(JSON.parse(data));
				const target = command.target ?? targets.get(ws) ?? "header";
				targets.set(ws, target);
				if (isGpioWsRefresh(command)) {
					await pushFull(ws);
					return;
				}
				const hardware = await options.hardware();
				if (target === "arduino-proxy") {
					if (!options.proxy) {
						throw new Error("arduino-proxy is unavailable");
					}
					if (options.sketchTarget?.() === "arduino-proxy") {
						throw new Error("sketch is running — Live GPIO is read-only");
					}
					if (isGpioBusCommand(command)) {
						options.proxy.bus(command);
					} else {
						options.proxy.apply(hardware, command);
					}
					await pushFull(ws);
					return;
				}
				if (isGpioBusCommand(command)) {
					throw new Error("bus ops need arduino-proxy");
				}
				if (options.sketchTarget?.() === "header") {
					throw new Error("sketch is running — Live GPIO is read-only");
				}
				await options.gpio.apply(hardware, command);
				await broadcast(false);
			} catch (error) {
				const message = error instanceof Error ? error.message : "gpio failed";
				try {
					ws.send(JSON.stringify({ error: message }));
				} catch {
					undefined;
				}
			}
		},
	};
}
