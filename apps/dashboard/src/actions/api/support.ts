"no action";

import { readJsonBody } from "../../lib/mobile-http.ts";
import { requireIdentity } from "../../lib/session.ts";
import { handleSupport, supportResponse } from "../../lib/support.ts";

type SupportContext = {
	request: Request;
	env: Parameters<typeof handleSupport>[0]["env"];
};

export async function onRequestPost(ctx: SupportContext) {
	return supportResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return handleSupport({
			env: ctx.env,
			userId: identity.id,
			userEmail: identity.email,
			body: await readJsonBody(ctx.request),
		});
	});
}
