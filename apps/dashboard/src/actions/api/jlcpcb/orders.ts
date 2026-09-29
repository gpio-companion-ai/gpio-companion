"no action";

import { addressContext, loadShippingAddress } from "../../../lib/address.ts";
import { handleJlcpcbOrder, jlcpcbResponse } from "../../../lib/jlcpcb.ts";
import { readJsonBody } from "../../../lib/mobile-http.ts";

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
		const session = await addressContext(ctx);
		return handleJlcpcbOrder({
			env: ctx.env,
			userId: session.userId,
			address: await loadShippingAddress(session),
			body: await readJsonBody(ctx.request),
		});
	});
}
