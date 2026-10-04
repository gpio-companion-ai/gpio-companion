"no action";

import { getAiUsageSummary, parseUsageDays } from "../../../../lib/ai-usage.ts";
import { createDashboardDatabase } from "../../../../lib/db/client.ts";
import { type MobileContext, runMobile } from "../../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		if (!ctx.env.DASHBOARD_DB) {
			throw new Error("usage history is not available");
		}
		const days = parseUsageDays(
			new URL(ctx.request.url).searchParams.get("days"),
		);
		return getAiUsageSummary(
			createDashboardDatabase(ctx.env.DASHBOARD_DB),
			identity.id,
			days,
		);
	});
}
