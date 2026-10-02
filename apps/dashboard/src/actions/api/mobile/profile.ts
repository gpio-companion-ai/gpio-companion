"no action";

import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";
import { getUserProfile, setUserProfile } from "../../../lib/profile.ts";
import { pushProfileToLiveBoards } from "../../../lib/profile-push.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) =>
		getUserProfile(ctx.env.DYNAMIC_PAGE_KV, identity.id),
	);
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const profile = await setUserProfile(
			ctx.env.DYNAMIC_PAGE_KV,
			identity.id,
			await readJsonBody(ctx.request),
		);
		await pushProfileToLiveBoards(ctx.env, identity.id, profile);
		return profile;
	});
}
