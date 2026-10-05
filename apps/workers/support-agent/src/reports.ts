export type StoredSupportReport = {
	reportId: string;
	userId: string;
	createdAt: string;
	surface: "web" | "desktop" | "mobile";
	board: string;
	subject: string;
	bodyText: string;
	bodyHtml: string;
	summaryJson: string;
};

type ReportRow = { emailed_at: string | null };

export async function saveSupportReport(
	database: D1Database | undefined,
	report: StoredSupportReport,
	now = new Date().toISOString(),
): Promise<"stored" | "already"> {
	if (!database) {
		throw new Error("support store is not configured");
	}
	const existing = await database
		.prepare("SELECT emailed_at FROM support_reports WHERE report_id = ?1")
		.bind(report.reportId)
		.first<ReportRow>();
	if (existing?.emailed_at) {
		return "already";
	}
	if (!existing) {
		await database
			.prepare(
				`INSERT INTO support_reports (
					report_id, user_id, created_at, surface, board, subject, body_text, body_html, summary_json
				) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
			)
			.bind(
				report.reportId,
				report.userId,
				report.createdAt,
				report.surface,
				report.board,
				report.subject,
				report.bodyText,
				report.bodyHtml,
				report.summaryJson,
			)
			.run();
	}
	await database
		.prepare(
			"UPDATE support_reports SET emailed_at = ?1 WHERE report_id = ?2 AND emailed_at IS NULL",
		)
		.bind(now, report.reportId)
		.run();
	return "stored";
}
