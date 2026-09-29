import { describe, expect, test } from "bun:test";
import {
	applyOpencodeEvent,
	emptyOpencodeView,
	opencodeClientRequest,
	opencodeProjectDirectory,
	opencodeProxyAllows,
	opencodeRepoNameFromSelection,
	opencodeSessions,
	opencodeTurns,
	parseOpencodeSse,
	scopeOpencodeSearch,
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
});
