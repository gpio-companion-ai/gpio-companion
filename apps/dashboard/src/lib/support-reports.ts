import { and, asc, gte, isNotNull } from "drizzle-orm";
import { createDashboardDatabase } from "./db/client.ts";
import { supportReports } from "./db/schema.ts";

export type SupportReportRow = {
	reportId: string;
	userId: string;
	createdAt: string;
	surface: string;
	board: string;
	subject: string;
	bodyText: string;
	bodyHtml: string;
	summaryJson: string;
	emailedAt: string | null;
};

export function supportReportLimit(value: string | null): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return 50;
	}
	return Math.min(100, Math.floor(parsed));
}

export function supportReportSince(value: string | null): string | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error("since is invalid");
	}
	return date.toISOString();
}

export async function listSupportReports(
	database: D1Database | undefined,
	input: { since?: string; limit: number },
): Promise<SupportReportRow[]> {
	if (!database) {
		throw new Error("support store is not configured");
	}
	const filters = [isNotNull(supportReports.emailedAt)];
	if (input.since) {
		filters.push(gte(supportReports.createdAt, input.since));
	}
	return createDashboardDatabase(database)
		.select({
			reportId: supportReports.reportId,
			userId: supportReports.userId,
			createdAt: supportReports.createdAt,
			surface: supportReports.surface,
			board: supportReports.board,
			subject: supportReports.subject,
			bodyText: supportReports.bodyText,
			bodyHtml: supportReports.bodyHtml,
			summaryJson: supportReports.summaryJson,
			emailedAt: supportReports.emailedAt,
		})
		.from(supportReports)
		.where(and(...filters))
		.orderBy(asc(supportReports.createdAt))
		.limit(input.limit);
}
