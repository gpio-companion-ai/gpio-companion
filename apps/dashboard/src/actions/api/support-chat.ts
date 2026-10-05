"no action";

import { readJsonBody } from "../../lib/mobile-http.ts";
import { requireIdentity } from "../../lib/session.ts";
import {
	postSupportChat,
	readSupportChat,
	type SupportChatEnv,
	supportChatResponse,
} from "../../lib/support-chat.ts";

type SupportChatContext = {
	request: Request;
	env: SupportChatEnv;
};

export async function onRequestGet(ctx: SupportChatContext) {
	return supportChatResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return readSupportChat({ env: ctx.env, userId: identity.id });
	});
}

export async function onRequestPost(ctx: SupportChatContext) {
	return supportChatResponse(async () => {
		const identity = await requireIdentity(ctx);
		if (!identity.id) {
			throw new Error("sign in first");
		}
		return postSupportChat({
			env: ctx.env,
			userId: identity.id,
			userEmail: identity.email,
			body: await readJsonBody(ctx.request),
		});
	});
}
