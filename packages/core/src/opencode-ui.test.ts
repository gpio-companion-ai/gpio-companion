import { describe, expect, test } from "bun:test";
import {
	type BoardFileNode,
	clampSplitPercent,
	countBoardFiles,
	filterBoardNodes,
} from "./board-files.ts";
import {
	activeOpencodeQuestion,
	applyOpencodeEvent,
	codeQuestionAnswer,
	codeQuestionChoice,
	codeQuestionSlideIndex,
	codeRepoLabel,
	codeScrollKey,
	emptyOpencodeView,
	filterCodeSessions,
	matchCodeRepo,
	matchOpencodeQuestionID,
	mergeOpencodeQuestions,
	parseStoredCodeRepo,
	pruneCodeAnswers,
} from "./opencode-session.ts";

describe("code project selection", () => {
	const repos = [
		{ owner: "ada", name: "blink" },
		{ owner: "bob", name: "blink" },
		{ owner: "ada", name: "sensor" },
	];
	test("parses owner/name and bare names", () => {
		expect(parseStoredCodeRepo("ada/blink")).toEqual({
			owner: "ada",
			name: "blink",
		});
		expect(parseStoredCodeRepo("blink")).toEqual({ owner: "", name: "blink" });
		expect(parseStoredCodeRepo("")).toEqual({ owner: "", name: "" });
	});
	test("prefers exact owner match over name fallback", () => {
		expect(matchCodeRepo(repos, "bob/blink")).toBe("blink");
		expect(
			repos.find(
				(r) =>
					r.name === matchCodeRepo(repos, "bob/blink") && r.owner === "bob",
			),
		).toBeTruthy();
		expect(matchCodeRepo(repos, "blink")).toBe("blink");
		expect(matchCodeRepo(repos, "")).toBe("blink");
		expect(matchCodeRepo([], "ada/blink")).toBe("");
	});
	test("labels repos with owner", () => {
		expect(codeRepoLabel({ owner: "ada", name: "blink" })).toBe("ada/blink");
	});
	test("filters sessions case-insensitively", () => {
		const sessions = [
			{ id: "1", title: "Blink LED", updated: 1 },
			{ id: "2", title: "Sensor read", updated: 2 },
		];
		expect(filterCodeSessions(sessions, "blink")).toHaveLength(1);
		expect(filterCodeSessions(sessions, "")).toHaveLength(2);
	});
	test("scroll key includes permissions and questions", () => {
		expect(
			codeScrollKey([{ text: "hi" }], [{ id: 1 }], [{ id: 2 }, { id: 3 }]),
		).toBe(1 + 2 + 1 + 2);
	});
	test("prunes stale answers", () => {
		expect(pruneCodeAnswers({ a: "1", old: "x" }, [{ question: "a" }])).toEqual(
			{ a: "1" },
		);
	});
	test("slides stop at the ends and custom text wins", () => {
		expect(codeQuestionSlideIndex(0, 3, -1)).toBe(0);
		expect(codeQuestionSlideIndex(0, 3, 1)).toBe(1);
		expect(codeQuestionSlideIndex(2, 3, 1)).toBe(2);
		expect(codeQuestionSlideIndex(0, 1, 1)).toBe(0);
		expect(codeQuestionSlideIndex(0, 0, 1)).toBe(0);
		expect(codeQuestionChoice(["7", "11"], 1)).toBe("11");
		expect(codeQuestionChoice(["7"], 4)).toBe("7");
		expect(codeQuestionChoice([], 0)).toBe("");
		expect(codeQuestionAnswer("7", "  ")).toBe("7");
		expect(codeQuestionAnswer("7", " 13 ")).toBe("13");
		expect(codeQuestionAnswer(undefined, "")).toBe("");
	});
	test("replies with the que id, not the tool call id", () => {
		const placeholder = {
			id: "call_abc",
			sessionID: "ses_1",
			callID: "call_abc",
			prompts: [{ header: "LED", question: "Which pin?", options: ["7"] }],
		};
		const real = {
			id: "que_1",
			sessionID: "ses_1",
			callID: "call_abc",
			prompts: [{ header: "LED", question: "Which pin?", options: ["7"] }],
		};
		expect(activeOpencodeQuestion([placeholder, real], "ses_1")?.id).toBe(
			"que_1",
		);
		expect(matchOpencodeQuestionID(placeholder, [real])).toBe("que_1");
		expect(
			mergeOpencodeQuestions([real], [placeholder], "ses_1").map(
				(item) => item.id,
			),
		).toEqual(["que_1"]);
		const asked = applyOpencodeEvent(
			{ ...emptyOpencodeView(), sessionID: "ses_1", questions: [placeholder] },
			{
				type: "question.asked",
				properties: {
					id: "que_1",
					sessionID: "ses_1",
					questions: [
						{
							header: "LED",
							question: "Which pin?",
							options: [{ label: "7" }],
						},
					],
					tool: { callID: "call_abc" },
				},
			},
		);
		expect(asked.questions.map((item) => item.id)).toEqual(["que_1"]);
	});
});

describe("board file ui", () => {
	test("clamps split percent", () => {
		expect(clampSplitPercent(10)).toBe(28);
		expect(clampSplitPercent(90)).toBe(75);
		expect(clampSplitPercent(55.4)).toBe(55);
		expect(clampSplitPercent(Number.NaN)).toBe(55);
	});
	test("counts files only", () => {
		expect(
			countBoardFiles([
				{ path: "a", type: "file", size: 1 },
				{ path: "d", type: "dir", size: 0 },
			]),
		).toBe(1);
	});
	test("filters tree preserving matching dirs", () => {
		const nodes: BoardFileNode[] = [
			{
				name: "firmware",
				path: "firmware",
				type: "dir",
				children: [
					{
						name: "blink.c",
						path: "firmware/blink.c",
						type: "file",
						children: [],
					},
					{ name: "net.h", path: "firmware/net.h", type: "file", children: [] },
				],
			},
			{ name: "README.md", path: "README.md", type: "file", children: [] },
		];
		const filtered = filterBoardNodes(nodes, "blink");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.children).toHaveLength(1);
		expect(filterBoardNodes(nodes, "")).toHaveLength(2);
	});
});
