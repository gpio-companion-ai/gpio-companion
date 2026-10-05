"no action";

import { errorStatus, jsonFail, jsonOk } from "../../lib/mobile-http.ts";
import { requireAdmin, requireIdentity } from "../../lib/session.ts";
import {
	listSupportReports,
	supportReportLimit,
	supportReportSince,
} from "../../lib/support-reports.ts";

type ReportsContext = {
	request: Request;
	env: { DASHBOARD_DB?: D1Database };
};

export async function onRequestGet(ctx: ReportsContext) {
	try {
		requireAdmin(await requireIdentity(ctx));
		const url = new URL(ctx.request.url);
		const reports = await listSupportReports(ctx.env.DASHBOARD_DB, {
			since: supportReportSince(url.searchParams.get("since")),
			limit: supportReportLimit(url.searchParams.get("limit")),
		});
		return jsonOk({ reports });
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
