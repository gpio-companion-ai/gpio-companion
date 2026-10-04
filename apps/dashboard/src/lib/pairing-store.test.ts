import { describe, expect, test } from "bun:test";
import {
	clearPendingForUuid,
	findDeviceByUuid,
	isPairedUuid,
	listAllDevices,
	loadDevices,
	normalizeBleMac,
	parseDeviceList,
	publicPairing,
	removeDevice,
	requireAccessibleDevice,
	requireOwnedDevice,
	type StoredPairing,
	transferDeviceRecord,
	updateDeviceFields,
	updateDeviceLabel,
	updateDeviceLabelByUuid,
	upsertDevice,
} from "./pairing-store.ts";

function memoryKv() {
	const data = new Map<string, string>();
	return {
		get: async (key: string) => data.get(key) ?? null,
		put: async (key: string, value: string) => {
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
		data,
	};
}

function board(
	userId: string,
	uuid: string,
	extra: Partial<StoredPairing> = {},
): StoredPairing {
	return {
		userId,
		uuid,
		key: `key-${uuid}`,
		deviceUrl: `https://api-${uuid.replaceAll("-", "")}.gpio-companion.com`,
		login: "ada",
		email: "ada@gpio-companion.com",
		claimedAt: "2026-08-31T00:00:00.000Z",
		label: "",
		bleMac: "",
		...extra,
	};
}

describe("parseDeviceList", () => {
	test("reads a legacy single pairing object", () => {
		const legacy = board("user-1", "uuid-1");
		expect(parseDeviceList(JSON.stringify(legacy))).toEqual([legacy]);
	});

	test("reads a pairing array", () => {
		const devices = [board("user-1", "uuid-1"), board("user-1", "uuid-2")];
		expect(parseDeviceList(JSON.stringify(devices))).toEqual(devices);
	});

	test("returns empty for missing records", () => {
		expect(parseDeviceList(null)).toEqual([]);
	});

	test("treats a missing label as empty", () => {
		const raw = board("user-1", "uuid-1");
		const { label: _label, ...legacy } = raw;
		expect(parseDeviceList(JSON.stringify(legacy))[0]?.label).toBe("");
	});

	test("treats a missing bleMac as empty", () => {
		const raw = board("user-1", "uuid-1");
		const { bleMac: _bleMac, ...legacy } = raw;
		expect(parseDeviceList(JSON.stringify(legacy))[0]?.bleMac).toBe("");
	});

	test("normalizes a stored bluetooth address", () => {
		const raw = board("user-1", "uuid-1", { bleMac: "aa-bb-cc-dd-ee-ff" });
		expect(parseDeviceList(JSON.stringify(raw))[0]?.bleMac).toBe(
			"AA:BB:CC:DD:EE:FF",
		);
	});

	test("drops an invalid stored bluetooth address", () => {
		const raw = board("user-1", "uuid-1", { bleMac: "not-a-mac" });
		expect(parseDeviceList(JSON.stringify(raw))[0]?.bleMac).toBe("");
	});
});

describe("normalizeBleMac", () => {
	test("normalizes colon, dash, and bare hex", () => {
		expect(normalizeBleMac("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
		expect(normalizeBleMac("AA-BB-CC-DD-EE-FF")).toBe("AA:BB:CC:DD:EE:FF");
		expect(normalizeBleMac("aabbccddeeff")).toBe("AA:BB:CC:DD:EE:FF");
		expect(normalizeBleMac("")).toBe("");
	});

	test("rejects non-mac values", () => {
		expect(() => normalizeBleMac("not-a-mac")).toThrow(
			"invalid bluetooth address",
		);
		expect(() =>
			normalizeBleMac("a1c15e00-6f10-4c9a-9c31-47b0c15e0001"),
		).toThrow("invalid bluetooth address");
	});
});

describe("pairing store", () => {
	test("migrates a legacy object to an array on load", async () => {
		const kv = memoryKv();
		const legacy = board("user-1", "uuid-1");
		await kv.put("device:user-1", JSON.stringify(legacy));
		const devices = await loadDevices(kv, "user-1");
		expect(devices).toEqual([legacy]);
		expect(JSON.parse((await kv.get("device:user-1")) as string)).toEqual([
			legacy,
		]);
	});

	test("upsert keeps an existing board when pairing a second", async () => {
		const kv = memoryKv();
		const first = board("user-1", "uuid-1");
		const second = board("user-1", "uuid-2");
		await upsertDevice(kv, first);
		await upsertDevice(kv, second);
		expect(await loadDevices(kv, "user-1")).toEqual([first, second]);
		expect(await kv.get("pair:uuid-1")).toBe("user-1");
		expect(await kv.get("pair:uuid-2")).toBe("user-1");
		expect(await isPairedUuid(kv, "uuid-1")).toBe(true);
		expect(await isPairedUuid(kv, "missing")).toBe(false);
		expect(await isPairedUuid(kv, "")).toBe(false);
	});

	test("upsert replaces the same uuid in place", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1"));
		const updated = board("user-1", "uuid-1", { key: "rotated" });
		await upsertDevice(kv, updated);
		expect(await loadDevices(kv, "user-1")).toEqual([updated]);
	});

	test("updateDeviceLabel is owner-only and truncates", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1"));
		const named = await updateDeviceLabel(
			kv,
			"user-1",
			"uuid-1",
			`  bench ${"x".repeat(50)}  `,
		);
		expect(named.label).toBe(`bench ${"x".repeat(34)}`);
		expect((await loadDevices(kv, "user-1"))[0]?.label).toBe(named.label);
		await expect(
			updateDeviceLabel(kv, "user-2", "uuid-1", "stolen"),
		).rejects.toThrow("pair a device first");
	});

	test("updateDeviceFields sets bleMac without clobbering label", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1", { label: "bench" }));
		const linked = await updateDeviceFields(kv, "user-1", "uuid-1", {
			bleMac: "aa:bb:cc:dd:ee:ff",
		});
		expect(linked.label).toBe("bench");
		expect(linked.bleMac).toBe("AA:BB:CC:DD:EE:FF");
		const cleared = await updateDeviceFields(kv, "user-1", "uuid-1", {
			bleMac: "",
		});
		expect(cleared.label).toBe("bench");
		expect(cleared.bleMac).toBe("");
		await expect(
			updateDeviceFields(kv, "user-1", "uuid-1", {}),
		).rejects.toThrow("label or bleMac is required");
		await expect(
			updateDeviceFields(kv, "user-1", "uuid-1", { bleMac: "chrome-id" }),
		).rejects.toThrow("invalid bluetooth address");
	});

	test("removeDevice drops one board and leaves the rest", async () => {
		const kv = memoryKv();
		const first = board("user-1", "uuid-1");
		const second = board("user-1", "uuid-2");
		await upsertDevice(kv, first);
		await upsertDevice(kv, second);
		expect(await removeDevice(kv, "user-1", "uuid-1")).toEqual(first);
		expect(await loadDevices(kv, "user-1")).toEqual([second]);
		expect(await kv.get("pair:uuid-1")).toBeNull();
		expect(await kv.get("pair:uuid-2")).toBe("user-1");
	});

	test("transfer moves one uuid without wiping the owner's other boards", async () => {
		const kv = memoryKv();
		const keep = board("owner", "keep-uuid");
		const move = board("owner", "move-uuid", {
			label: "bench",
			bleMac: "AA:BB:CC:DD:EE:FF",
		});
		await upsertDevice(kv, keep);
		await upsertDevice(kv, move);
		await kv.put(
			"pending:move-uuid",
			JSON.stringify({ uuid: "move-uuid", requesterId: "requester" }),
		);
		await kv.put("inbox:owner", JSON.stringify(["move-uuid"]));
		const transferred = await transferDeviceRecord(kv, move, {
			userId: "requester",
			email: "req@gpio-companion.com",
			login: "req",
		});
		expect(transferred.label).toBe("bench");
		expect(transferred.bleMac).toBe("AA:BB:CC:DD:EE:FF");
		expect(transferred.userId).toBe("requester");
		expect(await loadDevices(kv, "owner")).toEqual([keep]);
		expect(await loadDevices(kv, "requester")).toEqual([transferred]);
		expect(await kv.get("pair:move-uuid")).toBe("requester");
		expect(await kv.get("pair:keep-uuid")).toBe("owner");
		expect(await kv.get("pending:move-uuid")).toBeNull();
		expect(await kv.get("inbox:owner")).toBeNull();
	});

	test("findDeviceByUuid and admin label use the owner index", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("owner", "uuid-1"));
		await upsertDevice(kv, board("owner", "uuid-2"));
		expect(await findDeviceByUuid(kv, "uuid-1")).toEqual(
			board("owner", "uuid-1"),
		);
		await expect(findDeviceByUuid(kv, "missing")).rejects.toThrow(
			"device is not paired with this account",
		);
		const named = await updateDeviceLabelByUuid(kv, "uuid-1", "lab pi");
		expect(named.label).toBe("lab pi");
		expect(
			(await loadDevices(kv, "owner")).find((item) => item.uuid === "uuid-1")
				?.label,
		).toBe("lab pi");
		expect(await loadDevices(kv, "owner")).toHaveLength(2);
	});

	test("clearPendingForUuid drops inbox entries for one board", async () => {
		const kv = memoryKv();
		await kv.put("pending:uuid-1", "{}");
		await kv.put("inbox:owner", JSON.stringify(["uuid-1", "uuid-2"]));
		await clearPendingForUuid(kv, "uuid-1", "owner");
		expect(await kv.get("pending:uuid-1")).toBeNull();
		expect(JSON.parse((await kv.get("inbox:owner")) as string)).toEqual([
			"uuid-2",
		]);
	});
});

describe("requireOwnedDevice", () => {
	test("refuses when the user has no paired boards", async () => {
		const kv = memoryKv();
		await expect(requireOwnedDevice(kv, "user-1", "uuid-1")).rejects.toThrow(
			"pair a device first",
		);
	});

	test("refuses a uuid that is not paired with the user", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1"));
		await expect(requireOwnedDevice(kv, "user-1", "uuid-2")).rejects.toThrow(
			"device is not paired with this account",
		);
	});

	test("refuses when the pair index owner mismatches", async () => {
		const kv = memoryKv();
		const owned = board("user-1", "uuid-1");
		await upsertDevice(kv, owned);
		await kv.put("pair:uuid-1", "other-user");
		await expect(requireOwnedDevice(kv, "user-1", "uuid-1")).rejects.toThrow(
			"device is not paired with this account",
		);
	});

	test("returns the paired board when uuid and owner match", async () => {
		const kv = memoryKv();
		const owned = board("user-1", "uuid-1");
		await upsertDevice(kv, owned);
		expect(await requireOwnedDevice(kv, "user-1", "uuid-1")).toEqual(owned);
	});

	test("picks the only board when uuid is omitted", async () => {
		const kv = memoryKv();
		const owned = board("user-1", "uuid-1");
		await upsertDevice(kv, owned);
		expect(await requireOwnedDevice(kv, "user-1")).toEqual(owned);
	});

	test("requires uuid when more than one board is paired", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1"));
		await upsertDevice(kv, board("user-1", "uuid-2"));
		await expect(requireOwnedDevice(kv, "user-1")).rejects.toThrow(
			"uuid is required",
		);
	});
});

describe("wifi sign gate", () => {
	test("does not allow signing for an unpaired uuid", async () => {
		const { parseWifiConfig } = await import("gpio-companion");
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "uuid-1"));
		const wifi = parseWifiConfig({
			uuid: "uuid-2",
			ssid: "lab",
			psk: "secret",
		});
		await expect(requireOwnedDevice(kv, "user-1", wifi.uuid)).rejects.toThrow(
			"device is not paired with this account",
		);
	});

	test("allows signing for a uuid paired to the user", async () => {
		const { parseWifiConfig } = await import("gpio-companion");
		const kv = memoryKv();
		const owned = board("user-1", "uuid-1");
		await upsertDevice(kv, owned);
		const wifi = parseWifiConfig({
			uuid: "uuid-1",
			ssid: "lab",
			psk: "secret",
		});
		expect(await requireOwnedDevice(kv, "user-1", wifi.uuid)).toEqual(owned);
	});
});

describe("requireAccessibleDevice", () => {
	test("lets an owner reach their own board", async () => {
		const kv = memoryKv();
		const owned = board("user-1", "uuid-1");
		await upsertDevice(kv, owned);
		expect(
			await requireAccessibleDevice(
				kv,
				{ id: "user-1", role: "user" },
				"uuid-1",
			),
		).toEqual(owned);
	});

	test("refuses another account's board for a user", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("user-1", "own-uuid"));
		await upsertDevice(kv, board("owner", "uuid-1"));
		await expect(
			requireAccessibleDevice(kv, { id: "user-1", role: "user" }, "uuid-1"),
		).rejects.toThrow("device is not paired with this account");
	});

	test("lets an admin reach another account's board", async () => {
		const kv = memoryKv();
		const owned = board("owner", "uuid-1");
		await upsertDevice(kv, owned);
		expect(
			await requireAccessibleDevice(
				kv,
				{ id: "admin-1", role: "admin" },
				"uuid-1",
			),
		).toEqual(owned);
	});

	test("still requires uuid for an admin when omitted", async () => {
		const kv = memoryKv();
		await upsertDevice(kv, board("owner", "uuid-1"));
		await expect(
			requireAccessibleDevice(kv, { id: "admin-1", role: "admin" }),
		).rejects.toThrow("pair a device first");
	});
});

describe("listAllDevices", () => {
	test("returns every account's boards without exposing a missing list", async () => {
		const kv = memoryKv();
		const first = board("user-1", "uuid-1");
		const second = board("user-2", "uuid-2", {
			login: "bob",
			email: "bob@gpio-companion.com",
		});
		await upsertDevice(kv, first);
		await upsertDevice(kv, second);
		expect(await listAllDevices(kv)).toEqual([first, second]);
		expect(publicPairing(first)).not.toHaveProperty("key");
		expect(publicPairing(first)).toMatchObject({ bleMac: "" });
	});
});
