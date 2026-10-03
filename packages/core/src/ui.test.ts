import { describe, expect, test } from "bun:test";
import type { DeviceAuthHeaders } from "./device-auth.ts";
import {
	isUiPath,
	isUiReplyFresh,
	newUiModalId,
	parseUiCommand,
	parseUiSocketMessage,
	UI_BODY_MAX,
	UI_BUTTON_LABEL_MAX,
	UI_BUTTONS_MAX,
	UI_DOCK_TABS,
	UI_MAX_SOCKETS,
	UI_NAVIGATE_TARGETS,
	UI_PATH,
	UI_PREVIEW_PATH_MAX,
	UI_REPLY_PREFIX,
	UI_TITLE_MAX,
	UI_TOAST_MAX,
	UiError,
	uiReplyIdFromPath,
	uiWsConnectUrl,
	uiWsUrl,
} from "./ui.ts";

const HEADERS: DeviceAuthHeaders = {
	"X-Gpio-Key-Id": "k",
	"X-Gpio-Timestamp": "1",
	"X-Gpio-Nonce": "n",
	"X-Gpio-Signature": "s",
};

describe("ui paths and urls", () => {
	test("path constants", () => {
		expect(UI_PATH).toBe("/v1/ui");
		expect(UI_REPLY_PREFIX).toBe("/v1/ui/reply/");
	});

	test("isUiPath matches command, listing, and reply routes", () => {
		expect(isUiPath("/v1/ui")).toBe(true);
		expect(isUiPath("/v1/ui/")).toBe(true);
		expect(isUiPath("/v1/ui/reply/abc")).toBe(true);
		expect(isUiPath("/v1/ui/reply/abc/")).toBe(true);
		expect(isUiPath("/v1/ui/reply/")).toBe(false);
		expect(isUiPath("/v1/ui/reply/a/b")).toBe(false);
		expect(isUiPath("/v1/console")).toBe(false);
		expect(isUiPath("/v1/uix")).toBe(false);
	});

	test("reply id from path", () => {
		expect(uiReplyIdFromPath("/v1/ui/reply/modal-1")).toBe("modal-1");
		expect(uiReplyIdFromPath("/v1/ui/reply/modal-1/")).toBe("modal-1");
		expect(uiReplyIdFromPath("/v1/ui")).toBe("");
	});

	test("ws url rewrites scheme", () => {
		expect(uiWsUrl("https://api-x.gpio-companion.com/")).toBe(
			"wss://api-x.gpio-companion.com/v1/ui",
		);
		expect(uiWsUrl("http://127.0.0.1:4150")).toBe("ws://127.0.0.1:4150/v1/ui");
	});

	test("connect url appends signed query", () => {
		const url = uiWsConnectUrl("https://api-x.gpio-companion.com", HEADERS);
		expect(url).toContain("/v1/ui?");
		expect(url).toContain("x-gpio-key-id=k");
	});
});

describe("parseUiCommand", () => {
	test("parses every command shape", () => {
		expect(parseUiCommand({ type: "navigate", target: "project" })).toEqual({
			type: "navigate",
			target: "project",
		});
		expect(parseUiCommand({ type: "dock", tab: "problems" })).toEqual({
			type: "dock",
			tab: "problems",
		});
		expect(parseUiCommand({ type: "palette", open: true })).toEqual({
			type: "palette",
			open: true,
		});
		expect(parseUiCommand({ type: "toast", text: "done" })).toEqual({
			type: "toast",
			text: "done",
		});
		const modal = parseUiCommand({
			type: "modal",
			id: "m1",
			title: "T",
			body: "B",
			buttons: ["Yes", "No"],
		});
		expect(modal).toEqual({
			type: "modal",
			id: "m1",
			title: "T",
			body: "B",
			buttons: ["Yes", "No"],
		});
		expect(
			parseUiCommand({
				type: "preview",
				repo: "blink-led",
				path: "host/blink/main.c",
			}),
		).toEqual({
			type: "preview",
			repo: "blink-led",
			path: "host/blink/main.c",
		});
	});

	test("rejects unknown shapes", () => {
		expect(() => parseUiCommand(null)).toThrow(UiError);
		expect(() => parseUiCommand([])).toThrow(UiError);
		expect(() => parseUiCommand({ type: "run" })).toThrow("unknown ui command");
		expect(() =>
			parseUiCommand({ type: "navigate", target: "settings" }),
		).toThrow("unknown navigate target");
		expect(() => parseUiCommand({ type: "dock", tab: "serial" })).toThrow(
			"unknown dock tab",
		);
		expect(() => parseUiCommand({ type: "palette", open: "yes" })).toThrow(
			"boolean",
		);
		expect(() => parseUiCommand({ type: "toast", text: "" })).toThrow(
			"toast text",
		);
		expect(() =>
			parseUiCommand({ type: "preview", repo: "", path: "a.c" }),
		).toThrow("preview repo");
		expect(() =>
			parseUiCommand({ type: "preview", repo: "blink-led", path: "" }),
		).toThrow("preview path");
		expect(() =>
			parseUiCommand({ type: "preview", repo: "blink-led", path: "../x" }),
		).toThrow("preview path");
		expect(
			parseUiCommand({ type: "preview", repo: "blink-led", path: "/abs" }),
		).toEqual({ type: "preview", repo: "blink-led", path: "abs" });
		expect(() =>
			parseUiCommand({ type: "preview", repo: "..", path: "a.c" }),
		).toThrow();
		expect(() =>
			parseUiCommand({
				type: "preview",
				repo: "blink-led",
				path: `a/${"x".repeat(UI_PREVIEW_PATH_MAX)}`,
			}),
		).toThrow("too long");
	});

	test("caps text lengths", () => {
		const toast = parseUiCommand({
			type: "toast",
			text: "x".repeat(UI_TOAST_MAX + 50),
		});
		if (toast.type !== "toast") {
			throw new Error("expected toast");
		}
		expect(toast.text.length).toBe(UI_TOAST_MAX);
		const longTitle = parseUiCommand({
			type: "modal",
			id: "m",
			title: "t".repeat(UI_TITLE_MAX + 10),
			body: "b".repeat(UI_BODY_MAX + 10),
			buttons: ["y".repeat(UI_BUTTON_LABEL_MAX + 5), "n"],
		});
		if (longTitle.type !== "modal") {
			throw new Error("expected modal");
		}
		expect(longTitle.title.length).toBe(UI_TITLE_MAX);
		expect(longTitle.body.length).toBe(UI_BODY_MAX);
		expect((longTitle.buttons[0] ?? "").length).toBe(UI_BUTTON_LABEL_MAX);
	});

	test("rejects bad modals", () => {
		expect(() =>
			parseUiCommand({
				type: "modal",
				id: "",
				title: "t",
				body: "b",
				buttons: ["a"],
			}),
		).toThrow("modal id");
		const four = Array.from({ length: UI_BUTTONS_MAX + 1 }, () => "a");
		expect(() =>
			parseUiCommand({
				type: "modal",
				id: "m",
				title: "t",
				body: "b",
				buttons: four,
			}),
		).toThrow("buttons");
		expect(() =>
			parseUiCommand({
				type: "modal",
				id: "m",
				title: "t",
				body: "b",
				buttons: [],
			}),
		).toThrow("buttons");
		expect(() =>
			parseUiCommand({
				type: "modal",
				id: "m",
				title: "t",
				body: "",
				buttons: ["a"],
			}),
		).toThrow("body");
	});
});

describe("parseUiSocketMessage", () => {
	test("parses hello and reply", () => {
		expect(
			parseUiSocketMessage({ op: "hello", surface: "web", focused: true }),
		).toEqual({ op: "hello", surface: "web", focused: true });
		expect(parseUiSocketMessage({ op: "hello", surface: "mobile" })).toEqual({
			op: "hello",
			surface: "mobile",
			focused: false,
		});
		expect(
			parseUiSocketMessage({ op: "reply", id: "m1", action: "Okay" }),
		).toEqual({ op: "reply", id: "m1", action: "Okay" });
	});

	test("rejects unknown ops and bad surfaces", () => {
		expect(() => parseUiSocketMessage({ op: "refresh" })).toThrow(
			"unknown ui message",
		);
		expect(() =>
			parseUiSocketMessage({ op: "hello", surface: "cli", focused: true }),
		).toThrow("unknown ui surface");
		expect(() =>
			parseUiSocketMessage({ op: "reply", id: " ", action: "x" }),
		).toThrow("reply id");
		expect(() =>
			parseUiSocketMessage({ op: "reply", id: "m1", action: "" }),
		).toThrow("reply action");
	});
});

describe("reply freshness and modal ids", () => {
	test("fresh window", () => {
		const now = 1_000_000;
		expect(isUiReplyFresh(now, now)).toBe(true);
		expect(isUiReplyFresh(now - 120_000, now)).toBe(true);
		expect(isUiReplyFresh(now - 120_001, now)).toBe(false);
	});

	test("modal ids are unique", () => {
		expect(newUiModalId()).not.toBe(newUiModalId());
	});
});

describe("closed sets", () => {
	test("targets and tabs are the locked set", () => {
		expect([...UI_NAVIGATE_TARGETS]).toEqual([
			"project",
			"code",
			"docs",
			"devices",
			"pair",
			"wifi",
			"keys",
			"requests",
			"debug",
			"admin",
			"profile",
			"github",
			"credits",
		]);
		expect([...UI_DOCK_TABS]).toEqual([
			"console",
			"gpio",
			"flash",
			"problems",
			"actions",
			"ssh",
		]);
		expect(UI_MAX_SOCKETS).toBe(8);
	});
});
