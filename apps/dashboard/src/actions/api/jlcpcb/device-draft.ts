"no action";

import { bearerToken, userIdForAiAuth } from "../../../lib/ai-credentials.ts";
import { jlcpcbResponse } from "../../../lib/jlcpcb.ts";
import {
	handleJlcpcbDraftRead,
	handleJlcpcbDraftSave,
	requireDashboardDatabase,
} from "../../../lib/jlcpcb-draft.ts";
import { readJsonBody } from "../../../lib/mobile-http.ts";

type DraftContext = {
	request: Request;
	env: {
		DASHBOARD_DB?: D1Database;
		GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	};
};

export async function onRequestGet(ctx: DraftContext) {
	return jlcpcbResponse(async () => {
		return handleJlcpcbDraftRead({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: await ownerId(ctx),
		});
	});
}

export async function onRequestPut(ctx: DraftContext) {
	return jlcpcbResponse(async () => {
		return handleJlcpcbDraftSave({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: await ownerId(ctx),
			body: await readJsonBody(ctx.request),
		});
	});
}

async function ownerId(ctx: DraftContext): Promise<string> {
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
