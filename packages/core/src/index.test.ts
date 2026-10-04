import { describe, expect, test } from "bun:test";
import { version as rootVersion } from "../../../package.json";
import { greet, PACKAGE_NAME, VERSION } from "./index.ts";

describe("gpio-companion", () => {
	test("exports package identity", () => {
		expect(PACKAGE_NAME).toBe("gpio-companion");
		expect(VERSION).toBe(rootVersion);
	});

	test("greets from a workspace", () => {
		expect(greet("binary")).toBe("hello from binary");
	});
});
