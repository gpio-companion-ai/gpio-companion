import { getContext } from "@next/action/context";
import { commerceDb, requireUser } from "../../lib/admin-auth.ts";
import { beginCheckout, quoteCart } from "../../lib/commerce/checkout.ts";
import { paypalClientId, paypalConfigured } from "../../lib/paypal.ts";

export async function GET() {
	const ctx = getContext<Env, never, never>(arguments);
	return {
		enabled: paypalConfigured(ctx.env),
		clientId: paypalClientId(ctx.env),
	};
}

export async function POST(
	items: { productId: string; quantity: number }[],
	destination: {
		line1: string;
		line2?: string | null;
		city: string;
		region?: string | null;
		postalCode: string;
		country: string;
	},
) {
	const ctx = getContext<Env, never, never>(arguments);
	return quoteCart(commerceDb(ctx), ctx.env, items, destination);
}

export async function PUT(input: {
	items: { productId: string; quantity: number }[];
	address: {
		name: string;
		email: string;
		line1: string;
		line2?: string | null;
		city: string;
		region?: string | null;
		postalCode: string;
		country: string;
	};
	shippingOptionId: string;
	idempotencyKey: string;
}) {
	const ctx = getContext<Env, never, never>(arguments);
	const session = await requireUser(ctx);
	if (!input.idempotencyKey?.trim()) throw new Error("Idempotency key is required");
	return beginCheckout(commerceDb(ctx), ctx.env, {
		userId: session.id ?? "",
		items: input.items,
		address: { ...input.address, email: session.email ?? input.address.email },
		shippingOptionId: input.shippingOptionId,
		idempotencyKey: input.idempotencyKey.trim(),
	});
}
