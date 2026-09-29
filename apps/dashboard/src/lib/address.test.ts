import { describe, expect, test } from "bun:test";
import {
	handleAddressRead,
	handleAddressSave,
	shippingAddressKey,
} from "./address.ts";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
}

describe("profile address", () => {
	test("saves the shipping shape and does not require email", async () => {
		const store = new MemoryKv() as unknown as KVNamespace & {
			store: Map<string, string>;
		};
		const saved = await handleAddressSave({
			kv: store,
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
		expect(store.store.get(shippingAddressKey("user-1"))).not.toContain(
			"email",
		);
		expect(await handleAddressRead({ kv: store, userId: "user-1" })).toEqual(
			saved,
		);
	});

	test("missing address is empty, not an error", async () => {
		const store = new MemoryKv() as unknown as KVNamespace;
		expect(await handleAddressRead({ kv: store, userId: "user-1" })).toEqual({
			address: null,
		});
	});
});
