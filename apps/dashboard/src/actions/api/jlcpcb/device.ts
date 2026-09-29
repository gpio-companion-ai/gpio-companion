"no action";

import { bearerToken, userIdForAiAuth } from "../../../lib/ai-credentials.ts";
import {
	handleJlcpcbSearch,
	type JlcpcbClientFactory,
	jlcpcbCredentialStatus,
	jlcpcbResponse,
} from "../../../lib/jlcpcb.ts";
import { readJsonBody } from "../../../lib/mobile-http.ts";

type JlcpcbDeviceEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	JLCPCB_APP_ID?: string;
	JLCPCB_ACCESS_KEY?: string;
	JLCPCB_SECRET_KEY?: string;
};

export type JlcpcbDeviceContext = {
	request: Request;
	env: JlcpcbDeviceEnv;
};

export async function onRequestGet(ctx: JlcpcbDeviceContext) {
	return jlcpcbResponse(async () => {
		await ownerId(ctx);
		return jlcpcbCredentialStatus(ctx.env);
	});
}

export async function onRequestPost(ctx: JlcpcbDeviceContext) {
	return postDevice(ctx);
}

export async function postDevice(
	ctx: JlcpcbDeviceContext,
	clientFor?: JlcpcbClientFactory,
) {
	return jlcpcbResponse(async () => {
		return handleJlcpcbSearch({
			env: ctx.env,
			userId: await ownerId(ctx),
			body: await readJsonBody(ctx.request),
			clientFor,
		});
	});
}

async function ownerId(ctx: JlcpcbDeviceContext): Promise<string> {
	const token = bearerToken(ctx.request);
	if (!token) {
		throw new Error("sign in first");
	}
	const userId = await userIdForAiAuth(ctx.env, token);
	if (!userId) {
		throw new Error("sign in first");
	}
	return userId;
}
