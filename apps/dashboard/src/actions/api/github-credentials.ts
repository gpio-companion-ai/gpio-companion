"no action";

import {
	type GithubAppEnv,
	issueGithubCredentials,
} from "../../lib/github-app.ts";

export async function onRequestPost(ctx: {
	env: GithubAppEnv;
	request: Request;
}) {
	let body: { uuid?: string; key?: string } = {};
	try {
		body = (await ctx.request.json()) as { uuid?: string; key?: string };
	} catch {
		return Response.json({ error: "invalid json" }, { status: 400 });
	}
	try {
		const creds = await issueGithubCredentials(
			ctx.env,
			body.uuid ?? "",
			body.key ?? "",
		);
		return Response.json(creds);
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : "request failed";
		const status =
			message === "GitHub App is not connected" ||
			message === "unknown pairing" ||
			message === "pairing key mismatch"
				? 403
				: 400;
		return Response.json({ error: message }, { status });
	}
}
