import { describe, expect, test } from "bun:test";
import { asBoardPresence, BoardPresenceTracker } from "./board-presence.ts";
import { parseHubMessage } from "./hub-message.ts";

describe("board presence alerts", () => {
	test("initial state is silent; only real transitions alert", () => {
		const tracker = new BoardPresenceTracker();
		const event = { uuid: "board-a", online: false, snapshot: true };
		expect(tracker.accept(event)).toBe(false);
		expect(tracker.accept({ ...event, online: true, snapshot: false })).toBe(
			true,
		);
		expect(tracker.accept({ ...event, online: true, snapshot: false })).toBe(
			false,
		);
		expect(tracker.accept({ ...event, snapshot: false })).toBe(true);
	});
	test("app reconnect is a silent baseline, not a board failure", () => {
		const tracker = new BoardPresenceTracker();
		const event = { uuid: "board-a", online: true, snapshot: true };
		tracker.accept(event);
		expect(tracker.accept({ ...event, online: false })).toBe(false);
		expect(tracker.accept({ ...event, online: false, snapshot: false })).toBe(
			false,
		);
		expect(tracker.accept({ ...event, snapshot: false })).toBe(true);
	});
	test("boards have independent baselines", () => {
		const a = new BoardPresenceTracker();
		const b = new BoardPresenceTracker();
		a.accept({ uuid: "a", online: true, snapshot: true });
		b.accept({ uuid: "b", online: false, snapshot: true });
		expect(a.accept({ uuid: "a", online: false, snapshot: false })).toBe(true);
		expect(b.accept({ uuid: "b", online: false, snapshot: false })).toBe(false);
	});
	test("requires a valid presence envelope and boolean fields", () => {
		const payload = { uuid: "a", online: true, snapshot: false };
		expect(
			asBoardPresence(
				parseHubMessage(JSON.stringify({ v: 1, type: "presence", payload }))
					?.payload,
			),
		).toEqual(payload);
		expect(asBoardPresence({ ...payload, online: "true" })).toBeNull();
		expect(asBoardPresence({ ...payload, uuid: " " })).toBeNull();
		expect(asBoardPresence({ uuid: "a", online: false })).toBeNull();
	});
});
