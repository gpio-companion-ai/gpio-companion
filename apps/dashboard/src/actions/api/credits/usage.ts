import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../../lib/action.ts";
import { getAiUsageSummary, parseUsageDays } from "../../../lib/ai-usage.ts";
import { createDashboardDatabase } from "../../../lib/db/client.ts";
import { requireIdentity } from "../../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	DASHBOARD_DB?: D1Database;
};

export const GET = wrapAction(async function GET(days = 30) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	if (!ctx.env.DASHBOARD_DB) {
		throw new Error("usage history is not available");
	}
	return getAiUsageSummary(
		createDashboardDatabase(ctx.env.DASHBOARD_DB),
		identity.id,
		parseUsageDays(days),
	);
});
