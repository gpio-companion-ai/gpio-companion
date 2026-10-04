import { and, eq, inArray, sql } from "drizzle-orm";
import type { CommerceDatabase } from "../db/client";
import { inventory, inventoryReservations, products } from "../db/schema";
import {
	buildEasyShipItems,
	type EasyShipDestination,
	type EasyShipRateOption,
	requestEasyShipRates,
} from "../easyship";
import { availableInventory } from "./totals";
import { type CartInputItem, validateCartInput } from "./validation";

export interface PricedCartLine {
	productId: string;
	sku: string;
	nameEn: string;
	nameFr: string;
	unitPriceCents: number;
	quantity: number;
	lineTotalCents: number;
}

export interface PricedCart {
	currency: "USD";
	lines: PricedCartLine[];
	subtotalCents: number;
	taxCents: number;
}

export interface PricedCartWithShipping extends PricedCart {
	shippingOptions: EasyShipRateOption[];
}

async function loadPricedLines(
	db: CommerceDatabase,
	items: readonly CartInputItem[],
): Promise<PricedCartLine[]> {
	const validatedItems = validateCartInput(items);
	const ids = validatedItems.map((item) => item.productId);
	const now = Math.floor(Date.now() / 1000);
	const productRows = await db
		.select({
			id: products.id,
			sku: products.sku,
			nameEn: products.nameEn,
			nameFr: products.nameFr,
			priceCents: products.priceCents,
			onHand: inventory.onHand,
			reserved: sql<number>`coalesce((select sum(${inventoryReservations.quantity}) from ${inventoryReservations} where ${inventoryReservations.productId} = ${products.id} and ${inventoryReservations.status} = 'active' and ${inventoryReservations.expiresAt} > ${now}), 0)`,
		})
		.from(products)
		.innerJoin(inventory, eq(inventory.productId, products.id))
		.where(and(eq(products.status, "published"), inArray(products.id, ids)));

	const byId = new Map(productRows.map((row) => [row.id, row]));
	return validatedItems.map((item) => {
		const product = byId.get(item.productId);
		if (!product || product.priceCents === null) {
			throw new Error(`Product is not available: ${item.productId}`);
		}
		if (availableInventory(product.onHand, product.reserved) < item.quantity) {
			throw new Error(`Insufficient inventory: ${item.productId}`);
		}
		return {
			productId: product.id,
			sku: product.sku,
			nameEn: product.nameEn,
			nameFr: product.nameFr,
			unitPriceCents: product.priceCents,
			quantity: item.quantity,
			lineTotalCents: product.priceCents * item.quantity,
		};
	});
}

async function loadProductShippingData(
	db: CommerceDatabase,
	lineProductIds: readonly string[],
) {
	if (lineProductIds.length === 0) return [];
	return db
		.select({
			id: products.id,
			weightGrams: products.weightGrams,
			lengthCm: products.lengthCm,
			widthCm: products.widthCm,
			heightCm: products.heightCm,
		})
		.from(products)
		.where(inArray(products.id, [...lineProductIds]));
}

export async function priceCart(
	db: CommerceDatabase,
	items: readonly CartInputItem[],
): Promise<PricedCart> {
	const lines = await loadPricedLines(db, items);
	const subtotalCents = lines.reduce(
		(total, line) => total + line.lineTotalCents,
		0,
	);
	return {
		currency: "USD" as const,
		lines,
		subtotalCents,
		taxCents: 0,
	};
}

export async function priceCartWithShippingOptions(
	db: CommerceDatabase,
	env: object,
	items: readonly CartInputItem[],
	destination: EasyShipDestination,
): Promise<PricedCartWithShipping> {
	const lines = await loadPricedLines(db, items);
	const shippingData = await loadProductShippingData(
		db,
		lines.map((line) => line.productId),
	);
	const easyShipItems = buildEasyShipItems(lines, shippingData);
	const shippingOptions = await requestEasyShipRates(env, {
		destination,
		items: easyShipItems,
	});
	const subtotalCents = lines.reduce(
		(total, line) => total + line.lineTotalCents,
		0,
	);
	return {
		currency: "USD" as const,
		lines,
		subtotalCents,
		taxCents: 0,
		shippingOptions,
	};
}
