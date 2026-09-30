import { describe, expect, test } from "bun:test";
import {
	asArduinoProxyStatus,
	asFlashStatus,
	gpioLiveValues,
	parseHubMessage,
	startHubClient,
} from "./hub.ts";

class FakeSocket {
	url: string;
	listeners = new Map<string, Array<(event?: { data?: string }) => void>>();
	static instances: FakeSocket[] = [];

	constructor(url: string) {
		this.url = url;
		FakeSocket.instances.push(this);
	}

	addEventListener(type: string, fn: (event?: { data?: string }) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	closed = false;

	close() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.emit("close");
	}

	emit(type: string, data?: string) {
		for (const fn of this.listeners.get(type) ?? []) {
			fn(data === undefined ? {} : { data });
		}
	}
}

describe("hub protocol", () => {
	test("parses flash run and proxy payloads", () => {
		expect(parseHubMessage('{"v":1,"type":"flash"}')?.type).toBe("flash");
		expect(parseHubMessage("{")).toBeNull();
		expect(parseHubMessage('{"v":1,"type":"gpio"}')).toBeNull();
		expect(parseHubMessage('{"v":1,"type":"t3"}')).toBeNull();
		expect(
			gpioLiveValues({
				hardware: "orangepi",
				pins: [
					{ physical: 7, name: "PD22", type: "gpio", value: 1 },
					{ physical: 1, name: "3V3", type: "power" },
				],
			})[7],
		).toBe(1);
		expect(asFlashStatus({ running: true, last: null })?.running).toBe(true);
		expect(parseHubMessage('{"v":1,"type":"arduinoProxy"}')?.type).toBe(
			"arduinoProxy",
		);
		expect(asArduinoProxyStatus({ connected: true })?.connected).toBe(true);
		expect(asArduinoProxyStatus({})).toBeNull();
	});
});

describe("hub client", () => {
	test("mints a ticket, dispatches flash, and remints on close", async () => {
		FakeSocket.instances = [];
		const mints: string[] = [];
		const flash: boolean[] = [];
		const client = startHubClient({
			uuid: "pair-uuid",
			mintTicket: async () => {
				mints.push("mint");
				return { wsUrl: `wss://example/hub?n=${mints.length}` };
			},
			handlers: {
				onFlash: (status) => {
					flash.push(status.running);
				},
			},
			webSocket: FakeSocket as unknown as typeof WebSocket,
			delayMs: 1,
		});
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(mints).toEqual(["mint"]);
		expect(FakeSocket.instances).toHaveLength(1);
		FakeSocket.instances[0]?.emit(
			"message",
			JSON.stringify({
				v: 1,
				type: "flash",
				payload: { running: true, last: null },
			}),
		);
		expect(flash).toEqual([true]);
		FakeSocket.instances[0]?.close();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(mints).toEqual(["mint", "mint"]);
		expect(FakeSocket.instances).toHaveLength(2);
		client.stop();
		FakeSocket.instances[1]?.close();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(mints).toEqual(["mint", "mint"]);
	});
});
