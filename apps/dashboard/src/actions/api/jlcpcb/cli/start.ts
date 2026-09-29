"no action";

import { beginCliLogin } from "../../../../lib/jlcpcb-cli.ts";
import { jlcpcbResponse } from "../../../../lib/jlcpcb.ts";
import { readJsonBody } from "../../../../lib/mobile-http.ts";
import { requireIdentity } from "../../../../lib/session.ts";

type CliContext = {
	request: Request;
	env: {
		DYNAMIC_PAGE_KV: KVNamespace;
		GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
		GPIO_COMPANION_DEVICE_KEY_ID?: string;
	};
};

export async function onRequestPost(ctx: CliContext) {
	return jlcpcbResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		const body = await readJsonBody(ctx.request);
		const uuid = typeof body.uuid === "string" ? body.uuid.trim() : "";
		return beginCliLogin({ env: ctx.env, userId: identity.id, uuid });
	});
}
