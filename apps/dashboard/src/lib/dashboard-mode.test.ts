import { describe, expect, test } from "bun:test";
import {
	DEVICE_TABS_EASY,
	deviceTabs,
	isExpertOnlyPath,
	parseDashboardMode,
	withSearch,
} from "./dashboard-mode.ts";

describe("parseDashboardMode", () => {
	test("defaults to easy", () => {
		expect(parseDashboardMode(undefined)).toBe("easy");
		expect(parseDashboardMode(null)).toBe("easy");
		expect(parseDashboardMode("easy")).toBe("easy");
		expect(parseDashboardMode("nope")).toBe("easy");
	});

	test("accepts expert", () => {
		expect(parseDashboardMode("expert")).toBe("expert");
	});
});

describe("deviceTabs", () => {
	test("easy hides pair requests debug admin and keys", () => {
		const hrefs = deviceTabs("easy", true).map((tab) => tab.href);
		expect(hrefs).toEqual(DEVICE_TABS_EASY.map((tab) => tab.href));
		expect(hrefs).not.toContain("/devices/pair");
		expect(hrefs).not.toContain("/devices/keys");
		expect(hrefs).not.toContain("/devices/debug");
		expect(hrefs).not.toContain("/devices/admin");
		expect(hrefs).toContain("/devices/wifi");
		expect(hrefs).not.toContain("/devices/code");
	});

	test("expert adds admin only for admins", () => {
		expect(deviceTabs("expert", false).map((tab) => tab.href)).not.toContain(
			"/devices/admin",
		);
		expect(deviceTabs("expert", true).map((tab) => tab.href)).toContain(
			"/devices/admin",
		);
		expect(deviceTabs("expert", true).map((tab) => tab.href)).not.toContain(
			"/devices/keys",
		);
		expect(deviceTabs("expert", false).map((tab) => tab.href)).not.toContain(
			"/devices/code",
		);
	});
});

describe("isExpertOnlyPath", () => {
	test("gates debug and admin", () => {
		expect(isExpertOnlyPath("/devices/debug")).toBe(true);
		expect(isExpertOnlyPath("/devices/admin")).toBe(true);
		expect(isExpertOnlyPath("/devices/wifi")).toBe(false);
		expect(isExpertOnlyPath("/devices")).toBe(false);
	});
});

describe("withSearch", () => {
	test("keeps github app callback query", () => {
		expect(withSearch("/profile/github", "?installation_id=1&state=ab")).toBe(
			"/profile/github?installation_id=1&state=ab",
		);
		expect(withSearch("/profile/github", "")).toBe("/profile/github");
	});
});
