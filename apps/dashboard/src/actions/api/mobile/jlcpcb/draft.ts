"no action";

import {
	handleJlcpcbDraftRead,
	handleJlcpcbDraftSave,
	requireDashboardDatabase,
} from "../../../../lib/jlcpcb-draft.ts";
import {
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleJlcpcbDraftRead({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: identity.id,
		});
	});
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		return handleJlcpcbDraftSave({
			db: requireDashboardDatabase(ctx.env.DASHBOARD_DB),
			userId: identity.id,
			body: await readJsonBody(ctx.request),
		});
	});
}
