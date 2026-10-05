import { describe, expect, test } from "bun:test";
import { queryOpenViking } from "./ov.ts";

describe("queryOpenViking", () => {
	test("degrades when the VPC binding is missing", async () => {
		await expect(
			queryOpenViking(undefined, undefined, { op: "find", query: "dock" }),
		).resolves.toBe("project lookup is unavailable");
	});

	test("refuses a write-shaped uri before fetch", async () => {
		let called = false;
		await expect(
			queryOpenViking(
				{
					fetch: async () => {
						called = true;
						return new Response("no");
					},
				},
				"user-key",
				{ op: "read", uri: "viking://user/shpaw415/memories" },
			),
		).rejects.toThrow("project lookup is outside gpio-companion");
		expect(called).toBe(false);
	});

	test("reads only through the binding and strips secrets", async () => {
		const seen: { url: string; key: string }[] = [];
		const text = await queryOpenViking(
			{
				fetch: async (input, init) => {
					const headers = new Headers(init?.headers);
					seen.push({
						url: String(input),
						key: headers.get("X-API-Key") ?? "",
					});
					return new Response(
						JSON.stringify({ result: "token=supersecretvalue" }),
					);
				},
			},
			"user-key",
			{ op: "read", uri: "viking://resources/gpio-companion/PRODUCT.md" },
		);
		expect(seen[0]?.url).toBe(
			"http://127.0.0.1:1933/api/v1/content/read?uri=viking%3A%2F%2Fresources%2Fgpio-companion%2FPRODUCT.md",
		);
		expect(seen[0]?.key).toBe("user-key");
		expect(text).toContain("[redacted]");
		expect(text).not.toContain("supersecretvalue");
	});
});
