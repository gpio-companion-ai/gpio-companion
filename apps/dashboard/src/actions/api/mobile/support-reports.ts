"no action";

import { runMobile } from "../../../lib/mobile-http.ts";
import { requireAdmin } from "../../../lib/session.ts";
import {
	listSupportReports,
	supportReportLimit,
	supportReportSince,
} from "../../../lib/support-reports.ts";

type ReportsContext = Parameters<typeof runMobile>[0] & {
	env: { DASHBOARD_DB?: D1Database };
};

export async function onRequestGet(ctx: ReportsContext) {
	return runMobile(ctx, async (identity) => {
		requireAdmin(identity);
		const url = new URL(ctx.request.url);
		const reports = await listSupportReports(ctx.env.DASHBOARD_DB, {
			since: supportReportSince(url.searchParams.get("since")),
			limit: supportReportLimit(url.searchParams.get("limit")),
		});
		return { reports };
	});
}
