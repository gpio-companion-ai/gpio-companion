import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { partsFromSearch, partsSearchBody } from "./jlcpcb-parts.ts";

describe("parts search gate", () => {
	test("does not build a search body without credentials", () => {
		expect(partsSearchBody(false, "C2040")).toBeNull();
		expect(partsSearchBody(false, "")).toBeNull();
		expect(partsSearchBody(true, "  ")).toBeNull();
		expect(partsSearchBody(true, " C2040, C14663 ")).toEqual({
			query: "C2040, C14663",
		});
	});

	test("keeps only returned part fields", () => {
		expect(
			partsFromSearch({
				parts: [
					{
						componentCode: "C2040",
						name: "10k",
						package: "0603",
						stock: 12,
						price: 0.01,
						secretKey: "nope",
					},
					{ name: "missing code" },
				],
			}),
		).toEqual([
			{
				componentCode: "C2040",
				name: "10k",
				package: "0603",
				stock: 12,
				price: 0.01,
			},
		]);
	});

	test("parts panels do not call JLCPCB or import the client", async () => {
		const root = `${import.meta.dir}/../../..`;
		const glob = new Glob("**/*.{ts,tsx}");
		const hits: string[] = [];
		for await (const path of glob.scan({
			cwd: `${root}/apps`,
			onlyFiles: true,
		})) {
			if (
				!path.includes("PartsSearch") &&
				!path.includes("JlcpcbCredentials")
			) {
				continue;
			}
			const text = await Bun.file(`${root}/apps/${path}`).text();
			if (
				text.includes("@community-jlcpcb/client") ||
				text.includes("open.jlcpcb.com") ||
				text.includes("api.jlcpcb.com")
			) {
				hits.push(path);
			}
		}
		expect(hits).toEqual([]);
	});
});
