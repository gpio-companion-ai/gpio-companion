"no action";

import { handleAddressRead, handleAddressSave } from "../../../lib/address.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleAddressRead({
			kv: ctx.env.DYNAMIC_PAGE_KV,
			userId: identity.id,
		});
	});
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleAddressSave({
			kv: ctx.env.DYNAMIC_PAGE_KV,
			userId: identity.id,
			body: await readJsonBody(ctx.request),
		});
	});
}
