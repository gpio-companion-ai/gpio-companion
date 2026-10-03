import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listBoardFiles,
	readBoardFile,
	removeBoardFile,
	renameBoardFile,
	writeBoardFile,
	writeBoardFileBytes,
} from "./board-files.ts";

const roots: string[] = [];

afterEach(() => {
	roots.length = 0;
});

describe("board files", () => {
	test("lists, reads, and writes inside the project", async () => {
		const root = makeRoot();
		const project = join(root, "blink");
		mkdirSync(join(project, "host"), { recursive: true });
		writeFileSync(join(project, "host", "main.c"), "int x;\n");
		writeFileSync(join(project, "readme.md"), "# hi\n");
		const listed = await listBoardFiles(root, "blink");
		expect(listed.entries.map((entry) => entry.path)).toContain("host/main.c");
		expect(listed.entries.some((entry) => entry.path.includes(".git"))).toBe(
			false,
		);
		const read = await readBoardFile(root, "blink", "host/main.c");
		expect(read).toEqual({
			path: "host/main.c",
			kind: "text",
			text: "int x;\n",
		});
		const written = await writeBoardFile(
			root,
			"blink",
			"notes/todo.txt",
			"later\n",
		);
		expect(written.written).toBe(true);
		const again = await readBoardFile(root, "blink", "notes/todo.txt");
		expect(again.text).toBe("later\n");
	});

	test("reads uploaded images as base64 and svg as text", async () => {
		const root = makeRoot();
		mkdirSync(join(root, "blink", "uploads"), { recursive: true });
		writeFileSync(join(root, "blink", "uploads", "board.png"), "PNGDATA");
		writeFileSync(
			join(root, "blink", "diagram.svg"),
			'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
		);
		const image = await readBoardFile(root, "blink", "uploads/board.png");
		expect(image).toEqual({
			path: "uploads/board.png",
			kind: "image",
			base64: Buffer.from("PNGDATA").toString("base64"),
		});
		const svg = await readBoardFile(root, "blink", "diagram.svg");
		expect(svg.kind).toBe("text");
		expect(svg.text).toContain("<svg");
	});

	test("writes an uploaded image only under uploads", async () => {
		const root = makeRoot();
		mkdirSync(join(root, "blink"), { recursive: true });
		const written = await writeBoardFileBytes(
			root,
			"blink",
			"uploads/board.png",
			"aGVsbG8=",
		);
		expect(written.path).toBe("uploads/board.png");
		expect(
			(
				await writeBoardFileBytes(
					root,
					"blink",
					"firmware/board.png",
					"aGVsbG8=",
				)
			).path,
		).toBe("firmware/board.png");
		await expect(
			writeBoardFileBytes(root, "blink", "firmware/tool.exe", "aGVsbG8="),
		).rejects.toThrow("file type is not allowed");
	});

	test("renames a file inside the project", async () => {
		const root = makeRoot();
		mkdirSync(join(root, "blink", "host"), { recursive: true });
		writeFileSync(join(root, "blink", "host", "main.c"), "int x;\n");
		const renamed = await renameBoardFile(
			root,
			"blink",
			"host/main.c",
			"host/led.c",
		);
		expect(renamed.path).toBe("host/led.c");
		await expect(
			renameBoardFile(root, "blink", "host/missing.c", "host/x.c"),
		).rejects.toThrow("file is missing");
	});

	test("removes a file inside the project", async () => {
		const root = makeRoot();
		mkdirSync(join(root, "blink", "host"), { recursive: true });
		writeFileSync(join(root, "blink", "host", "main.c"), "int x;\n");
		mkdirSync(join(root, "blink", "notes"), { recursive: true });
		const removed = await removeBoardFile(root, "blink", "host/main.c");
		expect(removed).toEqual({ removed: true, path: "host/main.c" });
		expect(() => {
			void readBoardFile(root, "blink", "host/main.c");
		}).not.toThrow();
		await expect(readBoardFile(root, "blink", "host/main.c")).rejects.toThrow();
		await expect(
			removeBoardFile(root, "blink", "host/missing.c"),
		).rejects.toThrow("file is missing");
		await expect(removeBoardFile(root, "blink", "notes")).rejects.toThrow(
			"cannot remove a directory",
		);
	});

	test("refuses paths outside the project", async () => {
		const root = makeRoot();
		mkdirSync(join(root, "blink"), { recursive: true });
		writeFileSync(join(root, "secret.txt"), "nope");
		await expect(readBoardFile(root, "blink", "../secret.txt")).rejects.toThrow(
			"invalid path",
		);
		await expect(listBoardFiles(root, "missing")).rejects.toThrow(
			"project is not on this board",
		);
	});

	test("skips symlinks that leave the project", async () => {
		const root = makeRoot();
		const project = join(root, "blink");
		mkdirSync(project, { recursive: true });
		writeFileSync(join(root, "secret.txt"), "nope");
		symlinkSync(join(root, "secret.txt"), join(project, "leak.txt"));
		const listed = await listBoardFiles(root, "blink");
		expect(listed.entries.map((entry) => entry.path)).not.toContain("leak.txt");
		await expect(readBoardFile(root, "blink", "leak.txt")).rejects.toThrow(
			"invalid path",
		);
		await expect(removeBoardFile(root, "blink", "leak.txt")).rejects.toThrow(
			"invalid path",
		);
	});
});

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "gpio-files-"));
	roots.push(root);
	return root;
}
