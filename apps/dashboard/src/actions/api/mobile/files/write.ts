"no action";

import { writeSignedBoardFile } from "../../../../lib/board-files-api.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const text = asString(body.text);
		const base64 = asString(body.base64);
		return writeSignedBoardFile(ctx.env, identity.id, {
			uuid: asString(body.uuid),
			name: asString(body.name),
			path: asString(body.path),
			...(base64 ? { base64 } : { text }),
		});
	});
}
