import { describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelManifestError, validateModelDir } from "./validate-manifest.ts";

const sampleDir = join(import.meta.dir, "sample/model");

function withCopy(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "gpio-3d-"));
	cpSync(sampleDir, dir, { recursive: true });
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function rewrite(
	dir: string,
	edit: (manifest: Record<string, unknown>) => void,
): void {
	const path = join(dir, "manifest.json");
	const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
		string,
		unknown
	>;
	edit(manifest);
	writeFileSync(path, JSON.stringify(manifest));
}

describe("gpio-3d manifest", () => {
	test("sample validates", () => {
		const manifest = validateModelDir(sampleDir);
		expect(manifest.tool).toBe("trimesh");
		expect(manifest.units).toBe("mm");
		expect(manifest.parts.map((part) => part.file)).toEqual([
			"header-clip.glb",
			"arduino-header-clip.glb",
		]);
		expect(manifest.parts[0]?.fits).toEqual(["companion-header"]);
		expect(manifest.parts[1]?.fits).toEqual([
			"arduino-uno",
			"arduino-nano",
			"arduino-mega",
		]);
		expect(manifest.parts.every((part) => part.units === "mm")).toBe(true);
		const glb = readFileSync(join(sampleDir, "header-clip.glb"));
		expect(glb.subarray(0, 4).toString()).toBe("glTF");
		expect(glb.includes(Buffer.from("mikedh/trimesh"))).toBe(true);
	});

	test("rejects a part that names no board", () => {
		withCopy((dir) => {
			rewrite(dir, (manifest) => {
				const parts = manifest.parts as Array<Record<string, unknown>>;
				const part = parts[0];
				if (!part) {
					throw new Error("sample part missing");
				}
				part.fits = [];
			});
			expect(() => validateModelDir(dir)).toThrow(ModelManifestError);
		});
	});

	test("rejects inches and a homemade tool", () => {
		withCopy((dir) => {
			rewrite(dir, (manifest) => {
				manifest.units = "in";
			});
			expect(() => validateModelDir(dir)).toThrow("manifest units must be mm");
		});
		withCopy((dir) => {
			rewrite(dir, (manifest) => {
				manifest.tool = "custom-kernel";
			});
			expect(() => validateModelDir(dir)).toThrow(
				"manifest tool must be trimesh",
			);
		});
	});

	test("rejects a packed path and an extra mesh file", () => {
		withCopy((dir) => {
			rewrite(dir, (manifest) => {
				const parts = manifest.parts as Array<Record<string, unknown>>;
				const part = parts[0];
				if (!part) {
					throw new Error("sample part missing");
				}
				part.file = "../header-clip.glb";
			});
			expect(() => validateModelDir(dir)).toThrow("one kebab-case .glb");
		});
		withCopy((dir) => {
			cpSync(join(dir, "header-clip.glb"), join(dir, "extra.glb"));
			expect(() => validateModelDir(dir)).toThrow("unexpected file extra.glb");
		});
	});

	test("rejects a glb that is not one mesh", () => {
		withCopy((dir) => {
			writeFileSync(join(dir, "header-clip.glb"), "not-a-glb");
			expect(() => validateModelDir(dir)).toThrow(
				"header-clip.glb is not a glb",
			);
		});
	});
});
