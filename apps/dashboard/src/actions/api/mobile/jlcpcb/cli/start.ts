"no action";

import { beginCliLogin } from "../../../../../lib/jlcpcb-cli.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const uuid = typeof body.uuid === "string" ? body.uuid.trim() : "";
		return beginCliLogin({ env: ctx.env, userId: identity.id, uuid });
	});
}
