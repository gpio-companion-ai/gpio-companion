import { describe, expect, test } from "bun:test";
import { classifyReplay } from "./idempotency";
import { generateCommerceId, generateOrderIdentity } from "./identifiers";
import { getStarterKitSeed } from "./seed";
import {
	availableInventory,
	calculateCartTotals,
	selectShippingRate,
} from "./totals";
import {
	MAX_CART_QUANTITY,
	validateCartInput,
	validateProductPublication,
} from "./validation";

describe("cart input validation", () => {
	test("accepts unique commerce and UUID product IDs", () => {
		expect(
			validateCartInput([
				{ productId: "prd_0123456789abcdef0123456789abcdef", quantity: 1 },
				{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: 2 },
			]),
		).toHaveLength(2);
	});

	test("rejects malformed, duplicate, fractional, and excessive quantities", () => {
		expect(() => validateCartInput([])).toThrow();
		expect(() =>
			validateCartInput([{ productId: "not-an-id", quantity: 1 }]),
		).toThrow();
		expect(() =>
			validateCartInput([
				{ productId: "prd_0123456789abcdef0123456789abcdef", quantity: 1 },
				{ productId: "prd_0123456789abcdef0123456789abcdef", quantity: 1 },
			]),
		).toThrow();
		expect(() =>
			validateCartInput([
				{ productId: "prd_0123456789abcdef0123456789abcdef", quantity: 1.5 },
			]),
		).toThrow();
		expect(() =>
			validateCartInput([
				{
					productId: "prd_0123456789abcdef0123456789abcdef",
					quantity: MAX_CART_QUANTITY + 1,
				},
			]),
		).toThrow();
	});
});

describe("authoritative totals and shipping", () => {
	test("uses integer cents and balances totals", () => {
		expect(
			calculateCartTotals(
				[
					{ unitPriceCents: 1299, quantity: 2 },
					{ unitPriceCents: 25, quantity: 3 },
				],
				500,
				213,
			),
		).toEqual({
			subtotalCents: 2673,
			shippingCents: 500,
			taxCents: 213,
			totalCents: 3386,
		});
		expect(() =>
			calculateCartTotals([{ unitPriceCents: 100, quantity: 1.5 }], 0),
		).toThrow();
	});

	test("prefers a regional rate and falls back to the country rate", () => {
		const rates = [
			{ id: "default", country: "US", region: null, flatCents: 900 },
			{ id: "ca", country: "US", region: "CA", flatCents: 700 },
		];
		expect(selectShippingRate(rates, "us", "ca")?.id).toBe("ca");
		expect(selectShippingRate(rates, "US", "NY")?.id).toBe("default");
		expect(selectShippingRate(rates, "CA", null)).toBeNull();
	});

	test("never reports negative availability", () => {
		expect(availableInventory(8, 3)).toBe(5);
		expect(availableInventory(2, 3)).toBe(0);
	});
});

describe("publication gates", () => {
	const complete = {
		slug: "starter-kit",
		sku: "STARTER-KIT",
		nameEn: "Starter kit",
		nameFr: "Kit de demarrage",
		descriptionEn: "Everything needed to begin.",
		descriptionFr: "Tout le necessaire pour commencer.",
		priceCents: 100,
		weightGrams: 850,
		dimensionsConfigured: true,
		imageCount: 1,
		inventoryConfigured: true,
	};

	test("allows a complete product", () => {
		expect(validateProductPublication(complete)).toEqual([]);
	});

	test("reports every missing publish requirement", () => {
		const errors = validateProductPublication({
			...complete,
			slug: "Bad Slug",
			sku: "bad sku",
			nameFr: "",
			descriptionEn: "",
			priceCents: null,
			weightGrams: null,
			dimensionsConfigured: false,
			imageCount: 0,
			inventoryConfigured: false,
		});
		expect(errors).toHaveLength(9);
	});

	test("rejects zero or negative shipping weight", () => {
		expect(
			validateProductPublication({ ...complete, weightGrams: 0 }),
		).toContain("A positive shipping weight in grams is required");
		expect(
			validateProductPublication({ ...complete, dimensionsConfigured: false }),
		).toContain("Package dimensions (length, width, height) are required");
	});
});

describe("replay safety and identifiers", () => {
	test("classifies exact replay separately from conflicting reuse", () => {
		expect(classifyReplay(null, { id: "a", quantity: 1 })).toBe("new");
		expect(
			classifyReplay({ id: "a", quantity: 1 }, { id: "a", quantity: 1 }),
		).toBe("replay");
		expect(
			classifyReplay({ id: "a", quantity: 1 }, { id: "a", quantity: 2 }),
		).toBe("conflict");
	});

	test("generates Web Crypto commerce and order identities", () => {
		const first = generateCommerceId("prd");
		const second = generateCommerceId("prd");
		expect(first).toMatch(/^prd_[0-9a-f]{32}$/);
		expect(second).not.toBe(first);
		expect(generateOrderIdentity(new Date("2026-09-18T00:00:00Z"))).toEqual({
			id: expect.stringMatching(/^ord_[0-9a-f]{32}$/),
			orderNumber: expect.stringMatching(/^GC-20260918-[0-9A-F]{10}$/),
		});
	});
});

test("starter kit stays draft without invented commercial data", () => {
	const seed = getStarterKitSeed();
	expect(seed.product.status).toBe("draft");
	expect(seed.product.priceCents).toBeNull();
	expect(seed.inventory).toBeNull();
	expect(seed.images).toEqual([]);
	expect(seed.contents).toEqual([
		"Configured gpio-companion board and power supply",
		"Breadboard",
		"LED",
		"220 ohm to 1 kohm resistor",
		"Two jumper wires",
	]);
});
