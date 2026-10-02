import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../lib/action.ts";
import { getUserProfile, setUserProfile } from "../../lib/profile.ts";
import { pushProfileToLiveBoards } from "../../lib/profile-push.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export const GET = wrapAction(async function GET() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return getUserProfile(ctx.env.DYNAMIC_PAGE_KV, identity.id);
});

export const PUT = wrapAction(async function PUT(input: unknown) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const profile = await setUserProfile(
		ctx.env.DYNAMIC_PAGE_KV,
		identity.id,
		input,
	);
	await pushProfileToLiveBoards(ctx.env, identity.id, profile);
	return profile;
});
