import { describe, expect, test } from "bun:test";
import { generateDeviceKeyPair } from "gpio-companion";
import { markDeviceLive } from "./debug-live.ts";
import { type StoredPairing, upsertDevice } from "./pairing-store.ts";
import {
	pushProjectToLiveBoards,
	removeProjectFromLiveBoards,
} from "./projects-push.ts";

function memoryKv() {
	const data = new Map<string, string>();
	return {
		get: async (key: string) => data.get(key) ?? null,
		put: async (
			key: string,
			value: string,
			_options?: { expirationTtl?: number },
		) => {
			data.set(key, value);
		},
		delete: async (key: string) => {
			data.delete(key);
		},
		list: async ({ prefix }: { prefix: string; cursor?: string }) => {
			const keys = [...data.keys()]
				.filter((name) => name.startsWith(prefix))
				.sort()
				.map((name) => ({ name }));
			return { keys, list_complete: true as const };
		},
	};
}

function board(uuid: string): StoredPairing {
	return {
		userId: "user-1",
		uuid,
		key: `key-${uuid}`,
		deviceUrl: `https://api-${uuid.replaceAll("-", "")}.gpio-companion.com`,
		login: "ada",
		email: "ada@gpio-companion.com",
		claimedAt: "2026-09-11T00:00:00.000Z",
		label: "",
		bleMac: "",
	};
}

describe("pushProjectToLiveBoards", () => {
	test("posts to live boards only", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("live-board"));
		await upsertDevice(kv, board("offline-board"));
		await markDeviceLive(kv, "live-board", 1_000);
		const calls: string[] = [];
		await pushProjectToLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			{ owner: "ada", name: "blink" },
			{
				now: 1_000,
				fetchImpl: async (input, init) => {
					calls.push(`${init?.method} ${String(input)}`);
					return Response.json({ started: true });
				},
			},
		);
		expect(calls).toEqual([
			"POST https://api-liveboard.gpio-companion.com/v1/projects/sync",
		]);
	});

	test("skips when no board is live", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("offline-board"));
		let fetches = 0;
		await pushProjectToLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			{ owner: "ada", name: "blink" },
			{
				now: 1_000,
				fetchImpl: async () => {
					fetches += 1;
					return Response.json({ started: true });
				},
			},
		);
		expect(fetches).toBe(0);
	});

	test("swallows fetch failures", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("live-board"));
		await markDeviceLive(kv, "live-board", 1_000);
		await pushProjectToLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			{ owner: "ada", name: "blink" },
			{
				now: 1_000,
				fetchImpl: async () => {
					throw new Error("offline");
				},
			},
		);
	});
});

describe("removeProjectFromLiveBoards", () => {
	test("posts remove to live boards only", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("live-board"));
		await upsertDevice(kv, board("offline-board"));
		await markDeviceLive(kv, "live-board", 1_000);
		const calls: string[] = [];
		await removeProjectFromLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			{ owner: "ada", name: "blink" },
			{
				now: 1_000,
				fetchImpl: async (input, init) => {
					calls.push(`${init?.method} ${String(input)}`);
					return Response.json({ removed: true });
				},
			},
		);
		expect(calls).toEqual([
			"POST https://api-liveboard.gpio-companion.com/v1/projects/remove",
		]);
	});
});
