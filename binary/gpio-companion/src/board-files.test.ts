import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listBoardFiles,
	readBoardFile,
	writeBoardFile,
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
	});
});

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "gpio-files-"));
	roots.push(root);
	return root;
}
