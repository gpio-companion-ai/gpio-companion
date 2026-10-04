"no action";

import {
	completeGithubAppConnect,
	type GithubAppEnv,
	githubAppStatusForUser,
} from "../../../lib/github-app.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";

function env(ctx: MobileContext): GithubAppEnv {
	return ctx.env as GithubAppEnv;
}

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return githubAppStatusForUser(env(ctx), identity.id, ctx.request);
	});
}

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		return completeGithubAppConnect(
			env(ctx),
			identity.id,
			{
				installationId:
					asString(body.installationId) ||
					(typeof body.installationId === "number"
						? body.installationId
						: undefined),
				code: asString(body.code),
				state: asString(body.state),
				redirectUri: asString(body.redirectUri),
			},
			ctx.request,
		);
	});
}
