import { getContext } from "@next/action/context";
import { commerceDb } from "../../../lib/admin-auth.ts";
import {
	listOrders,
	updateOrderStates,
} from "../../../lib/commerce/order-repository.ts";
import type {
	FulfillmentStatus,
	OrderStatus,
	PaymentStatus,
} from "../../../lib/db/schema.ts";

export async function GET() {
	const ctx = getContext<Env, never, never>(arguments);
	return listOrders(commerceDb(ctx));
}

export async function PATCH(
	id: string,
	states: {
		status?: OrderStatus;
		paymentStatus?: PaymentStatus;
		fulfillmentStatus?: FulfillmentStatus;
		carrier?: string | null;
		trackingNumber?: string | null;
	},
) {
	const ctx = getContext<Env, never, never>(arguments);
	return updateOrderStates(commerceDb(ctx), id, states);
}
