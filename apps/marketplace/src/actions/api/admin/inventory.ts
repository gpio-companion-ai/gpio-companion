import { getContext } from "@next/action/context";
import { commerceDb } from "../../../lib/admin-auth.ts";
import {
	adjustInventory,
	configureInventory,
	listInventoryAdjustments,
	listInventoryLevels,
} from "../../../lib/commerce/admin-repository.ts";

export async function GET(productId?: string) {
	const ctx = getContext<Env, never, never>(arguments);
	const db = commerceDb(ctx);
	const [levels, adjustments] = await Promise.all([
		listInventoryLevels(db),
		listInventoryAdjustments(db, productId || undefined),
	]);
	return { levels, adjustments };
}

export async function POST(productId: string, onHand: number) {
	const ctx = getContext<Env, never, never>(arguments);
	return configureInventory(commerceDb(ctx), productId, onHand);
}

export async function PUT(productId: string, delta: number, reason: string) {
	const ctx = getContext<Env, never, never>(arguments);
	return adjustInventory(commerceDb(ctx), {
		productId,
		delta,
		reason,
		actorId: "admin",
	});
}
