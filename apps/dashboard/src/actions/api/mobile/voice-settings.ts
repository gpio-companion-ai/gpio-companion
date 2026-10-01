"no action";

import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";
import {
	getVoiceSettings,
	setVoiceSettings,
} from "../../../lib/voice-settings.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) =>
		getVoiceSettings(ctx.env.DYNAMIC_PAGE_KV, identity.id),
	);
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) =>
		setVoiceSettings(
			ctx.env.DYNAMIC_PAGE_KV,
			identity.id,
			await readJsonBody(ctx.request),
		),
	);
}
