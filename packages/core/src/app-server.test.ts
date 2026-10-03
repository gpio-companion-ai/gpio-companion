import { describe, expect, test } from "bun:test";
import {
	APP_PATH,
	APP_START_PATH,
	APP_STOP_PATH,
	APP_TOKEN_MIN_LENGTH,
	appFrameBasePath,
	appFrameUrl,
	appFrameWsUrl,
	appNameFromMintPath,
	capAppLog,
	isAppFrameMintPath,
	isAppManagePath,
	isAppName,
	isAppPort,
	isAppTokenFresh,
	isValidAppToken,
	newAppToken,
	parseAppFramePath,
	parseAppStartPut,
} from "./app-server.ts";
import { parseUiCommand, UiError } from "./ui.ts";

const TOKEN = "a".repeat(43);

describe("app names and tokens", () => {
	test("isAppName accepts kebab-case and rejects reserved", () => {
		expect(isAppName("led-panel")).toBe(true);
		expect(isAppName("a")).toBe(true);
		expect(isAppName("Led")).toBe(false);
		expect(isAppName("led_panel")).toBe(false);
		expect(isAppName("")).toBe(false);
		expect(isAppName("x".repeat(65))).toBe(false);
		expect(isAppName("start")).toBe(false);
		expect(isAppName("stop")).toBe(false);
		expect(isAppName("frame")).toBe(false);
	});

	test("newAppToken is base64url and unguessable", () => {
		const token = newAppToken();
		expect(token.length).toBeGreaterThanOrEqual(APP_TOKEN_MIN_LENGTH);
		expect(isValidAppToken(token)).toBe(true);
		expect(newAppToken()).not.toBe(token);
		expect(isValidAppToken("short")).toBe(false);
		expect(isValidAppToken("bad chars!")).toBe(false);
	});

	test("token freshness", () => {
		const now = Date.now();
		expect(isAppTokenFresh(now + 1_000, now)).toBe(true);
		expect(isAppTokenFresh(now - 1_000, now)).toBe(false);
	});

	test("port range", () => {
		expect(isAppPort(4600)).toBe(true);
		expect(isAppPort(4619)).toBe(true);
		expect(isAppPort(4599)).toBe(false);
		expect(isAppPort(4620)).toBe(false);
		expect(isAppPort(4600.5)).toBe(false);
	});
});

describe("app path predicates", () => {
	test("management paths", () => {
		expect(APP_PATH).toBe("/v1/app");
		expect(APP_START_PATH).toBe("/v1/app/start");
		expect(APP_STOP_PATH).toBe("/v1/app/stop");
		expect(isAppManagePath("/v1/app")).toBe(true);
		expect(isAppManagePath("/v1/app/start")).toBe(true);
		expect(isAppManagePath("/v1/app/stop")).toBe(true);
		expect(isAppManagePath("/v1/app/led-panel/frame")).toBe(true);
		expect(isAppManagePath("/v1/app/led-panel/abc")).toBe(false);
		expect(isAppManagePath("/v1/arduino-proxy")).toBe(false);
	});

	test("frame mint path parsing", () => {
		expect(isAppFrameMintPath("/v1/app/led-panel/frame")).toBe(true);
		expect(isAppFrameMintPath("/v1/app/led-panel/frame/")).toBe(true);
		expect(isAppFrameMintPath("/v1/app/frame")).toBe(false);
		expect(isAppFrameMintPath("/v1/app/led-panel/frame/x")).toBe(false);
		expect(appNameFromMintPath("/v1/app/led-panel/frame")).toBe("led-panel");
		expect(appNameFromMintPath("/v1/app")).toBe("");
	});

	test("parseAppFramePath splits name, token, suffix", () => {
		expect(parseAppFramePath(`/v1/app/led-panel/${TOKEN}`)).toEqual({
			name: "led-panel",
			token: TOKEN,
			suffix: "/",
		});
		expect(parseAppFramePath(`/v1/app/led-panel/${TOKEN}/`)).toEqual({
			name: "led-panel",
			token: TOKEN,
			suffix: "/",
		});
		expect(
			parseAppFramePath(`/v1/app/led-panel/${TOKEN}/api/data?x=1#f`),
		).toEqual({
			name: "led-panel",
			token: TOKEN,
			suffix: "/api/data",
		});
		expect(parseAppFramePath("/v1/app/led-panel")).toBeNull();
		expect(parseAppFramePath("/v1/app/led-panel/short")).toBeNull();
		expect(parseAppFramePath("/v1/app/led-panel/frame")).toBeNull();
		expect(parseAppFramePath(`/v1/other/led-panel/${TOKEN}`)).toBeNull();
	});

	test("frame url builders", () => {
		expect(appFrameBasePath("led-panel", TOKEN)).toBe(
			`/v1/app/led-panel/${TOKEN}`,
		);
		expect(
			appFrameUrl("https://api-x.gpio-companion.com/", "led-panel", TOKEN),
		).toBe(`https://api-x.gpio-companion.com/v1/app/led-panel/${TOKEN}/`);
		expect(
			appFrameUrl(
				"https://api-x.gpio-companion.com",
				"led-panel",
				TOKEN,
				"api/data",
			),
		).toBe(
			`https://api-x.gpio-companion.com/v1/app/led-panel/${TOKEN}/api/data`,
		);
		expect(
			appFrameWsUrl("https://api-x.gpio-companion.com", "led-panel", TOKEN),
		).toBe(`wss://api-x.gpio-companion.com/v1/app/led-panel/${TOKEN}/`);
		expect(appFrameWsUrl("http://127.0.0.1:4150", "led-panel", TOKEN)).toBe(
			`ws://127.0.0.1:4150/v1/app/led-panel/${TOKEN}/`,
		);
	});
});

describe("parseAppStartPut", () => {
	test("accepts a valid start body", () => {
		expect(
			parseAppStartPut({
				repo: "blink-led",
				name: "led-panel",
				entry: "app/led-panel/server.ts",
			}),
		).toEqual({
			repo: "blink-led",
			name: "led-panel",
			entry: "app/led-panel/server.ts",
		});
	});

	test("rejects bad repo, name, entry", () => {
		expect(() => parseAppStartPut(null)).toThrow();
		expect(() => parseAppStartPut({ name: "a", entry: "a.ts" })).toThrow();
		expect(() =>
			parseAppStartPut({ repo: "a/b", name: "a", entry: "a.ts" }),
		).toThrow();
		expect(() =>
			parseAppStartPut({ repo: "a", name: "Start", entry: "a.ts" }),
		).toThrow();
		expect(() =>
			parseAppStartPut({ repo: "a", name: "a", entry: "/abs/a.ts" }),
		).toThrow();
		expect(() =>
			parseAppStartPut({ repo: "a", name: "a", entry: "../a.ts" }),
		).toThrow();
		expect(() =>
			parseAppStartPut({ repo: "a", name: "a", entry: "server.py" }),
		).toThrow();
	});
});

describe("capAppLog", () => {
	test("caps the log tail", () => {
		expect(capAppLog("short")).toBe("short");
		const long = "x".repeat(20 * 1024);
		expect(capAppLog(long).length).toBe(16 * 1024);
	});
});

describe("parseUiCommand app", () => {
	test("parses app command with defaults", () => {
		expect(parseUiCommand({ type: "app", appId: "led-panel" })).toEqual({
			type: "app",
			appId: "led-panel",
			view: "split",
			title: "led-panel",
		});
		expect(
			parseUiCommand({
				type: "app",
				appId: "led-panel",
				view: "modal",
				title: "LED Panel",
			}),
		).toEqual({
			type: "app",
			appId: "led-panel",
			view: "modal",
			title: "LED Panel",
		});
	});

	test("rejects invalid app commands", () => {
		expect(() => parseUiCommand({ type: "app" })).toThrow(UiError);
		expect(() => parseUiCommand({ type: "app", appId: "no Good" })).toThrow(
			UiError,
		);
		expect(() =>
			parseUiCommand({ type: "app", appId: "a", view: "dock" }),
		).toThrow(UiError);
	});
});
