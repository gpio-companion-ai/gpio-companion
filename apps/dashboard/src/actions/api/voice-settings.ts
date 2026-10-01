import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../lib/action.ts";
import { requireIdentity } from "../../lib/session.ts";
import {
	getVoiceSettings,
	setVoiceSettings,
} from "../../lib/voice-settings.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
};

export const GET = wrapAction(async function GET() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return getVoiceSettings(ctx.env.DYNAMIC_PAGE_KV, identity.id);
});

export const PUT = wrapAction(async function PUT(input: unknown) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return setVoiceSettings(ctx.env.DYNAMIC_PAGE_KV, identity.id, input);
});
