import { describe, expect, test } from "bun:test";
import {
	buildInsertSql,
	escapeSql,
	generateProductId,
	normalizeKitInput,
} from "./kit-add";

const valid = {
	slug: "base-opi-3lts",
	sku: "001",
	nameEn: "gpio-companion base kit - Orange Pi 3 LTS",
	nameFr: "Kit de base gpio-companion - Orange Pi 3 LTS",
	descriptionEn: "Base kit: board and microSD card.",
	descriptionFr: "Kit de base : carte et carte microSD.",
	priceCents: null,
};

describe("normalizeKitInput", () => {
	test("normalizes slug, SKU, and trims text", () => {
		const kit = normalizeKitInput({
			...valid,
			slug: "  Base-OPI-3lts ",
			sku: "  001 ",
			nameEn: "  Trimmed name ",
		});
		expect(kit.slug).toBe("base-opi-3lts");
		expect(kit.sku).toBe("001");
		expect(kit.nameEn).toBe("Trimmed name");
		expect(kit.priceCents).toBeNull();
		expect(kit.weightGrams).toBeNull();
	});

	test("keeps a locked non-negative price", () => {
		const kit = normalizeKitInput({ ...valid, priceCents: 9500 });
		expect(kit.priceCents).toBe(9500);
	});

	test("rejects invalid slug and SKU formats", () => {
		expect(() => normalizeKitInput({ ...valid, slug: "Bad Slug" })).toThrow(
			"Slug is invalid",
		);
		expect(() => normalizeKitInput({ ...valid, sku: "bad sku" })).toThrow(
			"SKU is invalid",
		);
	});

	test("rejects missing copy and bad prices", () => {
		expect(() => normalizeKitInput({ ...valid, nameFr: "  " })).toThrow(
			"nameFr is required",
		);
		expect(() => normalizeKitInput({ ...valid, priceCents: -1 })).toThrow(
			"priceCents",
		);
		expect(() => normalizeKitInput({ ...valid, priceCents: 1.5 })).toThrow(
			"priceCents",
		);
	});

	test("rejects non-positive shipping fields", () => {
		expect(() => normalizeKitInput({ ...valid, weightGrams: 0 })).toThrow(
			"weightGrams",
		);
		expect(() => normalizeKitInput({ ...valid, lengthCm: -2 })).toThrow(
			"lengthCm",
		);
	});
});

describe("SQL building", () => {
	test("escapes single quotes", () => {
		expect(escapeSql("C'est la carte")).toBe("'C''est la carte'");
	});

	test("builds a draft insert with null price", () => {
		const sql = buildInsertSql(normalizeKitInput(valid), 1_000_000);
		expect(sql).toContain("'draft'");
		expect(sql).toContain("null, null, null, null, null, 'draft', 1000000");
		expect(sql).toContain("'base-opi-3lts'");
		expect(sql).toContain("'001'");
	});

	test("inlines a locked price", () => {
		const sql = buildInsertSql(
			normalizeKitInput({ ...valid, priceCents: 9500 }),
			1,
		);
		expect(sql).toContain(", 9500, null, null, null, null, 'draft'");
	});
});

test("generated product ids match the commerce id format", () => {
	const id = generateProductId();
	expect(id).toMatch(/^prd_[0-9a-f]{32}$/);
	expect(generateProductId()).not.toBe(id);
});
