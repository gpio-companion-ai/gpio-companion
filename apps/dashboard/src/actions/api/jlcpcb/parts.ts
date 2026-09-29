"no action";

import { handleJlcpcbSearch, jlcpcbResponse } from "../../../lib/jlcpcb.ts";
import { readJsonBody } from "../../../lib/mobile-http.ts";
import { requireIdentity } from "../../../lib/session.ts";

type JlcpcbContext = {
	request: Request;
	env: {
		DYNAMIC_PAGE_KV: KVNamespace;
		JLCPCB_APP_ID?: string;
		JLCPCB_ACCESS_KEY?: string;
		JLCPCB_SECRET_KEY?: string;
	};
};

export async function onRequestPost(ctx: JlcpcbContext) {
	return jlcpcbResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return handleJlcpcbSearch({
			env: ctx.env,
			userId: identity.id,
			body: await readJsonBody(ctx.request),
		});
	});
}
