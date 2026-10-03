import { describe, expect, test } from "bun:test";
import {
	assertBoardTextWrite,
	boardFileApplyEvent,
	boardFileKindFromName,
	boardFileLanguage,
	boardFileRelative,
	boardFileTree,
	boardFileWatchPath,
	boardImageDataUrl,
	boardImageMime,
	isImagePath,
	isMarkdownPath,
	isSvgPath,
	parseBoardFileEvent,
	parseBoardFileRemovePut,
	parseBoardFileRenamePut,
	parseBoardFileWatchPath,
	parseBoardFileWritePut,
	svgDataUrl,
} from "./board-files.ts";

describe("board file paths", () => {
	test("rejects traversal", () => {
		expect(() => boardFileRelative("../secret")).toThrow("invalid path");
		expect(boardFileRelative("/etc/passwd")).toBe("etc/passwd");
		expect(() => boardFileRelative("host/../../x")).toThrow("invalid path");
		expect(boardFileRelative("host/blink/main.c")).toBe("host/blink/main.c");
	});

	test("watch path round-trips", () => {
		const path = boardFileWatchPath("blink-led");
		expect(path).toBe("/v1/files/watch/blink-led");
		expect(parseBoardFileWatchPath(path)).toBe("blink-led");
		expect(parseBoardFileWatchPath("/v1/files/list")).toBeNull();
		expect(parseBoardFileWatchPath("/v1/files/watch/../x")).toBeNull();
	});
});

describe("board file kinds", () => {
	test("classifies text, models, and binaries", () => {
		expect(boardFileKindFromName("src/main.c")).toBe("text");
		expect(boardFileKindFromName("notes.md")).toBe("text");
		expect(boardFileKindFromName("app.tsx")).toBe("text");
		expect(boardFileKindFromName("model/clip.glb")).toBe("model");
		expect(boardFileKindFromName("model/clip.stl")).toBe("binary");
		expect(boardFileLanguage("src/main.c")).toBe("c");
		expect(boardFileLanguage("app.tsx")).toBe("typescript");
		expect(boardFileLanguage("readme.md")).toBe("markdown");
	});

	test("detects markdown paths", () => {
		expect(isMarkdownPath("README.md")).toBe(true);
		expect(isMarkdownPath("docs/notes.markdown")).toBe(true);
		expect(isMarkdownPath("src/main.c")).toBe(false);
		expect(isMarkdownPath("docs")).toBe(false);
		expect(isMarkdownPath(".md")).toBe(false);
	});

	test("classifies images and svg separately", () => {
		expect(boardFileKindFromName("uploads/photo.PNG")).toBe("image");
		expect(boardFileKindFromName("assets/pic.jpeg")).toBe("image");
		expect(boardFileKindFromName("assets/pic.webp")).toBe("image");
		expect(boardFileKindFromName("diagram.svg")).toBe("text");
		expect(boardFileKindFromName("scan.pdf")).toBe("binary");
		expect(isImagePath("uploads/photo.png")).toBe(true);
		expect(isImagePath("diagram.svg")).toBe(false);
		expect(isSvgPath("diagram.svg")).toBe(true);
		expect(isSvgPath("diagram.svgx")).toBe(false);
		expect(boardImageMime("a.png")).toBe("image/png");
		expect(boardImageMime("a.jpg")).toBe("image/jpeg");
		expect(boardImageDataUrl("QUJD", "a.gif")).toBe(
			"data:image/gif;base64,QUJD",
		);
		expect(svgDataUrl('<svg x="1"/>')).toBe(
			`data:image/svg+xml;utf8,${encodeURIComponent('<svg x="1"/>')}`,
		);
		expect(() => assertBoardTextWrite("a.png", "nope")).toThrow(
			"file is not text",
		);
	});

	test("refuses binary writes", () => {
		expect(() => assertBoardTextWrite("model/a.glb", "nope")).toThrow(
			"file is not text",
		);
		expect(() =>
			parseBoardFileWritePut({
				name: "blink",
				path: "host/../x.c",
				text: "int main(){}",
			}),
		).toThrow("invalid path");
	});

	test("renames inside the project", () => {
		expect(
			parseBoardFileRenamePut({
				name: "blink",
				from: "host/main.c",
				to: "host/led.c",
			}),
		).toEqual({ name: "blink", from: "host/main.c", to: "host/led.c" });
		expect(() =>
			parseBoardFileRenamePut({
				name: "blink",
				from: "host/../x.c",
				to: "host/y.c",
			}),
		).toThrow("invalid path");
	});

	test("removes inside the project", () => {
		expect(
			parseBoardFileRemovePut({ name: "blink", path: "host/main.c" }),
		).toEqual({ name: "blink", path: "host/main.c" });
		expect(() =>
			parseBoardFileRemovePut({ name: "blink", path: "host/../x.c" }),
		).toThrow("invalid path");
		expect(() => parseBoardFileRemovePut({ name: "blink" })).toThrow(
			"name and path are required",
		);
	});

	test("accepts an uploads image and refuses a binary elsewhere", () => {
		const put = parseBoardFileWritePut({
			name: "blink",
			path: "uploads/board.png",
			base64: "aGVsbG8=",
		});
		expect(put.base64).toBe("aGVsbG8=");
		expect(put.text).toBeUndefined();
		expect(
			parseBoardFileWritePut({
				name: "blink",
				path: "firmware/board.png",
				base64: "aGVsbG8=",
			}).path,
		).toBe("firmware/board.png");
		expect(() =>
			parseBoardFileWritePut({
				name: "blink",
				path: "firmware/tool.exe",
				base64: "aGVsbG8=",
			}),
		).toThrow("file type is not allowed");
		expect(() =>
			parseBoardFileWritePut({
				name: "blink",
				path: "uploads/note.txt",
				text: "hi",
			}),
		).not.toThrow();
	});
});

describe("board file tree and events", () => {
	test("builds a directory tree", () => {
		const tree = boardFileTree([
			{ path: "host/blink/main.c", type: "file", size: 12 },
			{ path: "readme.md", type: "file", size: 4 },
			{ path: "model", type: "dir", size: 0 },
		]);
		expect(tree.map((node) => node.name)).toEqual([
			"host",
			"model",
			"readme.md",
		]);
		expect(tree[0]?.children[0]?.children[0]?.path).toBe("host/blink/main.c");
	});

	test("does not clobber a dirty editor", () => {
		const event = parseBoardFileEvent({
			repo: "blink",
			path: "main.c",
			kind: "change",
		});
		if (!event) {
			throw new Error("event");
		}
		expect(
			boardFileApplyEvent({
				event,
				openPath: "main.c",
				dirty: true,
				echo: false,
			}).action,
		).toBe("stale");
		expect(
			boardFileApplyEvent({
				event,
				openPath: "main.c",
				dirty: false,
				echo: true,
			}).action,
		).toBe("echo");
		expect(
			boardFileApplyEvent({
				event,
				openPath: "main.c",
				dirty: false,
				echo: false,
			}).action,
		).toBe("reload");
	});
});
