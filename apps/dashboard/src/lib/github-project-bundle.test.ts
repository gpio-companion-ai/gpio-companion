import { afterEach, describe, expect, test } from "bun:test";
import {
	loadProjectBundle,
	parseProjectRef,
	pickProjectRef,
	readRepoFile,
	readRepoModelFile,
} from "./github.ts";

const account = { username: "ada", token: "ghs_install" };

describe("parseProjectRef", () => {
	test("treats empty as omitted", () => {
		expect(parseProjectRef(undefined)).toBeUndefined();
		expect(parseProjectRef(null)).toBeUndefined();
		expect(parseProjectRef("")).toBeUndefined();
		expect(parseProjectRef("  ")).toBeUndefined();
	});

	test("accepts branch names with slashes", () => {
		expect(parseProjectRef("feat/blink")).toBe("feat/blink");
	});

	test("rejects junk", () => {
		expect(() => parseProjectRef(1)).toThrow("ref must be a string");
		expect(() => parseProjectRef("feat/../main")).toThrow("ref is invalid");
		expect(() => parseProjectRef("feat blink")).toThrow("ref is invalid");
	});
});

describe("pickProjectRef", () => {
	const branches = [
		{ name: "feat/blink", sha: "aaa", committedAt: "2026-09-16T12:00:00Z" },
		{ name: "main", sha: "bbb", committedAt: "2026-09-01T12:00:00Z" },
	];

	test("keeps a requested branch that exists", () => {
		expect(pickProjectRef(branches, "main", "main")).toBe("main");
	});

	test("defaults to the newest HEAD", () => {
		expect(pickProjectRef(branches, "main")).toBe("feat/blink");
		expect(pickProjectRef(branches, "main", "missing")).toBe("feat/blink");
	});

	test("falls back to defaultBranch", () => {
		expect(pickProjectRef([], "main")).toBe("main");
		expect(pickProjectRef([], "")).toBe("main");
	});
});

describe("loadProjectBundle", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function json(body: unknown, status = 200) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}

	function graphqlBody(init?: RequestInit) {
		if (typeof init?.body !== "string") {
			return {};
		}
		try {
			return JSON.parse(init.body) as { query?: string; variables?: unknown };
		} catch {
			return {};
		}
	}

	test("loads contents from the newest-commit branch", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = String(input);
			const path = url.replace("https://api.github.com", "");
			paths.push(`${init?.method ?? "GET"} ${path}`);
			if (path === "/graphql") {
				expect(init?.cache).toBe("no-store");
				expect(graphqlBody(init).variables).toEqual({
					owner: "ada",
					name: "blink",
				});
				return json({
					data: {
						repository: {
							defaultBranchRef: { name: "main" },
							refs: {
								nodes: [
									{
										name: "feat/blink",
										target: {
											oid: "aaa",
											committedDate: "2026-09-16T12:00:00Z",
										},
									},
									{
										name: "main",
										target: {
											oid: "bbb",
											committedDate: "2026-09-01T12:00:00Z",
										},
									},
								],
							},
						},
					},
				});
			}
			if (path === "/repos/ada/blink/contents/breadboard?ref=feat%2Fblink") {
				return json([
					{
						name: "diagram.json",
						path: "breadboard/diagram.json",
						type: "file",
						download_url:
							"https://raw.githubusercontent.com/ada/blink/aaa/breadboard/diagram.json",
					},
				]);
			}
			if (path.startsWith("/repos/ada/blink/contents/")) {
				return json({ message: "Not Found" }, 404);
			}
			return json({ message: `unexpected ${path}` }, 500);
		}) as typeof fetch;
		const bundle = await loadProjectBundle(account, "ada", "blink");
		expect(bundle.ref).toBe("feat/blink");
		expect(bundle.defaultBranch).toBe("main");
		expect(bundle.branches.map((branch) => branch.name)).toEqual([
			"feat/blink",
			"main",
		]);
		expect(bundle.breadboardDiagramUrl).toContain(
			"/aaa/breadboard/diagram.json",
		);
		expect(bundle.model).toEqual([]);
		expect(bundle.modelManifestUrl).toBeNull();
		expect(paths).toContain("POST /graphql");
		expect(paths).toContain(
			"GET /repos/ada/blink/contents/breadboard?ref=feat%2Fblink",
		);
		expect(
			paths.some((item) => item === "GET /repos/ada/blink/contents/breadboard"),
		).toBe(false);
	});

	test("loads a requested branch even when it is not newest", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const path = String(input).replace("https://api.github.com", "");
			paths.push(`${init?.method ?? "GET"} ${path}`);
			if (path === "/graphql") {
				return json({
					data: {
						repository: {
							defaultBranchRef: { name: "main" },
							refs: {
								nodes: [
									{
										name: "feat/blink",
										target: {
											oid: "aaa",
											committedDate: "2026-09-16T12:00:00Z",
										},
									},
									{
										name: "main",
										target: {
											oid: "bbb",
											committedDate: "2026-09-01T12:00:00Z",
										},
									},
								],
							},
						},
					},
				});
			}
			if (path === "/repos/ada/blink/contents/breadboard?ref=main") {
				return json([
					{
						name: "diagram.json",
						path: "breadboard/diagram.json",
						type: "file",
						download_url:
							"https://raw.githubusercontent.com/ada/blink/bbb/breadboard/diagram.json",
					},
				]);
			}
			if (path.startsWith("/repos/ada/blink/contents/")) {
				return json({ message: "Not Found" }, 404);
			}
			return json({ message: `unexpected ${path}` }, 500);
		}) as typeof fetch;
		const bundle = await loadProjectBundle(account, "ada", "blink", "main");
		expect(bundle.ref).toBe("main");
		expect(paths).toContain(
			"GET /repos/ada/blink/contents/breadboard?ref=main",
		);
	});

	test("falls back to REST branches when GraphQL fails", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const path = String(input).replace("https://api.github.com", "");
			paths.push(`${init?.method ?? "GET"} ${path}`);
			if (path === "/graphql") {
				return json({ errors: [{ message: "GraphQL disabled" }] });
			}
			if (path === "/repos/ada/blink") {
				return json({ default_branch: "main" });
			}
			if (path === "/repos/ada/blink/branches?per_page=100") {
				return json([
					{ name: "main", commit: { sha: "bbb" } },
					{ name: "feat/blink", commit: { sha: "aaa" } },
				]);
			}
			if (path === "/repos/ada/blink/commits?sha=main&per_page=1") {
				return json([
					{
						sha: "bbb",
						commit: { committer: { date: "2026-09-01T12:00:00Z" } },
					},
				]);
			}
			if (path === "/repos/ada/blink/commits?sha=feat%2Fblink&per_page=1") {
				return json([
					{
						sha: "aaa",
						commit: { committer: { date: "2026-09-16T12:00:00Z" } },
					},
				]);
			}
			if (path === "/repos/ada/blink/contents/breadboard?ref=feat%2Fblink") {
				return json([
					{
						name: "diagram.json",
						path: "breadboard/diagram.json",
						type: "file",
						download_url:
							"https://raw.githubusercontent.com/ada/blink/aaa/breadboard/diagram.json",
					},
				]);
			}
			if (path.startsWith("/repos/ada/blink/contents/")) {
				return json({ message: "Not Found" }, 404);
			}
			return json({ message: `unexpected ${path}` }, 500);
		}) as typeof fetch;
		const bundle = await loadProjectBundle(account, "ada", "blink");
		expect(bundle.ref).toBe("feat/blink");
		expect(paths).toContain("GET /repos/ada/blink/branches?per_page=100");
		expect(paths).toContain(
			"GET /repos/ada/blink/contents/breadboard?ref=feat%2Fblink",
		);
	});
});

describe("readRepoFile", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("reads contents at ref", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const path = String(input).replace("https://api.github.com", "");
			paths.push(`${init?.method ?? "GET"} ${path}`);
			if (
				path ===
				"/repos/ada/blink/contents/breadboard/diagram.json?ref=feat%2Fblink"
			) {
				return new Response(
					JSON.stringify({
						encoding: "base64",
						content: btoa('{"version":1}'),
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			return new Response(JSON.stringify({ message: `unexpected ${path}` }), {
				status: 500,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const text = await readRepoFile(
			account,
			"ada",
			"blink",
			"breadboard/diagram.json",
			"feat/blink",
		);
		expect(text).toBe('{"version":1}');
		expect(paths).toEqual([
			"GET /repos/ada/blink/contents/breadboard/diagram.json?ref=feat%2Fblink",
		]);
	});
});

describe("readRepoModelFile", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("rejects paths outside model/*.glb", async () => {
		globalThis.fetch = (() => {
			throw new Error("fetch should not run");
		}) as unknown as typeof fetch;
		await expect(
			readRepoModelFile(account, "ada", "blink", "pcb/circuit.json"),
		).rejects.toThrow("path is not a model file");
		await expect(
			readRepoModelFile(account, "ada", "blink", "model/../x.glb"),
		).rejects.toThrow("path is not a model file");
	});

	test("returns base64 for a model glb", async () => {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const path = String(input).replace("https://api.github.com", "");
			if (path === "/repos/ada/blink/contents/model/header-clip.glb?ref=main") {
				return new Response(
					JSON.stringify({
						encoding: "base64",
						content: btoa("glb"),
						size: 3,
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			return new Response(JSON.stringify({ message: `unexpected ${path}` }), {
				status: 500,
			});
		}) as typeof fetch;
		const file = await readRepoModelFile(
			account,
			"ada",
			"blink",
			"model/header-clip.glb",
			"main",
		);
		expect(atob(file.base64)).toBe("glb");
	});
});
