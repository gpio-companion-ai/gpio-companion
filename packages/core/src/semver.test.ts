import { describe, expect, it } from "bun:test";
import { compareVersions, isNewerVersion, parseVersion } from "./semver.ts";

describe("parseVersion", () => {
	it("parses stable versions", () => {
		expect(parseVersion("1.2.3")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: [],
		});
	});

	it("tolerates v prefix and missing parts", () => {
		expect(parseVersion("v2")).toEqual({
			major: 2,
			minor: 0,
			patch: 0,
			prerelease: [],
		});
	});

	it("parses prerelease identifiers", () => {
		expect(parseVersion("1.2.3-nightly.5")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: ["nightly", "5"],
		});
	});

	it("rejects garbage", () => {
		expect(parseVersion("not-a-version")).toBeNull();
	});
});

describe("compareVersions", () => {
	it("compares numerically", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
		expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
	});

	it("ranks releases above prereleases", () => {
		expect(compareVersions("1.2.3", "1.2.3-nightly.1")).toBe(1);
		expect(compareVersions("1.2.3-nightly.1", "1.2.3")).toBe(-1);
	});

	it("orders prerelease identifiers per semver", () => {
		expect(compareVersions("1.2.3-nightly.2", "1.2.3-nightly.1")).toBe(1);
		expect(compareVersions("1.2.3-nightly.10", "1.2.3-nightly.9")).toBe(1);
		expect(compareVersions("1.2.3-1", "1.2.3-alpha")).toBe(-1);
	});

	it("returns 0 when either side is unparsable", () => {
		expect(compareVersions("unknown", "1.0.0")).toBe(0);
	});
});

describe("isNewerVersion", () => {
	it("detects newer stable", () => {
		expect(isNewerVersion("1.1.0", "1.0.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
		expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
	});

	it("never treats a nightly as newer than its release", () => {
		expect(isNewerVersion("1.0.0-nightly.1", "1.0.0")).toBe(false);
		expect(isNewerVersion("1.0.0-nightly.2", "1.0.0-nightly.1")).toBe(true);
	});
});
