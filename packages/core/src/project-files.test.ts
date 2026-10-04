import { describe, expect, test } from "bun:test";
import { BREADBOARD_DIAGRAM_JSON } from "./breadboard.ts";
import {
	githubCloneUrl,
	githubOriginMatches,
	isProjectFileDir,
	normalizeProjectName,
	PCB_CIRCUIT_JSON,
	PROJECT_FILE_DIRS,
	PROJECT_PUSH_MESSAGE,
	PROJECT_REPO_DESCRIPTION,
	PROJECT_WATERMARK_BODY,
	PROJECT_WATERMARK_PATH,
	PROJECTS_PUSH_PATH,
	PROJECTS_REMOVE_PATH,
	PROJECTS_SYNC_PATH,
	parseGithubRepoName,
	parseProjectPushPut,
	parseProjectRemovePut,
	parseProjectSyncPut,
	pickProjectWatermarkCandidates,
} from "./project-files.ts";

describe("project files", () => {
	test("layout dirs", () => {
		expect(PROJECT_FILE_DIRS).toEqual(["pcb", "breadboard", "technical"]);
		expect(isProjectFileDir("pcb")).toBe(true);
		expect(isProjectFileDir("src")).toBe(false);
		expect(PCB_CIRCUIT_JSON).toBe("pcb/circuit.json");
		expect(BREADBOARD_DIAGRAM_JSON).toBe("breadboard/diagram.json");
		expect(PROJECT_WATERMARK_PATH).toBe(".gpio-companion");
		expect(PROJECT_WATERMARK_BODY.trim()).toBe("gpio-companion");
		expect(PROJECTS_SYNC_PATH).toBe("/v1/projects/sync");
		expect(PROJECTS_REMOVE_PATH).toBe("/v1/projects/remove");
		expect(PROJECTS_PUSH_PATH).toBe("/v1/projects/push");
	});

	test("parses github repo names", () => {
		expect(parseGithubRepoName("blink-led")).toBe("blink-led");
		expect(parseGithubRepoName(" Blink.git ")).toBe("Blink");
		expect(() => parseGithubRepoName("has space")).toThrow();
		expect(() => parseGithubRepoName("../etc")).toThrow();
		expect(githubCloneUrl("ada", "blink")).toBe(
			"https://github.com/ada/blink.git",
		);
		expect(
			githubOriginMatches("https://github.com/ada/blink.git", "ada", "blink"),
		).toBe(true);
		expect(
			githubOriginMatches("git@github.com:ada/blink.git", "ada", "blink"),
		).toBe(true);
		expect(
			githubOriginMatches("https://github.com/ada/other.git", "ada", "blink"),
		).toBe(false);
	});

	test("normalizes project names with spaces", () => {
		expect(normalizeProjectName("my project")).toBe("my-project");
		expect(normalizeProjectName("blink  led")).toBe("blink-led");
		expect(normalizeProjectName("  spaced name  ")).toBe("spaced-name");
		expect(normalizeProjectName("tab\tname")).toBe("tab-name");
		expect(normalizeProjectName("Blink LED.git")).toBe("Blink-LED");
		expect(normalizeProjectName("blink-led")).toBe("blink-led");
		expect(() => normalizeProjectName("   ")).toThrow();
		expect(() => normalizeProjectName(".")).toThrow();
		expect(() => normalizeProjectName("..")).toThrow();
		expect(() => normalizeProjectName("../etc passwd")).toThrow();
	});

	test("parses project sync bodies", () => {
		expect(parseProjectSyncPut(null)).toEqual({});
		expect(parseProjectSyncPut({})).toEqual({});
		expect(parseProjectSyncPut({ owner: "ada", name: "blink-led" })).toEqual({
			owner: "ada",
			name: "blink-led",
		});
		expect(() => parseProjectSyncPut({ owner: "ada" })).toThrow(
			"owner and name are required",
		);
		expect(() => parseProjectSyncPut([])).toThrow("body must be an object");
	});

	test("parses project remove bodies", () => {
		expect(parseProjectRemovePut({ owner: "ada", name: "blink-led" })).toEqual({
			owner: "ada",
			name: "blink-led",
		});
		expect(() => parseProjectRemovePut({})).toThrow(
			"owner and name are required",
		);
		expect(() => parseProjectRemovePut(null)).toThrow(
			"owner and name are required",
		);
	});

	test("parses project push bodies", () => {
		expect(parseProjectPushPut({ owner: "ada", name: "blink-led" })).toEqual({
			owner: "ada",
			name: "blink-led",
			message: PROJECT_PUSH_MESSAGE,
		});
		expect(
			parseProjectPushPut({
				owner: "ada",
				name: "blink-led",
				message: "  wire LED  ",
			}),
		).toEqual({
			owner: "ada",
			name: "blink-led",
			message: "wire LED",
		});
		expect(() => parseProjectPushPut({ owner: "ada" })).toThrow(
			"owner and name are required",
		);
		expect(() => parseProjectPushPut(null)).toThrow("body must be an object");
		expect(() =>
			parseProjectPushPut({
				owner: "ada",
				name: "blink",
				message: "x".repeat(201),
			}),
		).toThrow("message is too long");
	});

	test("prefers gpio-companion descriptions past the watermark cap", () => {
		const repos = [
			...Array.from({ length: 90 }, (_, index) => ({
				name: `repo-${index}`,
				full_name: `ada/repo-${index}`,
			})),
			{
				name: "blink-test",
				full_name: "ada/blink-test",
				description: PROJECT_REPO_DESCRIPTION,
			},
		];
		expect(
			pickProjectWatermarkCandidates(repos).map((item) => item.full_name),
		).toEqual(["ada/blink-test"]);
	});
});
