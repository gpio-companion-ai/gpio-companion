import { describe, expect, test } from "bun:test";
import {
	type AddressSession,
	handleAddressRead,
	handleAddressSave,
	shippingAddressKey,
} from "./address.ts";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

function memorySession(
	initial?: unknown,
): AddressSession & { publicData: unknown } {
	const state = { publicData: initial ?? { name: "Ada" } };
	return {
		publicData: state.publicData,
		async read() {
			return state.publicData;
		},
		async write(address) {
			state.publicData = { ...(state.publicData as object), address };
			this.publicData = state.publicData;
		},
	};
}

describe("profile address", () => {
	test("saves the shipping shape on the public session and drops email", async () => {
		const session = memorySession();
		const saved = await handleAddressSave({
			session,
			userId: "user-1",
			body: {
				name: " Ada Lovelace ",
				line1: "1 Analytical",
				line2: "",
				city: "London",
				region: " ",
				postalCode: "SW1",
				country: "GB",
				email: "ada@example.com",
			},
		});
		expect(saved.address).toEqual({
			name: "Ada Lovelace",
			line1: "1 Analytical",
			line2: null,
			city: "London",
			region: null,
			postalCode: "SW1",
			country: "GB",
		});
		expect(JSON.stringify(session.publicData)).not.toContain("email");
		expect(JSON.stringify(session.publicData)).toContain("Ada Lovelace");
		expect(await handleAddressRead({ session, userId: "user-1" })).toEqual(
			saved,
		);
	});

	test("moves a legacy KV address into the public session", async () => {
		const store = new MemoryKv();
		store.store.set(
			shippingAddressKey("user-1"),
			JSON.stringify({
				name: "Ada Lovelace",
				line1: "1 Analytical",
				city: "London",
				postalCode: "SW1",
				country: "GB",
			}),
		);
		const session = memorySession();
		const read = await handleAddressRead({
			session,
			kv: store as unknown as KVNamespace,
			userId: "user-1",
		});
		expect(read.address?.name).toBe("Ada Lovelace");
		expect(store.store.has(shippingAddressKey("user-1"))).toBe(false);
		expect(JSON.stringify(session.publicData)).toContain("1 Analytical");
	});

	test("missing address is empty, not an error", async () => {
		const session = memorySession();
		expect(await handleAddressRead({ session, userId: "user-1" })).toEqual({
			address: null,
		});
	});
});
