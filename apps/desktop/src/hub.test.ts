import { describe, expect, test } from "bun:test";
import {
	asArduinoProxyStatus,
	asFlashStatus,
	asGpioSnapshot,
	parseHubMessage,
	startHubClient,
} from "./hub";

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
	test("parses gpio flash and proxy payloads", () => {
		expect(parseHubMessage('{"v":1,"type":"gpio"}')?.type).toBe("gpio");
		expect(parseHubMessage("{")).toBeNull();
		expect(asGpioSnapshot({ hardware: "orangepi", pins: [] })?.hardware).toBe(
			"orangepi",
		);
		expect(asGpioSnapshot({ hardware: "x86", pins: [] })).toBeNull();
		expect(asFlashStatus({ running: true, last: null })?.running).toBe(true);
		expect(parseHubMessage('{"v":1,"type":"t3"}')?.type).toBe("t3");
		expect(parseHubMessage('{"v":1,"type":"arduinoProxy"}')?.type).toBe(
			"arduinoProxy",
		);
		expect(asArduinoProxyStatus({ connected: true })?.connected).toBe(true);
		expect(asArduinoProxyStatus({})).toBeNull();
	});
});

describe("hub client", () => {
	test("mints a ticket, dispatches gpio, and remints on close", async () => {
		FakeSocket.instances = [];
		const mints: string[] = [];
		const gpio: string[] = [];
		const client = startHubClient({
			uuid: "pair-uuid",
			mintTicket: async () => {
				mints.push("mint");
				return { wsUrl: `wss://example/hub?n=${mints.length}` };
			},
			handlers: {
				onGpio: (snapshot) => {
					gpio.push(snapshot.hardware);
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
				type: "gpio",
				payload: { hardware: "orangepi", pins: [] },
			}),
		);
		expect(gpio).toEqual(["orangepi"]);
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
