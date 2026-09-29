import { describe, expect, test } from "bun:test";
import { PROJECT_PUSH_MESSAGE } from "gpio-companion";
import {
	projectsRoot,
	pushProject,
	removeProject,
	syncProjects,
} from "./projects.ts";

describe("projectsRoot", () => {
	test("uses GPIO_COMPANION_PROJECTS_DIR", () => {
		const previous = process.env.GPIO_COMPANION_PROJECTS_DIR;
		process.env.GPIO_COMPANION_PROJECTS_DIR = "/tmp/gpio-projects";
		expect(projectsRoot("companion")).toBe("/tmp/gpio-projects");
		if (previous === undefined) {
			delete process.env.GPIO_COMPANION_PROJECTS_DIR;
		} else {
			process.env.GPIO_COMPANION_PROJECTS_DIR = previous;
		}
	});

	test("defaults to ~/projects for the gpio user", () => {
		const previous = process.env.GPIO_COMPANION_PROJECTS_DIR;
		delete process.env.GPIO_COMPANION_PROJECTS_DIR;
		expect(projectsRoot("companion")).toBe("/home/companion/projects");
		if (previous === undefined) {
			delete process.env.GPIO_COMPANION_PROJECTS_DIR;
		} else {
			process.env.GPIO_COMPANION_PROJECTS_DIR = previous;
		}
	});
});

describe("syncProjects", () => {
	test("clones watermarked repos into ~/projects", async () => {
		const cloned: string[] = [];
		const existing = new Set<string>();
		const result = await syncProjects(
			{
				destRoot: "/home/companion/projects",
				token: async () => "ghs_token",
				exists: (path) => existing.has(path),
				mkdirp: () => undefined,
				gitClone: async (url, dest) => {
					cloned.push(`${url} ${dest}`);
					existing.add(dest);
				},
				fetchImpl: githubFetch({
					repos: [
						{ name: "blink", owner: { login: "ada" } },
						{ name: "notes", owner: { login: "ada" } },
					],
					watermarked: ["ada/blink"],
				}),
			},
			{},
		);
		expect(cloned).toEqual([
			"https://github.com/ada/blink.git /home/companion/projects/blink",
		]);
		expect(result).toEqual({
			cloned: ["blink"],
			skipped: [],
		});
	});

	test("skips clone when the directory exists", async () => {
		const cloned: string[] = [];
		const dest = "/home/companion/projects/blink";
		const result = await syncProjects({
			destRoot: "/home/companion/projects",
			token: async () => "ghs_token",
			exists: (path) => path === dest,
			mkdirp: () => undefined,
			gitClone: async (url, destPath) => {
				cloned.push(`${url} ${destPath}`);
			},
			fetchImpl: githubFetch({
				repos: [{ name: "blink", owner: { login: "ada" } }],
				watermarked: ["ada/blink"],
			}),
		});
		expect(cloned).toEqual([]);
		expect(result.skipped).toEqual(["blink"]);
		expect(result.cloned).toEqual([]);
	});

	test("clones a gpio-companion repo past the first 80 installation repos", async () => {
		const cloned: string[] = [];
		const filler = Array.from({ length: 90 }, (_, index) => ({
			name: `old-${index}`,
			owner: { login: "ada" as const },
		}));
		await syncProjects({
			destRoot: "/home/companion/projects",
			token: async () => "ghs_token",
			exists: () => false,
			mkdirp: () => undefined,
			gitClone: async (url, dest) => {
				cloned.push(`${url} ${dest}`);
			},
			fetchImpl: githubFetch({
				repos: [
					...filler,
					{
						name: "blink-test",
						owner: { login: "ada" },
						description: "gpio-companion project",
					},
				],
				watermarked: ["ada/blink-test"],
			}),
		});
		expect(cloned).toEqual([
			"https://github.com/ada/blink-test.git /home/companion/projects/blink-test",
		]);
	});

	test("clones a single pushed repo without listing github", async () => {
		const paths: string[] = [];
		const cloned: string[] = [];
		await syncProjects(
			{
				destRoot: "/home/companion/projects",
				token: async () => {
					throw new Error("token unused");
				},
				exists: () => false,
				mkdirp: () => undefined,
				gitClone: async (url, dest) => {
					cloned.push(`${url} ${dest}`);
				},
				fetchImpl: async (input) => {
					paths.push(String(input));
					return new Response("nope", { status: 500 });
				},
			},
			{ owner: "ada", name: "new-board" },
		);
		expect(paths).toEqual([]);
		expect(cloned).toEqual([
			"https://github.com/ada/new-board.git /home/companion/projects/new-board",
		]);
	});
});

describe("removeProject", () => {
	test("removes a matching clone", async () => {
		const removed: string[] = [];
		const result = await removeProject(
			{
				destRoot: "/home/companion/projects",
				exists: (path) => path === "/home/companion/projects/blink",
				rm: (path) => {
					removed.push(path);
				},
				git: async (args) => {
					if (args[0] === "remote") {
						return {
							stdout: "https://github.com/ada/blink.git\n",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "", code: 1 };
				},
			},
			{ owner: "ada", name: "blink" },
		);
		expect(removed).toEqual(["/home/companion/projects/blink"]);
		expect(result).toEqual({ removed: true });
	});

	test("does not rm when origin does not match", async () => {
		const removed: string[] = [];
		await expect(
			removeProject(
				{
					destRoot: "/home/companion/projects",
					exists: (path) => path === "/home/companion/projects/blink",
					rm: (path) => {
						removed.push(path);
					},
					git: async () => ({
						stdout: "https://github.com/ada/other.git\n",
						stderr: "",
						code: 0,
					}),
				},
				{ owner: "ada", name: "blink" },
			),
		).rejects.toThrow("project origin does not match GitHub");
		expect(removed).toEqual([]);
	});

	test("reports missing when the clone is already gone", async () => {
		const result = await removeProject(
			{
				destRoot: "/home/companion/projects",
				exists: () => false,
				rm: () => {
					throw new Error("should not rm");
				},
			},
			{ owner: "ada", name: "blink" },
		);
		expect(result).toEqual({ removed: false });
	});
});

describe("pushProject", () => {
	test("commits when dirty then pushes", async () => {
		const calls: string[] = [];
		const result = await pushProject(
			{
				destRoot: "/home/companion/projects",
				exists: (path) => path === "/home/companion/projects/blink",
				git: async (args) => {
					calls.push(args.join(" "));
					if (args[0] === "remote") {
						return {
							stdout: "https://github.com/ada/blink.git\n",
							stderr: "",
							code: 0,
						};
					}
					if (args[0] === "status") {
						return {
							stdout: "M breadboard/diagram.json\n",
							stderr: "",
							code: 0,
						};
					}
					if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
						return { stdout: "feat/blink\n", stderr: "", code: 0 };
					}
					if (args[0] === "rev-parse") {
						return { stdout: "abc123\n", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "", code: 0 };
				},
			},
			{ owner: "ada", name: "blink", message: PROJECT_PUSH_MESSAGE },
		);
		expect(calls[0]).toBe("remote get-url origin");
		expect(calls).toContain("add -A");
		expect(calls.some((item) => item.includes("commit -m"))).toBe(true);
		expect(calls).toContain("push -u origin HEAD");
		expect(result).toEqual({
			committed: true,
			pushed: true,
			sha: "abc123",
			branch: "feat/blink",
			message: PROJECT_PUSH_MESSAGE,
		});
	});

	test("pushes without commit when clean", async () => {
		const calls: string[] = [];
		const result = await pushProject(
			{
				destRoot: "/home/companion/projects",
				exists: (path) => path === "/home/companion/projects/blink",
				git: async (args) => {
					calls.push(args.join(" "));
					if (args[0] === "remote") {
						return {
							stdout: "git@github.com:ada/blink.git\n",
							stderr: "",
							code: 0,
						};
					}
					if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
						return { stdout: "main\n", stderr: "", code: 0 };
					}
					if (args[0] === "rev-parse") {
						return { stdout: "def456\n", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "", code: 0 };
				},
			},
			{ owner: "ada", name: "blink", message: PROJECT_PUSH_MESSAGE },
		);
		expect(calls.some((item) => item.includes("commit"))).toBe(false);
		expect(result.committed).toBe(false);
		expect(result.pushed).toBe(true);
		expect(result.sha).toBe("def456");
	});

	test("rejects a missing clone", async () => {
		await expect(
			pushProject(
				{
					destRoot: "/home/companion/projects",
					exists: () => false,
					git: async () => {
						throw new Error("unused");
					},
				},
				{ owner: "ada", name: "blink", message: PROJECT_PUSH_MESSAGE },
			),
		).rejects.toThrow("project is not on this board");
	});

	test("rejects a mismatched origin", async () => {
		await expect(
			pushProject(
				{
					destRoot: "/home/companion/projects",
					exists: () => true,
					git: async () => ({
						stdout: "https://github.com/ada/other.git\n",
						stderr: "",
						code: 0,
					}),
				},
				{ owner: "ada", name: "blink", message: PROJECT_PUSH_MESSAGE },
			),
		).rejects.toThrow("project origin does not match GitHub");
	});
});

function githubFetch(options: {
	repos: Array<{
		name: string;
		owner: { login: string };
		description?: string;
	}>;
	watermarked: string[];
}) {
	return async (input: string | URL | Request) => {
		const url = String(input);
		if (url.includes("/installation/repositories")) {
			return Response.json({ repositories: options.repos });
		}
		const match = /\/repos\/([^/]+)\/([^/]+)\/contents\//.exec(url);
		if (match) {
			const full = `${match[1]}/${match[2]}`;
			const ok = options.watermarked.includes(full);
			return new Response(ok ? "ok" : "missing", { status: ok ? 200 : 404 });
		}
		return new Response("nope", { status: 404 });
	};
}
