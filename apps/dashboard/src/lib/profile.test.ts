import { describe, expect, test } from "bun:test";
import { generateDeviceKeyPair, parseUserProfile } from "gpio-companion";
import { markDeviceLive } from "./debug-live.ts";
import type { StoredPairing } from "./pairing-store.ts";
import { upsertDevice } from "./pairing-store.ts";
import { getUserProfile, setUserProfile } from "./profile.ts";
import { pushProfileToLiveBoards } from "./profile-push.ts";

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

describe("user profile", () => {
	test("round-trips through kv and rejects invalid input", async () => {
		const kv = memoryKv();
		expect(await getUserProfile(kv, "user-1")).toBeNull();
		expect(await getUserProfile(kv, "")).toBeNull();
		const saved = await setUserProfile(kv, "user-1", {
			level: "expert",
			context: "lab",
		});
		expect(saved).toEqual({ level: "expert", context: "lab" });
		expect(await getUserProfile(kv, "user-1")).toEqual({
			level: "expert",
			context: "lab",
		});
		await expect(
			setUserProfile(kv, "user-1", { level: "guru", context: "lab" }),
		).rejects.toThrow("profile.level");
		await expect(
			setUserProfile(kv, "user-1", { level: "expert" }),
		).rejects.toThrow("profile.context");
	});

	test("stored garbage reads as null", async () => {
		const kv = memoryKv();
		await kv.put("profile:user-2", "{not json");
		expect(await getUserProfile(kv, "user-2")).toBeNull();
	});
});

describe("pushProfileToLiveBoards", () => {
	test("puts the profile to live boards only", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("live-board"));
		await upsertDevice(kv, board("offline-board"));
		await markDeviceLive(kv, "live-board", 1_000);
		const calls: string[] = [];
		const bodies: unknown[] = [];
		await pushProfileToLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			parseUserProfile({ level: "beginner", context: "education" }),
			{
				now: 1_000,
				fetchImpl: async (input, init) => {
					calls.push(`${init?.method} ${String(input)}`);
					bodies.push(JSON.parse(String(init?.body ?? "{}")));
					return Response.json({ ok: true });
				},
			},
		);
		expect(calls).toEqual([
			"PUT https://api-liveboard.gpio-companion.com/v1/config/profile",
		]);
		expect(bodies[0]).toEqual({ level: "beginner", context: "education" });
	});

	test("skips when no board is live", async () => {
		const keys = await generateDeviceKeyPair();
		const kv = memoryKv();
		await upsertDevice(kv, board("offline-board"));
		const calls: string[] = [];
		await pushProfileToLiveBoards(
			{
				DYNAMIC_PAGE_KV: kv,
				GPIO_COMPANION_DEVICE_PRIVATE_KEY: keys.privateKeyPem,
			},
			"user-1",
			parseUserProfile({ level: "intermediate", context: "home" }),
			{
				now: 1_000,
				fetchImpl: async (input, init) => {
					calls.push(`${init?.method} ${String(input)}`);
					return Response.json({ ok: true });
				},
			},
		);
		expect(calls).toEqual([]);
	});
});
