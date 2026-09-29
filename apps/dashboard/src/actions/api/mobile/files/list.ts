"no action";

import { listSignedBoardFiles } from "../../../../lib/board-files-api.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		return listSignedBoardFiles(ctx.env, identity.id, {
			uuid: asString(body.uuid),
			name: asString(body.name),
		});
	});
}
