"no action";

import { jlcpcbCredentialStatus, jlcpcbResponse } from "../../../lib/jlcpcb.ts";
import { requireIdentity } from "../../../lib/session.ts";

type JlcpcbContext = {
	request: Request;
	env: {
		JLCPCB_APP_ID?: string;
		JLCPCB_ACCESS_KEY?: string;
		JLCPCB_SECRET_KEY?: string;
	};
};

export async function onRequestGet(ctx: JlcpcbContext) {
	return jlcpcbResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return jlcpcbCredentialStatus(ctx.env);
	});
}
