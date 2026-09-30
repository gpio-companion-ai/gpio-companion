import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../../lib/action.ts";
import { transcribeCodeAudio } from "../../../lib/code-stt.ts";
import { requireIdentity } from "../../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
};

export const POST = wrapAction(async function POST(input: {
	audio: string;
	locale?: string;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return transcribeCodeAudio(ctx.env, identity.id, input);
});
