"no action";

import {
	addressContext,
	loadShippingAddress,
} from "../../../../../lib/address.ts";
import { handleJlcpcbQuote } from "../../../../../lib/jlcpcb.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async () => {
		const session = await addressContext(ctx);
		return handleJlcpcbQuote({
			env: ctx.env,
			userId: session.userId,
			address: await loadShippingAddress(session),
			body: await readJsonBody(ctx.request),
		});
	});
}
