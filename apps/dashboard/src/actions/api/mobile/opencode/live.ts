"no action";

import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";
import { signOpencodeEventLive } from "../../../../lib/opencode-session.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		return signOpencodeEventLive(ctx.env, identity, {
			uuid: asString(body.uuid),
			repo: asString(body.repo),
		});
	});
}
