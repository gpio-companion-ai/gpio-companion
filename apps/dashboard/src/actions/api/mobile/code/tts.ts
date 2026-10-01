"no action";

import { speakCodeText } from "../../../../lib/code-tts.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

type Env = MobileContext["env"] & {
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
};

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const env = ctx.env as Env;
		return speakCodeText(env, identity.id, await readJsonBody(ctx.request));
	});
}
