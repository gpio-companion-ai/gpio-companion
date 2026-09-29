"no action";

import { jlcpcbResponse } from "../../../lib/jlcpcb.ts";
import {
	handleJlcpcbDraftRead,
	handleJlcpcbDraftSave,
	requireDashboardDatabase,
} from "../../../lib/jlcpcb-draft.ts";
import { readJsonBody } from "../../../lib/mobile-http.ts";
import { requireIdentity } from "../../../lib/session.ts";

type DraftContext = {
	request: Request;
	env: {
		DASHBOARD_DB?: D1Database;
	};
};

async function userId(ctx: DraftContext): Promise<string> {
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return identity.id;
}

export async function onRequestGet(ctx: DraftContext) {
	return jlcpcbResponse(async () => {
		return handleJlcpcbDraftRead({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: await userId(ctx),
		});
	});
}

export async function onRequestPut(ctx: DraftContext) {
	return jlcpcbResponse(async () => {
		return handleJlcpcbDraftSave({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: await userId(ctx),
			body: await readJsonBody(ctx.request),
		});
	});
}
