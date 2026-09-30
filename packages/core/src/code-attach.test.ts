import { describe, expect, test } from "bun:test";
import {
	applyCodeMention,
	codeAttachPath,
	codeAttachPrompt,
	codeComposerErrorKey,
	codeMentionAt,
	codeSttLanguage,
	codeSttMicros,
	filterCodeMentions,
	renameContextDrafts,
	stageBoardContext,
	stageCodeAttach,
	explorerCreateDir,
	stageExplorerFile,
} from "./code-attach.ts";

describe("code attach", () => {
	test("stages text under uploads and avoids collisions", () => {
		const first = stageCodeAttach({
			filename: "../notes.md",
			bytes: new TextEncoder().encode("# hi\n"),
			taken: [],
			id: "a",
		});
		expect(first).toEqual({
			id: "a",
			name: "notes.md",
			path: "uploads/notes.md",
			kind: "text",
			use: "project",
			text: "# hi\n",
		});
		expect(codeAttachPath("notes.md", [first.path])).toBe("uploads/notes-2.md");
		expect(codeAttachPrompt("blink it", [first.path])).toBe(
			"blink it\n\nAttached files on this board:\n- uploads/notes.md",
		);
		expect(
			codeAttachPrompt("", [{ ...first, use: "context" }]).startsWith(
				"Context only, not saved on the board — notes.md:",
			),
		).toBe(true);
		expect(() =>
			codeAttachPrompt("", [
				{
					...first,
					use: "context",
					kind: "binary",
					text: undefined,
					base64: "aGVsbG8=",
				},
			]),
		).toThrow("context file must be text");
	});

	test("creates in the selected directory", () => {
		expect(explorerCreateDir(null)).toBe("");
		expect(explorerCreateDir({ path: "firmware", type: "dir" })).toBe(
			"firmware",
		);
		expect(explorerCreateDir({ path: "firmware/main.c", type: "file" })).toBe(
			"firmware",
		);
	});

	test("drops a file into the chosen folder", () => {
		const dropped = stageExplorerFile({
			dir: "firmware/blink",
			filename: "main.c",
			bytes: new TextEncoder().encode("int x;\n"),
			taken: ["firmware/blink/main.c"],
			id: "d",
		});
		expect(dropped.path).toBe("firmware/blink/main-2.c");
		expect(dropped.text).toBe("int x;\n");
	});

	test("refuses executables and oversized text", () => {
		expect(() =>
			stageCodeAttach({
				filename: "tool.exe",
				bytes: new Uint8Array([1]),
				taken: [],
			}),
		).toThrow("file type is not allowed");
		expect(() =>
			stageCodeAttach({
				filename: "big.txt",
				bytes: new Uint8Array(1024 * 1024 + 1),
				taken: [],
			}),
		).toThrow("file is too large");
	});

	test("mentions a project file and inlines its text", () => {
		const mention = codeMentionAt("fix @src/bl", 11);
		expect(mention).toEqual({ start: 4, end: 11, query: "src/bl" });
		expect(codeMentionAt("a@b", 3)).toBeNull();
		expect(
			filterCodeMentions(["src/blink.c", "readme.md", "src/net.h"], "bl"),
		).toEqual(["src/blink.c"]);
		const staged = stageBoardContext({
			path: "src/blink.c",
			text: "int x;\n",
			id: "c",
		});
		expect(staged.source).toBe("board");
		expect(codeAttachPrompt("fix", [staged])).toBe(
			"fix\n\nProject file src/blink.c:\n```\nint x;\n\n```",
		);
		expect(mention).not.toBeNull();
		expect(
			applyCodeMention(
				"fix @src/bl",
				mention ?? { start: 0, end: 0, query: "" },
			),
		).toBe("fix ");
		expect(
			renameContextDrafts([staged], "src/blink.c", "src/led.c")[0]?.path,
		).toBe("src/led.c");
		expect(() =>
			stageBoardContext({ path: "photo.png", text: "nope" }),
		).toThrow("context file must be text");
	});

	test("maps composer errors and bills speech by the second", () => {
		expect(codeComposerErrorKey("name, path, and text are required")).toBe(
			"updateCompanion",
		);
		expect(codeComposerErrorKey("credits empty")).toBe("creditsEmpty");
		expect(codeSttLanguage("fr-CA")).toBe("fr");
		expect(codeSttLanguage("en")).toBe("en");
		expect(codeSttMicros(60, 1)).toBe(500);
		expect(codeSttMicros(60, 1.25)).toBe(625);
		expect(codeSttMicros(0)).toBe(0);
	});
});
