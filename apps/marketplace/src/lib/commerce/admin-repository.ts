import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import type { CommerceDatabase } from "../db/client";
import {
	inventory,
	inventoryAdjustments,
	type PolicyStatus,
	type ProductStatus,
	policies,
	productImages,
	products,
	shippingRates,
} from "../db/schema";
import { generateCommerceId, unixNow } from "./identifiers";
import {
	assertCountryCode,
	normalizeRegion,
	validateProductPublication,
} from "./validation";

export interface ProductDraftInput {
	slug: string;
	sku: string;
	nameEn: string;
	nameFr: string;
	descriptionEn: string;
	descriptionFr: string;
	priceCents: number | null;
	weightGrams?: number | null;
	lengthCm?: number | null;
	widthCm?: number | null;
	heightCm?: number | null;
}

export interface ProductImageInput {
	r2Key: string;
	altEn: string;
	altFr: string;
	sortOrder: number;
}

export interface ShippingRateInput {
	country: string;
	region?: string | null;
	flatCents: number;
	active?: boolean;
}

export interface PolicyInput {
	slug: string;
	titleEn: string;
	titleFr: string;
	bodyEn: string;
	bodyFr: string;
}

function assertCents(value: number | null, nullable = false): void {
	if (value === null && nullable) return;
	if (value === null || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("Amount must be a non-negative integer number of cents");
	}
}

function assertPositiveAmount(
	value: number | null | undefined,
	label: string,
): void {
	if (value === null || value === undefined) return;
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
}

function normalizeProductInput(input: ProductDraftInput): ProductDraftInput {
	assertCents(input.priceCents, true);
	assertPositiveAmount(input.weightGrams, "Shipping weight");
	assertPositiveAmount(input.lengthCm, "Package length");
	assertPositiveAmount(input.widthCm, "Package width");
	assertPositiveAmount(input.heightCm, "Package height");
	return {
		slug: input.slug.trim().toLowerCase(),
		sku: input.sku.trim().toUpperCase(),
		nameEn: input.nameEn.trim(),
		nameFr: input.nameFr.trim(),
		descriptionEn: input.descriptionEn.trim(),
		descriptionFr: input.descriptionFr.trim(),
		priceCents: input.priceCents,
		weightGrams: input.weightGrams ?? null,
		lengthCm: input.lengthCm ?? null,
		widthCm: input.widthCm ?? null,
		heightCm: input.heightCm ?? null,
	};
}

function dimensionsConfigured(values: {
	lengthCm?: number | null;
	widthCm?: number | null;
	heightCm?: number | null;
}): boolean {
	return Boolean(values.lengthCm && values.widthCm && values.heightCm);
}

export async function listAdminProducts(db: CommerceDatabase) {
	return db
		.select()
		.from(products)
		.orderBy(asc(products.nameEn), asc(products.id));
}

export async function getAdminProduct(db: CommerceDatabase, id: string) {
	const [product] = await db
		.select()
		.from(products)
		.where(eq(products.id, id))
		.limit(1);
	if (!product) return null;
	const [images, stock] = await Promise.all([
		db
			.select()
			.from(productImages)
			.where(eq(productImages.productId, id))
			.orderBy(asc(productImages.sortOrder), asc(productImages.id)),
		db.select().from(inventory).where(eq(inventory.productId, id)).limit(1),
	]);
	return { ...product, images, inventory: stock[0] ?? null };
}

export async function createProduct(
	db: CommerceDatabase,
	input: ProductDraftInput,
) {
	const now = unixNow();
	const product = {
		id: generateCommerceId("prd"),
		...normalizeProductInput(input),
		status: "draft" as const,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(products).values(product);
	return product;
}

export async function updateProduct(
	db: CommerceDatabase,
	id: string,
	input: ProductDraftInput,
) {
	const values = { ...normalizeProductInput(input), updatedAt: unixNow() };
	const [current] = await db
		.select({ status: products.status })
		.from(products)
		.where(eq(products.id, id))
		.limit(1);
	if (!current) return null;
	if (current.status === "published") {
		const [[imageResult], [stock]] = await Promise.all([
			db
				.select({ value: count() })
				.from(productImages)
				.where(eq(productImages.productId, id)),
			db.select().from(inventory).where(eq(inventory.productId, id)).limit(1),
		]);
		const errors = validateProductPublication({
			...values,
			weightGrams: values.weightGrams ?? null,
			dimensionsConfigured: dimensionsConfigured(values),
			imageCount: imageResult?.value ?? 0,
			inventoryConfigured: stock !== undefined,
		});
		if (errors.length > 0) throw new Error(errors.join("; "));
	}
	const [updated] = await db
		.update(products)
		.set(values)
		.where(eq(products.id, id))
		.returning();
	return updated ?? null;
}

export async function deleteProduct(
	db: CommerceDatabase,
	id: string,
): Promise<boolean> {
	const deleted = await db
		.delete(products)
		.where(and(eq(products.id, id), eq(products.status, "draft")))
		.returning({ id: products.id });
	return deleted.length === 1;
}

export async function setProductStatus(
	db: CommerceDatabase,
	id: string,
	status: ProductStatus,
) {
	const [product] = await db
		.select()
		.from(products)
		.where(eq(products.id, id))
		.limit(1);
	if (!product) return null;
	if (status === "published") {
		const [[imageResult], [stock]] = await Promise.all([
			db
				.select({ value: count() })
				.from(productImages)
				.where(eq(productImages.productId, id)),
			db.select().from(inventory).where(eq(inventory.productId, id)).limit(1),
		]);
		const errors = validateProductPublication({
			...product,
			dimensionsConfigured: dimensionsConfigured(product),
			imageCount: imageResult?.value ?? 0,
			inventoryConfigured: stock !== undefined,
		});
		if (errors.length > 0) throw new Error(errors.join("; "));
	}

	const now = unixNow();
	const [updated] = await db
		.update(products)
		.set({
			status,
			updatedAt: now,
			publishedAt: status === "published" ? (product.publishedAt ?? now) : null,
		})
		.where(eq(products.id, id))
		.returning();
	return updated ?? null;
}

export async function listProductImages(
	db: CommerceDatabase,
	productId: string,
) {
	return db
		.select()
		.from(productImages)
		.where(eq(productImages.productId, productId))
		.orderBy(asc(productImages.sortOrder), asc(productImages.id));
}

export async function getProductImage(db: CommerceDatabase, id: string) {
	const [image] = await db
		.select()
		.from(productImages)
		.where(eq(productImages.id, id))
		.limit(1);
	return image ?? null;
}

export async function addProductImage(
	db: CommerceDatabase,
	productId: string,
	input: ProductImageInput,
) {
	if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0) {
		throw new Error("Image sort order must be a non-negative integer");
	}
	const image = {
		id: generateCommerceId("img"),
		productId,
		r2Key: input.r2Key.trim(),
		altEn: input.altEn.trim(),
		altFr: input.altFr.trim(),
		sortOrder: input.sortOrder,
		createdAt: unixNow(),
	};
	if (!image.r2Key || !image.altEn || !image.altFr) {
		throw new Error("R2 key and bilingual alt text are required");
	}
	await db.insert(productImages).values(image);
	return image;
}

export async function updateProductImage(
	db: CommerceDatabase,
	id: string,
	input: ProductImageInput,
) {
	if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0) {
		throw new Error("Image sort order must be a non-negative integer");
	}
	if (!input.r2Key.trim() || !input.altEn.trim() || !input.altFr.trim()) {
		throw new Error("R2 key and bilingual alt text are required");
	}
	const [updated] = await db
		.update(productImages)
		.set({
			r2Key: input.r2Key.trim(),
			altEn: input.altEn.trim(),
			altFr: input.altFr.trim(),
			sortOrder: input.sortOrder,
		})
		.where(eq(productImages.id, id))
		.returning();
	return updated ?? null;
}

export async function deleteProductImage(
	db: CommerceDatabase,
	id: string,
): Promise<boolean> {
	const deleted = await db
		.delete(productImages)
		.where(
			and(
				eq(productImages.id, id),
				sql`exists (select 1 from ${products} where ${products.id} = ${productImages.productId} and ${products.status} <> 'published')`,
			),
		)
		.returning({ id: productImages.id });
	return deleted.length === 1;
}

export async function configureInventory(
	db: CommerceDatabase,
	productId: string,
	onHand: number,
) {
	if (!Number.isSafeInteger(onHand) || onHand < 0) {
		throw new Error("On-hand inventory must be a non-negative integer");
	}
	const now = unixNow();
	const [row] = await db
		.insert(inventory)
		.values({ productId, onHand, reserved: 0, updatedAt: now })
		.onConflictDoUpdate({
			target: inventory.productId,
			set: { onHand, updatedAt: now },
			setWhere: gte(sql`${onHand}`, inventory.reserved),
		})
		.returning();
	if (!row)
		throw new Error(
			"On-hand inventory cannot be lower than reserved inventory",
		);
	return row;
}

export async function adjustInventory(
	db: CommerceDatabase,
	input: {
		productId: string;
		delta: number;
		reason: string;
		referenceId?: string | null;
		actorId?: string | null;
	},
) {
	if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
		throw new Error("Inventory adjustment must be a non-zero integer");
	}
	if (!input.reason.trim())
		throw new Error("Inventory adjustment reason is required");
	const id = generateCommerceId("adj");
	const now = unixNow();
	const candidate = db
		.select({
			id: sql<string>`${id}`.as("id"),
			productId: inventory.productId,
			delta: sql<number>`${input.delta}`.as("delta"),
			reason: sql<string>`${input.reason.trim()}`.as("reason"),
			referenceId: sql<string | null>`${input.referenceId ?? null}`.as(
				"reference_id",
			),
			actorId: sql<string | null>`${input.actorId ?? null}`.as("actor_id"),
			createdAt: sql<number>`${now}`.as("created_at"),
		})
		.from(inventory)
		.where(
			and(
				eq(inventory.productId, input.productId),
				gte(sql`${inventory.onHand} + ${input.delta}`, inventory.reserved),
			),
		);
	await db.batch([
		db.insert(inventoryAdjustments).select(candidate),
		db
			.update(inventory)
			.set({
				onHand: sql`${inventory.onHand} + ${input.delta}`,
				updatedAt: now,
			})
			.where(
				and(
					eq(inventory.productId, input.productId),
					sql`exists (select 1 from ${inventoryAdjustments} where ${inventoryAdjustments.id} = ${id})`,
				),
			),
	]);
	const [adjustment] = await db
		.select()
		.from(inventoryAdjustments)
		.where(eq(inventoryAdjustments.id, id))
		.limit(1);
	if (!adjustment)
		throw new Error("Inventory adjustment would make stock invalid");
	return adjustment;
}

export async function listInventoryLevels(db: CommerceDatabase) {
	return db
		.select({
			productId: inventory.productId,
			sku: products.sku,
			nameEn: products.nameEn,
			onHand: inventory.onHand,
			reserved: inventory.reserved,
		})
		.from(inventory)
		.innerJoin(products, eq(products.id, inventory.productId))
		.orderBy(asc(products.sku));
}

export async function listInventoryAdjustments(
	db: CommerceDatabase,
	productId?: string,
) {
	if (productId) {
		return db
			.select()
			.from(inventoryAdjustments)
			.where(eq(inventoryAdjustments.productId, productId))
			.orderBy(
				desc(inventoryAdjustments.createdAt),
				desc(inventoryAdjustments.id),
			)
			.limit(100);
	}
	return db
		.select()
		.from(inventoryAdjustments)
		.orderBy(
			desc(inventoryAdjustments.createdAt),
			desc(inventoryAdjustments.id),
		)
		.limit(100);
}

export async function listShippingRates(db: CommerceDatabase) {
	return db
		.select()
		.from(shippingRates)
		.orderBy(asc(shippingRates.country), asc(shippingRates.region));
}

export async function createShippingRate(
	db: CommerceDatabase,
	input: ShippingRateInput,
) {
	assertCents(input.flatCents);
	const now = unixNow();
	const rate = {
		id: generateCommerceId("shr"),
		country: assertCountryCode(input.country),
		region: normalizeRegion(input.region),
		flatCents: input.flatCents,
		active: input.active ?? true,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(shippingRates).values(rate);
	return rate;
}

export async function updateShippingRate(
	db: CommerceDatabase,
	id: string,
	input: ShippingRateInput,
) {
	assertCents(input.flatCents);
	const [updated] = await db
		.update(shippingRates)
		.set({
			country: assertCountryCode(input.country),
			region: normalizeRegion(input.region),
			flatCents: input.flatCents,
			active: input.active ?? true,
			updatedAt: unixNow(),
		})
		.where(eq(shippingRates.id, id))
		.returning();
	return updated ?? null;
}

export async function deleteShippingRate(
	db: CommerceDatabase,
	id: string,
): Promise<boolean> {
	const deleted = await db
		.delete(shippingRates)
		.where(eq(shippingRates.id, id))
		.returning({ id: shippingRates.id });
	return deleted.length === 1;
}

export async function listPolicies(db: CommerceDatabase) {
	return db.select().from(policies).orderBy(asc(policies.slug));
}

export async function createPolicy(db: CommerceDatabase, input: PolicyInput) {
	const now = unixNow();
	const policy = {
		id: generateCommerceId("pol"),
		slug: input.slug.trim().toLowerCase(),
		titleEn: input.titleEn.trim(),
		titleFr: input.titleFr.trim(),
		bodyEn: input.bodyEn.trim(),
		bodyFr: input.bodyFr.trim(),
		status: "draft" as const,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(policies).values(policy);
	return policy;
}

export async function updatePolicy(
	db: CommerceDatabase,
	id: string,
	input: PolicyInput,
) {
	const [current] = await db
		.select({ status: policies.status })
		.from(policies)
		.where(eq(policies.id, id))
		.limit(1);
	if (!current) return null;
	if (
		current.status === "published" &&
		(!input.titleEn.trim() ||
			!input.titleFr.trim() ||
			!input.bodyEn.trim() ||
			!input.bodyFr.trim())
	) {
		throw new Error("Published policies require complete bilingual copy");
	}
	const [updated] = await db
		.update(policies)
		.set({
			slug: input.slug.trim().toLowerCase(),
			titleEn: input.titleEn.trim(),
			titleFr: input.titleFr.trim(),
			bodyEn: input.bodyEn.trim(),
			bodyFr: input.bodyFr.trim(),
			updatedAt: unixNow(),
		})
		.where(eq(policies.id, id))
		.returning();
	return updated ?? null;
}

export async function setPolicyStatus(
	db: CommerceDatabase,
	id: string,
	status: PolicyStatus,
) {
	const [policy] = await db
		.select()
		.from(policies)
		.where(eq(policies.id, id))
		.limit(1);
	if (!policy) return null;
	if (
		status === "published" &&
		(!policy.titleEn.trim() ||
			!policy.titleFr.trim() ||
			!policy.bodyEn.trim() ||
			!policy.bodyFr.trim())
	) {
		throw new Error("Published policies require complete bilingual copy");
	}
	const now = unixNow();
	const [updated] = await db
		.update(policies)
		.set({
			status,
			updatedAt: now,
			publishedAt: status === "published" ? (policy.publishedAt ?? now) : null,
		})
		.where(eq(policies.id, id))
		.returning();
	return updated ?? null;
}

export async function deletePolicy(
	db: CommerceDatabase,
	id: string,
): Promise<boolean> {
	const deleted = await db
		.delete(policies)
		.where(and(eq(policies.id, id), eq(policies.status, "draft")))
		.returning({ id: policies.id });
	return deleted.length === 1;
}
