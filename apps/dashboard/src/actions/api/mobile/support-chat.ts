"no action";

import { readJsonBody, runMobile } from "../../../lib/mobile-http.ts";
import {
	postSupportChat,
	readSupportChat,
	type SupportChatEnv,
} from "../../../lib/support-chat.ts";

type SupportChatContext = Parameters<typeof runMobile>[0] & {
	env: SupportChatEnv;
};

export async function onRequestGet(ctx: SupportChatContext) {
	return runMobile(ctx, (identity) =>
		readSupportChat({ env: ctx.env, userId: identity.id }),
	);
}

export async function onRequestPost(ctx: SupportChatContext) {
	return runMobile(ctx, async (identity) =>
		postSupportChat({
			env: ctx.env,
			userId: identity.id,
			userEmail: identity.email,
			body: await readJsonBody(ctx.request),
		}),
	);
}
