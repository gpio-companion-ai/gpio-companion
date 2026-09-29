import { describe, expect, test } from "bun:test";
import { parseJlcpcbDraft } from "./jlcpcb-draft.ts";
import { partsQueryKind, partsSearchBody } from "./jlcpcb-parts.ts";

describe("parts query kind", () => {
	test("treats LCSC codes as codes and other text as a keyword", () => {
		expect(partsQueryKind("C2040")).toBe("codes");
		expect(partsQueryKind("c2040, C14663")).toBe("codes");
		expect(partsQueryKind("10k 0603")).toBe("keyword");
		expect(partsQueryKind("")).toBeNull();
		expect(partsSearchBody(false, "C2040")).toBeNull();
		expect(partsSearchBody(false, "10k 0603")).toEqual({ query: "10k 0603" });
	});
});

describe("jlcpcb draft", () => {
	test("keeps a version-1 bundle and drops unknown fields", () => {
		const draft = parseJlcpcbDraft({
			version: 1,
			repo: "ada/blink",
			parts: [{ componentCode: "c2040", qty: 2, name: "10k", secretKey: "no" }],
			pcb: { file: "pcb/board.zip", fileKey: "gerber-1" },
			prints: [{ name: "clip", file: "model/clip.stl" }],
			assembly: { lines: [{ componentCode: "C2040", qty: 2 }] },
			updatedAt: "2026-09-29T00:00:00.000Z",
		});
		expect(draft).toEqual({
			version: 1,
			repo: "ada/blink",
			parts: [{ componentCode: "C2040", qty: 2, name: "10k" }],
			pcb: { file: "pcb/board.zip", fileKey: "gerber-1" },
			prints: [{ name: "clip", file: "model/clip.stl" }],
			assembly: { lines: [{ componentCode: "C2040", qty: 2 }] },
			updatedAt: "2026-09-29T00:00:00.000Z",
		});
		expect(JSON.stringify(draft)).not.toContain("secretKey");
	});

	test("rejects a path escape and a missing version", () => {
		expect(parseJlcpcbDraft({ version: 2, repo: "ada/blink" })).toBeNull();
		expect(
			parseJlcpcbDraft({
				version: 1,
				repo: "../secret",
				parts: [],
				prints: [],
				assembly: { lines: [] },
			}),
		).toBeNull();
	});
});
