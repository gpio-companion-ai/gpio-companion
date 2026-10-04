import { describe, expect, test } from "bun:test";
import {
	cachedGithubCredentials,
	forgetGithubCredentials,
	formatGitCredentialOutput,
	parseGitCredentialInput,
	rememberGithubCredentials,
	runGitCredentialHelper,
} from "./github-credentials.ts";
import { gitCredentialLine, gitconfigContents } from "./secrets.ts";

describe("git credential helper", () => {
	test("parses git credential input", () => {
		expect(
			parseGitCredentialInput("protocol=https\nhost=github.com\n\n"),
		).toEqual({ protocol: "https", host: "github.com" });
	});

	test("formats x-access-token output", () => {
		expect(
			formatGitCredentialOutput({
				token: "ghs_live",
				expiresAt: "2026-08-31T01:00:00.000Z",
				login: "ada",
				username: "x-access-token",
			}),
		).toBe("username=x-access-token\npassword=ghs_live\n");
	});

	test("uses cache until skew", () => {
		rememberGithubCredentials("u1", {
			token: "ghs_cached",
			expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			login: "ada",
			username: "x-access-token",
		});
		expect(cachedGithubCredentials("u1")?.token).toBe("ghs_cached");
		forgetGithubCredentials("u1");
		expect(cachedGithubCredentials("u1")).toBeNull();
	});

	test("ghs tokens use x-access-token in git credentials", () => {
		const line = gitCredentialLine({
			gpioAiKey: "",
			githubUsername: "ada",
			githubToken: "ghs_live",
			githubUrl: "https://github.com",
		});
		expect(line).toContain("x-access-token");
		expect(line).toContain("ghs_live");
		expect(gitconfigContents("/etc/gpio-companion/git-credentials")).toContain(
			"gpio-companion git-credential",
		);
	});

	test("erase clears cache", async () => {
		rememberGithubCredentials("u2", {
			token: "ghs_cached",
			expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			login: "ada",
			username: "x-access-token",
		});
		const out = await runGitCredentialHelper("erase", "host=github.com\n", {
			uuid: "u2",
			key: "k",
			fetchImpl: async () => new Response("no", { status: 500 }),
		});
		expect(out).toBe("");
		expect(cachedGithubCredentials("u2")).toBeNull();
	});
});
