"no action";

import { handleJlcpcbSearch } from "../../../../lib/jlcpcb.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleJlcpcbSearch({
			env: ctx.env,
			userId: identity.id,
			body: await readJsonBody(ctx.request),
		});
	});
}
