import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("cloudflare:workers", () => ({
	DurableObject: class {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	},
}));
const { DeviceHub } = await import("../src/index.ts");

function harness() {
	const data = new Map<string, unknown>();
	const live = new Map<string, string>();
	let deadline = 0;
	const events: unknown[] = [];
	const pi = {
		readyState: WebSocket.OPEN as number,
		deserializeAttachment: () => ({ role: "pi", uuid: "board-a" }),
		close() {
			this.readyState = WebSocket.CLOSING;
		},
	};
	const viewer = {
		send: (body: string) => events.push(JSON.parse(body)),
		deserializeAttachment: () => ({ role: "dashboard", uuid: "board-a" }),
	};
	const ctx = {
		getWebSockets: (tag: string) => (tag === "pi" ? [pi] : [viewer]),
		storage: {
			get: async (key: string) => data.get(key),
			put: async (key: string, value: unknown) => {
				data.set(key, value);
			},
			setAlarm: async (at: number) => {
				deadline = at;
			},
		},
	};
	const env = {
		DYNAMIC_PAGE_KV: {
			put: async (key: string, value: string) => {
				live.set(key, value);
			},
			delete: async (key: string) => {
				live.delete(key);
			},
		},
	};
	const hub = new DeviceHub(ctx as never, env as never);
	return {
		hub,
		ctx,
		env,
		pi,
		viewer,
		events,
		data,
		live,
		deadline: () => deadline,
	};
}

afterEach(() => mock.restore());

describe("DeviceHub presence lifecycle", () => {
	test("heartbeat publishes online once and refreshes its timeout", async () => {
		let now = 1000;
		spyOn(Date, "now").mockImplementation(() => now);
		const h = harness();
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"hello"}');
		expect(h.events).toEqual([
			{
				v: 1,
				type: "presence",
				payload: { uuid: "board-a", online: true, snapshot: false },
			},
		]);
		now += 60_000;
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"ping"}');
		expect(h.events).toHaveLength(1);
		expect(h.deadline()).toBe(now + 120_000);
	});
	test("close has grace; a quick reconnect cancels the offline alert", async () => {
		let now = 1000;
		spyOn(Date, "now").mockImplementation(() => now);
		const h = harness();
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"hello"}');
		h.pi.readyState = WebSocket.CLOSING;
		await h.hub.webSocketClose(h.pi as never, 1000, "");
		expect(h.deadline()).toBe(now + 5000);
		now += 2000;
		h.pi.readyState = WebSocket.OPEN;
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"hello"}');
		now += 4000;
		await h.hub.alarm();
		expect(h.events).toHaveLength(1);
		expect(h.live.has("live:board-a")).toBe(true);
	});
	test("disconnect becomes offline after grace, once even if alarm is retried", async () => {
		let now = 1000;
		spyOn(Date, "now").mockImplementation(() => now);
		const h = harness();
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"hello"}');
		h.pi.readyState = WebSocket.CLOSING;
		await h.hub.webSocketClose(h.pi as never, 1000, "");
		now += 5000;
		await h.hub.alarm();
		await h.hub.alarm();
		expect(h.events).toHaveLength(2);
		expect(h.events[1]).toEqual({
			v: 1,
			type: "presence",
			payload: { uuid: "board-a", online: false, snapshot: false },
		});
		expect(h.live.size).toBe(0);
	});
	test("silent power loss expires after 120s, including after object recreation", async () => {
		let now = 1000;
		spyOn(Date, "now").mockImplementation(() => now);
		const h = harness();
		await h.hub.webSocketMessage(h.pi as never, '{"v":1,"type":"hello"}');
		now += 120_000;
		const recreated = new DeviceHub(h.ctx as never, h.env as never);
		await recreated.alarm();
		expect(h.events).toHaveLength(2);
		expect(h.live.size).toBe(0);
		await recreated.webSocketMessage(h.pi as never, '{"v":1,"type":"ping"}');
		expect(h.events).toHaveLength(2);
	});
});
