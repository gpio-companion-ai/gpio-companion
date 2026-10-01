import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../../lib/action.ts";
import { removeSignedBoardFile } from "../../../lib/board-files-api.ts";
import { requireIdentity } from "../../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export const POST = wrapAction(async function POST(input: {
	uuid: string;
	name: string;
	path: string;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return removeSignedBoardFile(ctx.env, identity.id, input);
});
