import { describe, expect, test } from "bun:test";
import {
	assertOvUri,
	ovRequest,
	parseSupportSummary,
	supportReportId,
	supportReportMail,
} from "./support-chat.ts";
import { deliverSupportEmail } from "./support-mail.ts";

describe("support openviking lookup", () => {
	test("locks reads to the gpio-companion resource", () => {
		expect(assertOvUri("viking://resources/gpio-companion")).toBe(
			"viking://resources/gpio-companion",
		);
		expect(assertOvUri("viking://resources/gpio-companion/PRODUCT.md")).toBe(
			"viking://resources/gpio-companion/PRODUCT.md",
		);
		expect(() => assertOvUri("viking://user/shpaw415")).toThrow(
			"project lookup is outside gpio-companion",
		);
		expect(() =>
			assertOvUri("viking://resources/gpio-companion/../secrets"),
		).toThrow("project lookup is outside gpio-companion");
	});

	test("only builds read routes", () => {
		expect(ovRequest({ op: "find", query: "bug report" })).toEqual({
			method: "POST",
			path: "/api/v1/search/find",
			body: {
				query: "bug report",
				target_uri: "viking://resources/gpio-companion",
				limit: 5,
			},
		});
		expect(
			ovRequest({
				op: "grep",
				pattern: "support-chat",
				uri: "viking://resources/gpio-companion",
			}).path,
		).toBe("/api/v1/search/grep");
		expect(
			ovRequest({
				op: "read",
				uri: "viking://resources/gpio-companion/PRODUCT.md",
			}).method,
		).toBe("GET");
		expect(() =>
			ovRequest({ op: "read", uri: "viking://resources/other" }),
		).toThrow("project lookup is outside gpio-companion");
	});
});

describe("support report email", () => {
	const summary = parseSupportSummary(
		{
			title: "Dock missing",
			description: "The dock does not open",
			steps: ["Open project"],
			expected: "Dock opens",
			actual: "Nothing happens",
			severity: "high",
		},
		{ surface: "web", board: "opi" },
	);

	test("uses a stable id and does not invent a second send body", () => {
		expect(supportReportId(summary)).toBe(supportReportId(summary));
		const mail = supportReportMail(
			summary,
			[{ id: "1", role: "user", text: "dock" }],
			{
				userId: "user-1",
			},
		);
		expect(mail.subject).toContain(`[${supportReportId(summary)}]`);
		expect(mail.text).toContain("dock");
		expect(mail.to).toBe("support@gpio-companion.com");
	});

	test("send fails closed without a token and accepts one delivered response", async () => {
		await expect(
			deliverSupportEmail("account", "", {
				to: "support@gpio-companion.com",
				from: { address: "noreply@gpio-companion.com" },
				subject: "x",
				text: "x",
				html: "x",
			}),
		).rejects.toThrow("support email is not configured");
		const calls: string[] = [];
		await deliverSupportEmail(
			"account",
			"token",
			{
				to: "support@gpio-companion.com",
				from: { address: "noreply@gpio-companion.com" },
				subject: "x",
				text: "x",
				html: "x",
			},
			(async (url) => {
				calls.push(String(url));
				return new Response(
					JSON.stringify({
						success: true,
						result: { delivered: ["support@gpio-companion.com"] },
					}),
				);
			}) as typeof fetch,
		);
		expect(calls[0]).toContain("/accounts/account/email/sending/send");
	});
});
