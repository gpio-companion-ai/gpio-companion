"no action";

import {
	addressContext,
	handleAddressRead,
	handleAddressSave,
} from "../../../lib/address.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async () => {
		return handleAddressRead(await addressContext(ctx));
	});
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async () => {
		return handleAddressSave({
			...(await addressContext(ctx)),
			body: await readJsonBody(ctx.request),
		});
	});
}
