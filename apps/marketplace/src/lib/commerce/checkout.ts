import { eq } from "drizzle-orm";
import type { CommerceDatabase } from "../db/client";
import { inventoryReservations } from "../db/schema";
import { priceCart } from "./pricing";
import {
	createInventoryReservation,
	releaseInventoryReservation,
} from "./reservation-repository";
import {
	createOrder,
	getOrder,
	updateOrderStates,
} from "./order-repository";
import { createPayPalOrder, paypalConfigured } from "../paypal.ts";
import { validateShippingAddress } from "../../../../../packages/core/src/shipping-address.ts";
import { unixNow } from "./identifiers";

const RESERVATION_SECONDS = 30 * 60;

export type CheckoutAddress = {
	name: string;
	email: string;
	line1: string;
	line2?: string | null;
	city: string;
	region?: string | null;
	postalCode: string;
	country: string;
};

function requireText(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

export function validateCheckoutAddress(input: CheckoutAddress): CheckoutAddress {
	const email = requireText(input.email, "Email").toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error("Email is invalid");
	}
	return {
		...validateShippingAddress(input),
		email,
	};
}

export async function quoteCart(
	db: CommerceDatabase,
	items: readonly { productId: string; quantity: number }[],
	destination: { country: string; region?: string | null },
) {
	return priceCart(db, items, destination);
}

export async function beginCheckout(
	db: CommerceDatabase,
	env: object,
	input: {
		userId: string;
		items: readonly { productId: string; quantity: number }[];
		address: CheckoutAddress;
		idempotencyKey: string;
	},
) {
	if (!paypalConfigured(env)) throw new Error("PayPal is not configured");
	const address = validateCheckoutAddress(input.address);
	const priced = await priceCart(db, input.items, {
		country: address.country,
		region: address.region,
	});
	const created = await createOrder(db, {
		userId: input.userId,
		email: address.email,
		lines: priced.lines,
		subtotalCents: priced.subtotalCents,
		shippingCents: priced.shippingCents,
		taxCents: priced.taxCents,
		totalCents: priced.totalCents,
		shippingAddress: address,
		idempotencyKey: input.idempotencyKey,
	});
	if (created.replayed) {
		if (created.order.status === "cancelled") {
			throw new Error("This checkout already failed. Refresh and try again.");
		}
		if (created.order.paypalOrderId) {
			return {
				orderId: created.order.id,
				orderNumber: created.order.orderNumber,
				paypalOrderId: created.order.paypalOrderId,
				totalCents: created.order.totalCents,
				currency: "USD" as const,
			};
		}
	}
	const expiresAt = unixNow() + RESERVATION_SECONDS;
	const reserved: string[] = [];
	try {
		for (const line of priced.lines) {
			const result = await createInventoryReservation(db, {
				idempotencyKey: `${input.idempotencyKey}:${line.productId}`,
				orderId: created.order.id,
				productId: line.productId,
				quantity: line.quantity,
				expiresAt,
			});
			reserved.push(result.reservation.id);
		}
		const paypal = await createPayPalOrder(env, {
			orderId: created.order.id,
			orderNumber: created.order.orderNumber,
			totalCents: priced.totalCents,
			requestId: input.idempotencyKey,
			shipping: address,
		});
		await updateOrderStates(db, created.order.id, { paypalOrderId: paypal.id });
		return {
			orderId: created.order.id,
			orderNumber: created.order.orderNumber,
			paypalOrderId: paypal.id,
			totalCents: priced.totalCents,
			currency: "USD" as const,
		};
	} catch (error) {
		for (const id of reserved) {
			await releaseInventoryReservation(db, id).catch(() => undefined);
		}
		await updateOrderStates(db, created.order.id, { status: "cancelled" });
		throw error;
	}
}

export async function reservationsForOrder(db: CommerceDatabase, orderId: string) {
	return db
		.select()
		.from(inventoryReservations)
		.where(eq(inventoryReservations.orderId, orderId));
}

export async function orderForCapture(db: CommerceDatabase, orderId: string) {
	return getOrder(db, orderId);
}
