import { describe, expect, test } from "bun:test";
import {
	applyOpencodeEvent,
	emptyOpencodeView,
	opencodeClientRequest,
	opencodeProjectDirectory,
	opencodeProxyAllows,
	opencodeRepoNameFromSelection,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeTurns,
	parseOpencodeMarkdown,
	parseOpencodeSse,
	pendingOpencodeTurn,
	scopeOpencodeSearch,
	settleOpencodeTurns,
} from "./opencode-session.ts";

describe("opencode session client", () => {
	test("scopes a repo under the projects root and rejects escape", () => {
		expect(
			opencodeProjectDirectory("/home/companion/projects", "blink-led"),
		).toBe("/home/companion/projects/blink-led");
		expect(opencodeRepoNameFromSelection("ada/blink-led")).toBe("blink-led");
		expect(() =>
			opencodeProjectDirectory("/home/companion/projects", "../etc"),
		).toThrow("invalid project");
		expect(() => opencodeProjectDirectory("projects", "blink-led")).toThrow(
			"invalid project",
		);
	});

	test("allowlists session, event, and permission routes only", () => {
		expect(opencodeProxyAllows("/v1/opencode/session")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/event")).toBe(true);
		expect(
			opencodeProxyAllows("/v1/opencode/session/ses_1/permissions/per_1"),
		).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/question/req_1/reply")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/file")).toBe(false);
		expect(opencodeProxyAllows("/v1/opencode/session/ses_1/shell")).toBe(false);
		expect(opencodeProxyAllows("/v1/opencode/find")).toBe(false);
		expect(opencodeProxyAllows("/v1/opencode/pty")).toBe(false);
	});

	test("builds prompt, abort, and permission calls without file routes", () => {
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
			}),
		).toEqual({
			method: "POST",
			path: "/session/ses_1/prompt_async",
			body: { parts: [{ type: "text", text: "blink the LED" }] },
		});
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "permission",
				sessionID: "ses_1",
				permissionID: "per_1",
				response: "once",
			}).path,
		).toBe("/session/ses_1/permissions/per_1");
		expect(() =>
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "../file",
				text: "no",
			}),
		).toThrow("invalid session");
	});

	test("forces directory onto the selected project", () => {
		expect(
			scopeOpencodeSearch({
				path: "/v1/opencode/event",
				search: "?directory=%2Fetc",
				repo: "blink-led",
				projectsDir: "/home/companion/projects",
			}),
		).toEqual({
			search: "?directory=%2Fhome%2Fcompanion%2Fprojects%2Fblink-led",
			directory: "/home/companion/projects/blink-led",
		});
		expect(() =>
			scopeOpencodeSearch({
				path: "/v1/opencode/file",
				search: "",
				repo: "blink-led",
				projectsDir: "/home/companion/projects",
			}),
		).toThrow("opencode route is not available");
	});

	test("applies streamed text and permission prompts", () => {
		const listed = opencodeSessions([
			{ id: "ses_1", title: "LED", time: { updated: 2 } },
		]);
		expect(listed[0]?.title).toBe("LED");
		expect(
			opencodeTurns([
				{
					info: { id: "msg_1", role: "user" },
					parts: [{ type: "text", text: "blink" }],
				},
			])[0]?.text,
		).toBe("blink");
		let view = {
			...emptyOpencodeView(),
			sessionID: "ses_1",
			sessions: listed,
		};
		view = applyOpencodeEvent(view, {
			payload: {
				type: "message.part.delta",
				properties: {
					sessionID: "ses_1",
					messageID: "msg_2",
					delta: "On pin ",
				},
			},
		});
		view = applyOpencodeEvent(view, {
			type: "permission.asked",
			properties: {
				id: "per_1",
				sessionID: "ses_1",
				permission: "bash",
				patterns: ["gpio"],
			},
		});
		expect(view.turns[0]?.text).toBe("On pin ");
		expect(view.permissions[0]?.title).toBe("bash");
		expect(view.busy).toBe(true);
		const parsed = parseOpencodeSse(
			'id: 7\ndata: {"type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n',
		);
		expect(parsed.events[0]?.id).toBe("7");
		expect(applyOpencodeEvent(view, parsed.events[0]?.data).busy).toBe(false);
	});

	test("upserts a tool part instead of appending its name", () => {
		let view = { ...emptyOpencodeView(), sessionID: "ses_1" };
		const event = {
			type: "message.part.updated",
			properties: {
				sessionID: "ses_1",
				part: {
					id: "prt_1",
					messageID: "msg_2",
					type: "tool",
					tool: "bash",
					state: { status: "running", title: "gpioinfo" },
				},
			},
		};
		view = applyOpencodeEvent(view, event);
		view = applyOpencodeEvent(view, {
			...event,
			properties: {
				...event.properties,
				part: {
					...event.properties.part,
					state: { status: "completed", title: "gpioinfo" },
				},
			},
		});
		expect(view.turns).toHaveLength(1);
		expect(view.turns[0]?.text).toBe("");
		expect(view.turns[0]?.parts).toHaveLength(1);
		expect(view.turns[0]?.parts[0]?.tool).toBe("bash");
		expect(view.turns[0]?.parts[0]?.status).toBe("done");
	});

	test("replaces a pending prompt when the server echoes it", () => {
		const pending = pendingOpencodeTurn("blink the LED", 1);
		const view = applyOpencodeEvent(
			{ ...emptyOpencodeView(), sessionID: "ses_1", turns: [pending] },
			{
				type: "message.part.updated",
				properties: {
					sessionID: "ses_1",
					part: {
						id: "prt_user",
						messageID: "msg_user",
						type: "text",
						text: "blink the LED",
					},
				},
			},
		);
		expect(view.turns).toHaveLength(1);
		expect(view.turns[0]?.id).toBe("msg_user");
		expect(view.turns[0]?.pending).toBe(false);
		expect(view.turns[0]?.role).toBe("user");
	});

	test("keeps an unmatched pending turn when messages reload", () => {
		const pending = pendingOpencodeTurn("blink", 2);
		const settled = settleOpencodeTurns(
			[pending],
			opencodeTurns([
				{
					info: { id: "msg_1", role: "assistant" },
					parts: [{ type: "text", text: "working" }],
				},
			]),
		);
		expect(settled.map((turn) => turn.id)).toEqual(["msg_1", pending.id]);
	});

	test("parses headings, lists, and fenced code", () => {
		expect(
			parseOpencodeMarkdown("See\n\n- pin 7\n- GND\n\n```c\nloop();\n```"),
		).toEqual([
			{ type: "paragraph", inlines: [{ type: "text", text: "See" }] },
			{
				type: "list",
				ordered: false,
				start: 1,
				items: [
					{ inlines: [{ type: "text", text: "pin 7" }], blocks: [] },
					{ inlines: [{ type: "text", text: "GND" }], blocks: [] },
				],
			},
			{ type: "code", lang: "c", text: "loop();" },
		]);
	});

	test("parses inline marks, links, and tables", () => {
		expect(
			parseOpencodeMarkdown(
				"Use **pin** `7` and [docs](https://gpio-companion.com).",
			),
		).toEqual([
			{
				type: "paragraph",
				inlines: [
					{ type: "text", text: "Use " },
					{ type: "strong", inlines: [{ type: "text", text: "pin" }] },
					{ type: "text", text: " " },
					{ type: "code", text: "7" },
					{ type: "text", text: " and " },
					{
						type: "link",
						href: "https://gpio-companion.com",
						inlines: [{ type: "text", text: "docs" }],
					},
					{ type: "text", text: "." },
				],
			},
		]);
		expect(
			parseOpencodeMarkdown("| Pin | Net |\n| --- | --- |\n| 7 | LED |"),
		).toEqual([
			{
				type: "table",
				aligns: [null, null],
				header: [
					[{ type: "text", text: "Pin" }],
					[{ type: "text", text: "Net" }],
				],
				rows: [
					[[{ type: "text", text: "7" }], [{ type: "text", text: "LED" }]],
				],
			},
		]);
	});

	test("keeps raw HTML and unsafe links as text", () => {
		expect(parseOpencodeMarkdown("<script>alert(1)</script>")).toEqual([
			{
				type: "paragraph",
				inlines: [{ type: "text", text: "<script>alert(1)</script>" }],
			},
		]);
		expect(parseOpencodeMarkdown("[x](javascript:alert(1))")).toEqual([
			{
				type: "paragraph",
				inlines: [{ type: "text", text: "x" }],
			},
		]);
	});

	test("treats an unclosed fence as code and leaves unclosed marks literal", () => {
		expect(parseOpencodeMarkdown("```ts\nconst x = 1")).toEqual([
			{ type: "code", lang: "ts", text: "const x = 1" },
		]);
		expect(parseOpencodeMarkdown("wait **for")).toEqual([
			{
				type: "paragraph",
				inlines: [{ type: "text", text: "wait **for" }],
			},
		]);
	});

	test("buckets sessions by local day", () => {
		const now = new Date(2026, 8, 29, 15, 0, 0).getTime();
		expect(opencodeSessionBucket(now - 60_000, now)).toBe("today");
		expect(
			opencodeSessionBucket(new Date(2026, 8, 28, 12, 0, 0).getTime(), now),
		).toBe("yesterday");
		expect(
			opencodeSessionBucket(new Date(2026, 8, 26, 12, 0, 0).getTime(), now),
		).toBe("earlier");
	});
});
