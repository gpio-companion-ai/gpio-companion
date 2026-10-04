import { asc, desc, eq } from "drizzle-orm";
import type { CommerceDatabase } from "../db/client";
import {
	type FulfillmentStatus,
	type OrderStatus,
	orderItems,
	orders,
	type PaymentStatus,
} from "../db/schema";
import {
	generateCommerceId,
	generateOrderIdentity,
	unixNow,
} from "./identifiers";
import type { PricedCartLine } from "./pricing";
import { calculateCartTotals } from "./totals";

export interface CreateOrderInput {
	userId?: string | null;
	email: string;
	lines: readonly PricedCartLine[];
	subtotalCents: number;
	shippingCents: number;
	taxCents: number;
	totalCents: number;
	shippingAddress: {
		name: string;
		line1: string;
		line2?: string | null;
		city: string;
		region?: string | null;
		postalCode: string;
		country: string;
	};
	shipping?: {
		courierId: string;
		courierName: string;
		minDays: number | null;
		maxDays: number | null;
	} | null;
	idempotencyKey?: string | null;
}

export async function createOrder(
	db: CommerceDatabase,
	input: CreateOrderInput,
) {
	if (input.lines.length === 0)
		throw new Error("Order must contain at least one item");
	for (const line of input.lines) {
		if (line.lineTotalCents !== line.unitPriceCents * line.quantity) {
			throw new Error(
				"Order line total does not match its unit price and quantity",
			);
		}
	}
	const totals = calculateCartTotals(
		input.lines,
		input.shippingCents,
		input.taxCents,
	);
	if (
		input.subtotalCents !== totals.subtotalCents ||
		input.totalCents !== totals.totalCents
	) {
		throw new Error("Order totals do not balance");
	}
	const idempotencyKey = input.idempotencyKey?.trim() || null;
	if (idempotencyKey) {
		const existing = await getOrderByIdempotencyKey(db, idempotencyKey);
		if (existing)
			return {
				order: existing,
				items: existing.items,
				replayed: true as const,
			};
	}
	const now = unixNow();
	const identity = generateOrderIdentity();
	const order = {
		...identity,
		userId: input.userId ?? null,
		email: input.email.trim().toLowerCase(),
		status: "pending" as const,
		paymentStatus: "pending" as const,
		fulfillmentStatus: "unfulfilled" as const,
		subtotalCents: input.subtotalCents,
		shippingCents: input.shippingCents,
		taxCents: input.taxCents,
		totalCents: input.totalCents,
		currency: "USD",
		shippingName: input.shippingAddress.name.trim(),
		shippingLine1: input.shippingAddress.line1.trim(),
		shippingLine2: input.shippingAddress.line2?.trim() || null,
		shippingCity: input.shippingAddress.city.trim(),
		shippingRegion: input.shippingAddress.region?.trim() || null,
		shippingPostalCode: input.shippingAddress.postalCode.trim(),
		shippingCountry: input.shippingAddress.country.trim().toUpperCase(),
		shippingCourierId: input.shipping?.courierId ?? null,
		shippingCourierName: input.shipping?.courierName ?? null,
		shippingMinDays: input.shipping?.minDays ?? null,
		shippingMaxDays: input.shipping?.maxDays ?? null,
		idempotencyKey,
		createdAt: now,
		updatedAt: now,
	};
	const itemRows = input.lines.map((line) => ({
		id: generateCommerceId("itm"),
		orderId: order.id,
		productId: line.productId,
		sku: line.sku,
		nameEn: line.nameEn,
		nameFr: line.nameFr,
		unitPriceCents: line.unitPriceCents,
		quantity: line.quantity,
		lineTotalCents: line.lineTotalCents,
		createdAt: now,
	}));
	await db.batch([
		db.insert(orders).values(order),
		db.insert(orderItems).values(itemRows),
	]);
	return { order, items: itemRows, replayed: false as const };
}

export async function getOrderByIdempotencyKey(
	db: CommerceDatabase,
	idempotencyKey: string,
) {
	const [order] = await db
		.select()
		.from(orders)
		.where(eq(orders.idempotencyKey, idempotencyKey))
		.limit(1);
	if (!order) return null;
	return getOrder(db, order.id);
}

export async function getOrderByPaypalId(
	db: CommerceDatabase,
	paypalOrderId: string,
) {
	const [order] = await db
		.select()
		.from(orders)
		.where(eq(orders.paypalOrderId, paypalOrderId))
		.limit(1);
	if (!order) return null;
	return getOrder(db, order.id);
}

export async function listOrdersForUser(db: CommerceDatabase, userId: string) {
	return db
		.select()
		.from(orders)
		.where(eq(orders.userId, userId))
		.orderBy(desc(orders.createdAt), desc(orders.id));
}

export async function getOrder(db: CommerceDatabase, id: string) {
	const [order] = await db
		.select()
		.from(orders)
		.where(eq(orders.id, id))
		.limit(1);
	if (!order) return null;
	const items = await db
		.select()
		.from(orderItems)
		.where(eq(orderItems.orderId, id))
		.orderBy(asc(orderItems.createdAt), asc(orderItems.id));
	return { ...order, items };
}

export async function listOrders(db: CommerceDatabase) {
	return db
		.select()
		.from(orders)
		.orderBy(desc(orders.createdAt), desc(orders.id));
}

export async function updateOrderStates(
	db: CommerceDatabase,
	id: string,
	states: {
		status?: OrderStatus;
		paymentStatus?: PaymentStatus;
		fulfillmentStatus?: FulfillmentStatus;
		paypalOrderId?: string | null;
		paypalCaptureId?: string | null;
		carrier?: string | null;
		trackingNumber?: string | null;
	},
) {
	const now = unixNow();
	const [updated] = await db
		.update(orders)
		.set({
			...states,
			updatedAt: now,
			paidAt: states.paymentStatus === "captured" ? now : undefined,
			fulfilledAt: states.fulfillmentStatus === "delivered" ? now : undefined,
			cancelledAt: states.status === "cancelled" ? now : undefined,
		})
		.where(eq(orders.id, id))
		.returning();
	return updated ?? null;
}
