import { describe, expect, test } from "bun:test";
import {
	supportReportLimit,
	supportReportSince,
} from "./support-reports.ts";

describe("support report list query", () => {
	test("caps the page size", () => {
		expect(supportReportLimit(null)).toBe(50);
		expect(supportReportLimit("1000")).toBe(100);
		expect(supportReportLimit("0")).toBe(50);
	});

	test("rejects a bad since cursor", () => {
		expect(supportReportSince("2026-10-05T00:00:00.000Z")).toBe(
			"2026-10-05T00:00:00.000Z",
		);
		expect(() => supportReportSince("yesterday")).toThrow("since is invalid");
	});
});
