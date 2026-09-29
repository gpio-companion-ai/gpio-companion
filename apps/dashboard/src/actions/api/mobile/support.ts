"no action";

import { readJsonBody, runMobile } from "../../../lib/mobile-http.ts";
import { handleSupport } from "../../../lib/support.ts";

type SupportContext = Parameters<typeof runMobile>[0] & {
	env: Parameters<typeof handleSupport>[0]["env"];
};

export async function onRequestPost(ctx: SupportContext) {
	return runMobile(ctx, async (identity) => {
		return handleSupport({
			env: ctx.env,
			userId: identity.id,
			userEmail: identity.email,
			body: await readJsonBody(ctx.request),
		});
	});
}
