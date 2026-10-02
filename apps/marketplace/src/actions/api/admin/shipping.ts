import { getContext } from "@next/action/context";
import { commerceDb, requireAdmin } from "../../../lib/admin-auth.ts";
import { listShippingRates } from "../../../lib/commerce/admin-repository.ts";
import {
	easyshipOrigin,
	easyshipTokenConfigured,
	itemCategory,
} from "../../../lib/easyship.ts";

export async function GET() {
	const ctx = getContext<Env, never, never>(arguments);
	const env = ctx.env as { EASYSHIP_API_TOKEN?: string };
	const tokenConfigured = easyshipTokenConfigured(env);
	const origin = easyshipOrigin(env);
	return {
		easyship: {
			configured: tokenConfigured && origin !== null,
			tokenConfigured,
			originConfigured: origin !== null,
			mode: env.EASYSHIP_API_TOKEN?.startsWith("sand_")
				? "sandbox"
				: "production",
			origin,
			itemCategory: itemCategory(env),
		},
		legacyRates: await listShippingRates(commerceDb(ctx)),
	};
}
