import { describe, expect, test } from "bun:test";
import { DEFAULT_AI_MODEL } from "./ai-pricing.ts";
import {
	applyOpencodeEvent,
	CODE_DEFAULT_MODEL,
	codeNavHref,
	emptyOpencodeView,
	holdOpencodePromptEvent,
	noteOpencodePrompt,
	opencodeClientRequest,
	opencodeEventFrame,
	opencodeEventLastId,
	opencodeEventPath,
	opencodeEventResumeUrl,
	opencodeEventWsConnectUrl,
	opencodeModelChoices,
	opencodePermissions,
	opencodeProjectDirectory,
	opencodePromptDropID,
	opencodePromptFields,
	opencodeProxyAllows,
	opencodeQuestions,
	opencodeReplyAccepted,
	opencodeRepoNameFromSelection,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeStoredEffort,
	opencodeStoredModel,
	opencodeStoredPermissionMode,
	opencodeToolStacks,
	opencodeTurns,
	parseOpencodeEventFrame,
	parseOpencodeEventPath,
	parseOpencodeMarkdown,
	parseOpencodeSse,
	pendingOpencodeFromMessages,
	pendingOpencodeTurn,
	readCodeNav,
	readStoredOpencodePrompts,
	recoverOpencodePrompts,
	releaseSettledPromptHolds,
	rememberOpencodePrompt,
	restoreOpencodePrompts,
	restoreOpencodeViewPrompts,
	scopeOpencodeSearch,
	seedOpencodePrompts,
	settleOpencodeTurns,
} from "./opencode-session.ts";

describe("opencode session client", () => {
	test("registers a session in the code URL", () => {
		expect(readCodeNav("")).toEqual({ mode: "home", sessionID: "" });
		expect(readCodeNav("?session=draft")).toEqual({
			mode: "draft",
			sessionID: "",
		});
		expect(readCodeNav("?session=ses_1")).toEqual({
			mode: "session",
			sessionID: "ses_1",
		});
		expect(
			codeNavHref("https://gpio-companion.com/devices/code", {
				mode: "session",
				sessionID: "ses_1",
			}),
		).toBe("/devices/code?session=ses_1");
		expect(
			codeNavHref("https://gpio-companion.com/devices/code?session=ses_1", {
				mode: "home",
				sessionID: "",
			}),
		).toBe("/devices/code");
	});

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

	test("signs the event socket path and keeps the resume cursor out of it", () => {
		expect(opencodeEventPath("blink-led")).toBe("/v1/opencode/event/blink-led");
		expect(parseOpencodeEventPath("/v1/opencode/event/blink-led")).toBe(
			"blink-led",
		);
		expect(parseOpencodeEventPath("/v1/opencode/event")).toBeNull();
		expect(parseOpencodeEventPath("/v1/opencode/event/../etc")).toBeNull();
		expect(opencodeEventLastId("evt_1")).toBe("evt_1");
		expect(opencodeEventLastId("bad\nid")).toBe("");
		const headers = {
			"X-Gpio-Key-Id": "k",
			"X-Gpio-Timestamp": "1",
			"X-Gpio-Nonce": "n",
			"X-Gpio-Signature": "sig",
		};
		const wsUrl = opencodeEventWsConnectUrl(
			"https://api-abc.gpio-companion.com",
			"blink-led",
			headers,
		);
		expect(
			wsUrl.startsWith(
				"wss://api-abc.gpio-companion.com/v1/opencode/event/blink-led?",
			),
		).toBe(true);
		expect(wsUrl).not.toContain("last=");
		expect(opencodeEventResumeUrl(wsUrl, "evt_9")).toContain("last=evt_9");
		expect(opencodeEventResumeUrl(wsUrl, "bad\nid")).toBe(wsUrl);
		const frame = opencodeEventFrame("evt_9", { type: "session.idle" });
		expect(parseOpencodeEventFrame(frame)).toEqual({
			id: "evt_9",
			data: { type: "session.idle" },
		});
		expect(parseOpencodeEventFrame("nope")).toBeNull();
	});

	test("allowlists session, event, and permission routes only", () => {
		expect(opencodeProxyAllows("/v1/opencode/session")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/session/ses_1")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/event")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/event/demo")).toBe(false);
		expect(
			opencodeProxyAllows("/v1/opencode/session/ses_1/permissions/per_1"),
		).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/question")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/permission")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/permission-mode")).toBe(true);
		expect(opencodeProxyAllows("/v1/opencode/permission/per_1")).toBe(false);
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
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
				model: DEFAULT_AI_MODEL,
				variant: "high",
			}).body,
		).toEqual({
			parts: [{ type: "text", text: "blink the LED" }],
			model: {
				providerID: "gpio-companion",
				modelID: DEFAULT_AI_MODEL,
			},
			variant: "high",
		});
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
				model: "@cf/meta/llama-3.2-1b-instruct",
				variant: "high",
			}).body,
		).toEqual({
			parts: [{ type: "text", text: "blink the LED" }],
			model: {
				providerID: "gpio-companion",
				modelID: "@cf/meta/llama-3.2-1b-instruct",
			},
		});
		expect(() =>
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
				model: "gpt-4",
			}),
		).toThrow("invalid model");
		expect(() =>
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
				model: DEFAULT_AI_MODEL,
				variant: "max" as "low",
			}),
		).toThrow("invalid effort");
		expect(opencodeStoredModel("nope")).toBe(CODE_DEFAULT_MODEL);
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "prompt",
				sessionID: "ses_1",
				text: "blink the LED",
				model: CODE_DEFAULT_MODEL,
				variant: "medium",
			}).body,
		).toEqual({
			parts: [{ type: "text", text: "blink the LED" }],
			model: {
				providerID: "opencode",
				modelID: CODE_DEFAULT_MODEL,
			},
			variant: "medium",
		});
		expect(opencodeStoredEffort("nope")).toBe("medium");
		expect(opencodeStoredPermissionMode("full")).toBe("full");
		expect(opencodeStoredPermissionMode("nope")).toBe("ask");
		expect(opencodeStoredPermissionMode(null)).toBe("ask");
		expect(opencodePromptFields(DEFAULT_AI_MODEL, "low")).toEqual({
			model: DEFAULT_AI_MODEL,
			variant: "low",
		});
		expect(
			opencodeModelChoices().some(
				(item) => item.id === DEFAULT_AI_MODEL && item.reasoning,
			),
		).toBe(true);
		expect(
			opencodeModelChoices().find((item) => item.id === CODE_DEFAULT_MODEL)
				?.provider,
		).toBe("OpenCode");
		expect(
			opencodeModelChoices().find((item) => item.id === DEFAULT_AI_MODEL)
				?.provider,
		).toBe("Zai Org");
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
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "questions",
			}),
		).toEqual({ method: "GET", path: "/question" });
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "permissions",
			}),
		).toEqual({ method: "GET", path: "/permission" });
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "permission-mode",
			}),
		).toEqual({ method: "GET", path: "/permission-mode" });
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "permission-mode",
				mode: "full",
			}),
		).toEqual({
			method: "POST",
			path: "/permission-mode",
			body: { mode: "full" },
		});
		expect(() =>
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "permission-mode",
				mode: "once" as never,
			}),
		).toThrow("invalid permission mode");
		expect(
			opencodeClientRequest({
				uuid: "board",
				repo: "blink-led",
				op: "delete",
				sessionID: "ses_1",
			}),
		).toEqual({
			method: "DELETE",
			path: "/session/ses_1",
		});
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

	test("keeps capped tool input and output", () => {
		const view = applyOpencodeEvent(
			{ ...emptyOpencodeView(), sessionID: "ses_1" },
			{
				type: "message.part.updated",
				properties: {
					sessionID: "ses_1",
					part: {
						id: "prt_1",
						messageID: "msg_2",
						type: "tool",
						tool: "bash",
						state: {
							status: "error",
							input: { command: "ls" },
							output: "x".repeat(5_000),
							error: "failed",
						},
					},
				},
			},
		);
		const part = view.turns[0]?.parts[0];
		expect(part?.input).toContain('"command": "ls"');
		expect(part?.output?.startsWith("…")).toBe(true);
		expect(part?.output?.length).toBe(4_001);
		expect(part?.output).toContain("failed");
	});

	test("batches adjacent tool calls and keeps text between stacks", () => {
		expect(
			opencodeToolStacks([
				{
					id: "t1",
					type: "text",
					text: "See",
					tool: "",
					status: "done",
				},
				{
					id: "a",
					type: "tool",
					text: "ls",
					tool: "bash",
					status: "done",
				},
				{
					id: "b",
					type: "tool",
					text: "pin",
					tool: "read",
					status: "running",
				},
				{
					id: "t2",
					type: "text",
					text: "Done",
					tool: "",
					status: "done",
				},
			]),
		).toEqual([
			{ type: "text", id: "t1", text: "See" },
			{
				type: "tools",
				id: "a",
				parts: [
					{
						id: "a",
						type: "tool",
						text: "ls",
						tool: "bash",
						status: "done",
					},
					{
						id: "b",
						type: "tool",
						text: "pin",
						tool: "read",
						status: "running",
					},
				],
			},
			{ type: "text", id: "t2", text: "Done" },
		]);
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

	test("restores pending questions and permissions after reload", () => {
		const asked = {
			id: "que_1",
			sessionID: "ses_1",
			questions: [
				{
					header: "LED",
					question: "Which pin?",
					options: [{ label: "7" }, { label: "11" }],
				},
			],
		};
		expect(opencodeQuestions([asked])[0]).toEqual({
			id: "que_1",
			sessionID: "ses_1",
			prompts: [
				{ header: "LED", question: "Which pin?", options: ["7", "11"] },
			],
		});
		expect(opencodeQuestions({ data: [asked] }).map((item) => item.id)).toEqual(
			["que_1"],
		);
		expect(
			opencodePermissions([
				{
					id: "per_1",
					sessionID: "ses_1",
					permission: "bash",
					patterns: ["git push"],
				},
			])[0],
		).toEqual({
			id: "per_1",
			sessionID: "ses_1",
			title: "bash",
			detail: "git push",
		});
		expect(
			opencodePermissions([
				{
					id: "per_2",
					sessionID: "ses_1",
					action: "edit",
					resources: ["src/main.c"],
				},
			])[0]?.title,
		).toBe("edit");
		const current = {
			...emptyOpencodeView(),
			sessionID: "ses_1",
			questions: [
				{
					id: "que_live",
					sessionID: "ses_1",
					prompts: [{ header: "", question: "live", options: [] }],
				},
			],
		};
		const restored = restoreOpencodeViewPrompts(current, "ses_1", {
			questions: [asked],
			permissions: [
				{
					id: "per_1",
					sessionID: "ses_1",
					permission: "bash",
					patterns: ["git push"],
				},
			],
			stale: false,
			dropped: new Set(),
		});
		expect(restored.questions.map((item) => item.id)).toEqual(["que_1"]);
		expect(restored.permissions.map((item) => item.id)).toEqual(["per_1"]);
		const epoch = { epoch: 0, dropped: new Set<string>() };
		noteOpencodePrompt({ type: "question.asked", properties: asked }, epoch);
		noteOpencodePrompt(
			{
				type: "question.replied",
				properties: { sessionID: "ses_1", requestID: "que_1" },
			},
			epoch,
		);
		expect(opencodeQuestions({ nope: true })).toBeNull();
		const store = new Map<string, string>();
		const previousSession = globalThis.sessionStorage;
		const previousLocal = globalThis.localStorage;
		const mock = {
			getItem: (key) => store.get(key) ?? null,
			setItem: (key, value) => {
				store.set(key, value);
			},
			removeItem: (key) => {
				store.delete(key);
			},
			clear: () => {
				store.clear();
			},
			key: () => null,
			length: 0,
		};
		globalThis.sessionStorage = mock;
		globalThis.localStorage = mock;
		rememberOpencodePrompt({ type: "question.asked", properties: asked });
		expect(
			readStoredOpencodePrompts("ses_1").questions.map((item) => item.id),
		).toEqual(["que_1"]);
		rememberOpencodePrompt({
			type: "question.replied",
			properties: { sessionID: "ses_1", requestID: "que_1" },
		});
		expect(readStoredOpencodePrompts("ses_1").questions).toEqual([]);
		rememberOpencodePrompt({ type: "question.asked", properties: asked });
		expect(
			seedOpencodePrompts(emptyOpencodeView(), "ses_1").questions.map(
				(item) => item.id,
			),
		).toEqual(["que_1"]);
		rememberOpencodePrompt({
			type: "question.replied",
			properties: { sessionID: "ses_1", requestID: "que_1" },
		});
		globalThis.sessionStorage = previousSession;
		globalThis.localStorage = previousLocal;
		expect(epoch.epoch).toBe(2);
		expect(
			restoreOpencodePrompts(
				current.questions,
				opencodeQuestions([asked]),
				"ses_1",
				true,
				epoch.dropped,
			).map((item) => item.id),
		).toEqual(["que_live"]);
		expect(
			restoreOpencodePrompts(current.questions, [], "ses_1", true).map(
				(item) => item.id,
			),
		).toEqual(["que_live"]);
		expect(
			restoreOpencodeViewPrompts(current, "ses_1", {
				questions: [],
				permissions: [],
				stale: false,
				dropped: new Set(),
			}).questions,
		).toEqual([]);
	});

	test("reads a pending question from loaded messages", () => {
		const pending = pendingOpencodeFromMessages(
			[
				{
					info: { id: "msg_1", role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "question",
							callID: "call_1",
							state: {
								status: "running",
								input: {
									questions: [
										{
											header: "LED",
											question: "Which pin?",
											options: [{ label: "7" }],
										},
									],
								},
							},
						},
					],
				},
			],
			"ses_1",
			{
				questions: [
					{
						id: "que_1",
						sessionID: "ses_1",
						callID: "call_1",
						prompts: [
							{ header: "LED", question: "Which pin?", options: ["7"] },
						],
					},
				],
				permissions: [
					{
						id: "per_1",
						sessionID: "ses_1",
						callID: "call_1",
						title: "bash",
						detail: "git push",
					},
				],
			},
		);
		expect(pending.questions[0]?.id).toBe("que_1");
		expect(pending.questions[0]?.prompts[0]?.question).toBe("Which pin?");
		expect(pending.permissions.map((item) => item.id)).toEqual(["per_1"]);
		expect(
			pendingOpencodeFromMessages(
				[
					{
						info: { id: "msg_1", role: "assistant" },
						parts: [
							{
								type: "tool",
								tool: "question",
								callID: "call_1",
								state: { status: "completed", input: {} },
							},
						],
					},
				],
				"ses_1",
			).questions,
		).toEqual([]);
	});

	test("keeps a failed reply and restores a prompt the server still has", () => {
		expect(opencodeReplyAccepted(null)).toBe(false);
		expect(opencodeReplyAccepted({ error: "device 502" })).toBe(false);
		expect(opencodeReplyAccepted({ ok: false })).toBe(false);
		expect(opencodeReplyAccepted({ accepted: true })).toBe(true);
		const dropped = {
			type: "permission.replied",
			properties: { sessionID: "ses_1", requestID: "per_1" },
		};
		expect(opencodePromptDropID(dropped)).toBe("per_1");
		const held = new Set(["per_1"]);
		expect(holdOpencodePromptEvent(dropped, held)).toBe(true);
		expect(
			holdOpencodePromptEvent(
				{ type: "question.asked", properties: { id: "que_1" } },
				held,
			),
		).toBe(false);
		const cleared = {
			...applyOpencodeEvent(
				{
					...emptyOpencodeView(),
					sessionID: "ses_1",
					permissions: [
						{
							id: "per_1",
							sessionID: "ses_1",
							title: "bash",
							detail: "",
						},
					],
					questions: [
						{
							id: "que_1",
							sessionID: "ses_1",
							prompts: [{ header: "", question: "Pick one", options: ["A"] }],
						},
					],
				},
				{
					type: "question.rejected",
					properties: { sessionID: "ses_1", requestID: "que_1" },
				},
			),
			permissions: [],
		};
		expect(cleared.questions).toEqual([]);
		const recovered = recoverOpencodePrompts(cleared, "ses_1", {
			questions: [
				{
					id: "que_1",
					sessionID: "ses_1",
					questions: [{ question: "Pick one", options: ["A"] }],
				},
			],
			permissions: [
				{
					id: "per_1",
					sessionID: "ses_1",
					permission: "bash",
					patterns: ["git push"],
				},
			],
		});
		expect(recovered.questions.map((item) => item.id)).toEqual(["que_1"]);
		expect(recovered.permissions.map((item) => item.id)).toEqual(["per_1"]);
		expect(recovered.permissions[0]?.title).toBe("bash");
		releaseSettledPromptHolds(held, recovered, "ses_1");
		expect([...held]).toEqual(["per_1"]);
		releaseSettledPromptHolds(held, cleared, "ses_1");
		expect([...held]).toEqual([]);
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
