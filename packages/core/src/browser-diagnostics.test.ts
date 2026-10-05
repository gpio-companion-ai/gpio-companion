import { describe, expect, test } from "bun:test";
import { parseUiCommand } from "./ui.ts";
import {
	readBrowserDiagnostics,
	recordBrowserConsole,
	recordBrowserNetwork,
} from "./browser-diagnostics.ts";

describe("browser diagnostics", () => {
	test("keeps console errors and failed requests, and strips secrets", () => {
		recordBrowserConsole("error", "token=supersecretvalue");
		recordBrowserNetwork("POST", "https://gpio-companion.com/api/support?token=abc", 500);
		recordBrowserNetwork("GET", "https://gpio-companion.com/api/health", 200);
		const snap = readBrowserDiagnostics();
		expect(snap.console.at(-1)?.text).toContain("[redacted]");
		expect(snap.console.at(-1)?.text).not.toContain("supersecretvalue");
		expect(snap.network.at(-1)?.path).toBe("/api/support");
		expect(snap.network.at(-1)?.status).toBe(500);
		expect(snap.network.some((line) => line.status === 200)).toBe(false);
	});

	test("parses a diagnostics command", () => {
		expect(parseUiCommand({ type: "diagnostics", id: "d1" })).toEqual({
			type: "diagnostics",
			id: "d1",
		});
	});
});
