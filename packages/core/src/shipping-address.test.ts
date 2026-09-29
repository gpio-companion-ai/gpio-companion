import { describe, expect, test } from "bun:test";
import {
	formatShippingAddress,
	shippingAddressFrom,
	validateShippingAddress,
} from "./shipping-address.ts";

describe("shipping address", () => {
	test("trims required fields and keeps optional lines empty as null", () => {
		expect(
			validateShippingAddress({
				name: " Ada Lovelace ",
				line1: " 1 Analytical ",
				line2: " ",
				city: " London ",
				region: "",
				postalCode: " SW1 ",
				country: " GB ",
			}),
		).toEqual({
			name: "Ada Lovelace",
			line1: "1 Analytical",
			line2: null,
			city: "London",
			region: null,
			postalCode: "SW1",
			country: "GB",
		});
	});

	test("uses the marketplace required-field errors", () => {
		expect(() => validateShippingAddress({ name: " " })).toThrow(
			"Full name is required",
		);
		expect(() =>
			validateShippingAddress({
				name: "Ada",
				line1: "1",
				city: "London",
				postalCode: "SW1",
			}),
		).toThrow("Country is required");
	});

	test("rejects a partial stored address", () => {
		expect(shippingAddressFrom({ name: "Ada" })).toBeNull();
		expect(shippingAddressFrom(null)).toBeNull();
	});

	test("formats a review block without inventing lines", () => {
		expect(
			formatShippingAddress({
				name: "Ada Lovelace",
				line1: "1 Analytical",
				line2: null,
				city: "London",
				region: null,
				postalCode: "SW1",
				country: "GB",
			}),
		).toBe("Ada Lovelace\n1 Analytical\nLondon SW1\nGB");
	});
});
