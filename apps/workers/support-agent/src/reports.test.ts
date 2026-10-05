import { describe, expect, test } from "bun:test";
import { saveSupportReport, type StoredSupportReport } from "./reports.ts";

const report: StoredSupportReport = {
	reportId: "abc",
	userId: "user-1",
	createdAt: "2026-10-05T00:00:00.000Z",
	surface: "web",
	board: "opi",
	subject: "gpio-companion bug report: Dock [abc]",
	bodyText: "User: user-1\nDock missing",
	bodyHtml: "<pre>Dock missing</pre>",
	summaryJson: "{}",
};

function mockDb(existing: { emailed_at: string | null } | null) {
	const sql: string[] = [];
	const database = {
		prepare(statement: string) {
			return {
				bind() {
					return {
						async first() {
							sql.push(`read ${statement}`);
							return existing;
						},
						async run() {
							sql.push(statement);
						},
					};
				},
			};
		},
	};
	return { database: database as unknown as D1Database, sql };
}

describe("saveSupportReport", () => {
	test("stores the email body and marks it emailed", async () => {
		const db = mockDb(null);
		await expect(saveSupportReport(db.database, report, "now")).resolves.toBe(
			"stored",
		);
		expect(db.sql.some((line) => line.includes("INSERT INTO support_reports"))).toBe(
			true,
		);
		expect(db.sql.some((line) => line.includes("emailed_at"))).toBe(true);
	});

	test("does not insert again when the email was already stored", async () => {
		const db = mockDb({ emailed_at: "then" });
		await expect(saveSupportReport(db.database, report)).resolves.toBe(
			"already",
		);
		expect(db.sql.some((line) => line.startsWith("INSERT"))).toBe(false);
	});

	test("refuses when D1 is missing", async () => {
		await expect(saveSupportReport(undefined, report)).rejects.toThrow(
			"support store is not configured",
		);
	});
});
