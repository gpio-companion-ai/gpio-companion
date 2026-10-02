import { describe, expect, test } from "bun:test";
import {
	boxDimensions,
	buildEasyShipItems,
	centsFromAmount,
	easyshipConfigured,
	easyshipOrigin,
	mapEasyShipRate,
	validateEasyShipDestination,
} from "./easyship";

describe("easyship environment", () => {
	const base = {
		EASYSHIP_API_TOKEN: "prod_abc",
		EASYSHIP_ORIGIN_LINE1: "1 Bench Rd",
		EASYSHIP_ORIGIN_CITY: "Austin",
		EASYSHIP_ORIGIN_REGION: "TX",
		EASYSHIP_ORIGIN_POSTAL_CODE: "78701",
		EASYSHIP_ORIGIN_COUNTRY: "us",
	};

	test("requires token and complete origin", () => {
		expect(easyshipConfigured(base)).toBe(true);
		expect(easyshipConfigured({ ...base, EASYSHIP_API_TOKEN: "" })).toBe(false);
		expect(easyshipConfigured({ ...base, EASYSHIP_ORIGIN_CITY: "  " })).toBe(false);
	});

	test("normalizes the origin country", () => {
		expect(easyshipOrigin(base)?.country).toBe("US");
		expect(easyshipOrigin({ ...base, EASYSHIP_ORIGIN_COUNTRY: "" })).toBeNull();
	});
});

describe("easyship rates", () => {
	test("converts decimal amounts to integer cents", () => {
		expect(centsFromAmount(158)).toBe(15800);
		expect(centsFromAmount(12.345)).toBe(1235);
		expect(() => centsFromAmount(-1)).toThrow();
		expect(() => centsFromAmount(undefined)).toThrow();
	});

	test("maps a rate and drops entries without a courier service", () => {
		const option = mapEasyShipRate({
			courier_service: { id: "abc", name: "DHL - Express", umbrella_name: "DHL" },
			currency: "USD",
			total_charge: 24.5,
			min_delivery_time: 2,
			max_delivery_time: 5,
			full_description: "DHL - Express (2-5 working days)",
		});
		expect(option).toEqual({
			id: "abc",
			courierName: "DHL - Express",
			totalCents: 2450,
			minDays: 2,
			maxDays: 5,
			description: "DHL - Express (2-5 working days)",
		});
		expect(mapEasyShipRate({} as never)).toBeNull();
	});

	test("rejects non-USD rates", () => {
		expect(() =>
			mapEasyShipRate({
				courier_service: { id: "abc" },
				currency: "HKD",
				total_charge: 10,
			} as never),
		).toThrow("unsupported currency");
	});
});

describe("easyship parcels", () => {
	const product = (overrides: Partial<{
		id: string;
		weightGrams: number | null;
		lengthCm: number | null;
		widthCm: number | null;
		heightCm: number | null;
	}> = {}) => ({
		id: "prd_1",
		weightGrams: 850,
		lengthCm: 30,
		widthCm: 20,
		heightCm: 10,
		...overrides,
	});
	const line = {
		productId: "prd_1",
		sku: "KIT-1",
		nameEn: "Starter kit",
		quantity: 2,
		unitPriceCents: 4999,
	};

	test("builds items with weight and dims from the product", () => {
		const items = buildEasyShipItems([line], [product()]);
		expect(items).toHaveLength(1);
		expect(items[0]?.weightGrams).toBe(850);
		expect(items[0]?.quantity).toBe(2);
		expect(items[0]?.unitValueCents).toBe(4999);
	});

	test("fails closed when a product has no shipping weight", () => {
		expect(() =>
			buildEasyShipItems([line], [product({ weightGrams: null })]),
		).toThrow("Shipping weight is not configured for: KIT-1");
	});

	test("takes the largest product dimensions as the box", () => {
		const items = buildEasyShipItems(
			[line, { ...line, productId: "prd_2", sku: "KIT-2" }],
			[product(), product({ id: "prd_2", lengthCm: 40, widthCm: 15, heightCm: 12 })],
		);
		expect(boxDimensions(items)).toEqual({ length: 40, width: 20, height: 12 });
	});

	test("returns null box when no product has full dimensions", () => {
		const items = buildEasyShipItems([line], [product({ lengthCm: null })]);
		expect(boxDimensions(items)).toBeNull();
	});
});

describe("easyship destination", () => {
	test("requires a region only for region-mandatory countries", () => {
		expect(() =>
			validateEasyShipDestination({
				line1: "1 Main St",
				city: "Austin",
				postalCode: "78701",
				country: "US",
			}),
		).toThrow("Region/state is required");
		expect(() =>
			validateEasyShipDestination({
				line1: "1 Rue de Rivoli",
				city: "Paris",
				postalCode: "75001",
				country: "FR",
			}),
		).not.toThrow();
		expect(() =>
			validateEasyShipDestination({
				line1: "1 Main St",
				city: "Austin",
				region: "TX",
				postalCode: "",
				country: "US",
			}),
		).toThrow("Postal code is required");
	});
});
