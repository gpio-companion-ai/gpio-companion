"no action";

import { jlcpcbCredentialStatus } from "../../../../lib/jlcpcb.ts";
import { type MobileContext, runMobile } from "../../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async () => {
		return jlcpcbCredentialStatus(ctx.env);
	});
}
