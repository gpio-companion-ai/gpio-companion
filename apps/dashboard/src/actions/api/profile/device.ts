"no action";

import { bearerToken, userIdForAiAuth } from "../../../lib/ai-credentials.ts";
import { getUserProfile } from "../../../lib/profile.ts";

type ProfileDeviceEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
};

export type ProfileDeviceContext = {
	request: Request;
	env: ProfileDeviceEnv;
};

export async function onRequestGet(ctx: ProfileDeviceContext) {
	const token = bearerToken(ctx.request);
	if (!token) {
		return Response.json({ error: "sign in first" }, { status: 401 });
	}
	const userId = await userIdForAiAuth(ctx.env, token);
	if (!userId) {
		return Response.json({ error: "sign in first" }, { status: 401 });
	}
	const profile = await getUserProfile(ctx.env.DYNAMIC_PAGE_KV, userId);
	return Response.json({ profile });
}
