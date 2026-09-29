"no action";

import { handleJlcpcbOrder } from "../../../../lib/jlcpcb.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleJlcpcbOrder({
			env: ctx.env,
			kv: ctx.env.DYNAMIC_PAGE_KV,
			userId: identity.id,
			body: await readJsonBody(ctx.request),
		});
	});
}
