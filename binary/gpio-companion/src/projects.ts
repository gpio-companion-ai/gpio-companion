import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	GITHUB_API,
	githubCloneUrl,
	githubOriginMatches,
	PROJECT_PUSH_GIT_EMAIL,
	PROJECT_PUSH_GIT_NAME,
	PROJECT_WATERMARK_PATH,
	PROJECTS_DIR_NAME,
	type ProjectPushPut,
	type ProjectPushResult,
	type ProjectRemovePut,
	type ProjectSyncPut,
	pickProjectWatermarkCandidates,
} from "gpio-companion";

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type ApplyProjects = (target: ProjectSyncPut) => Promise<void>;

export type ApplyProjectPush = (
	put: ProjectPushPut,
) => Promise<ProjectPushResult>;

export type ApplyProjectRemove = (
	put: ProjectRemovePut,
) => Promise<ProjectRemoveResult>;

export type GitResult = {
	stdout: string;
	stderr: string;
	code: number;
};

export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

export type ProjectPushOptions = {
	destRoot: string;
	exists?: (path: string) => boolean;
	git?: GitRunner;
};

export type ProjectRemoveResult = {
	removed: boolean;
};

export type ProjectRemoveOptions = {
	destRoot: string;
	exists?: (path: string) => boolean;
	git?: GitRunner;
	rm?: (path: string) => void;
};

export type GithubProject = {
	owner: string;
	name: string;
	description?: string;
};

export type ProjectSyncResult = {
	cloned: string[];
	skipped: string[];
};

export type ProjectSyncOptions = {
	destRoot: string;
	token: () => Promise<string>;
	fetchImpl?: FetchLike;
	gitClone?: (url: string, dest: string) => Promise<void>;
	exists?: (path: string) => boolean;
	mkdirp?: (path: string) => void;
};

type RepoJson = {
	name?: string;
	full_name?: string;
	description?: string | null;
	owner?: { login?: string };
};

export function projectsRoot(user = process.env.GPIO_USER): string {
	if (process.env.GPIO_COMPANION_PROJECTS_DIR?.trim()) {
		return process.env.GPIO_COMPANION_PROJECTS_DIR.trim();
	}
	const home =
		user?.trim() && user.trim() !== "root" ? `/home/${user.trim()}` : homedir();
	return join(home, PROJECTS_DIR_NAME);
}

export async function syncProjects(
	options: ProjectSyncOptions,
	target: ProjectSyncPut = {},
): Promise<ProjectSyncResult> {
	const exists = options.exists ?? existsSync;
	const mkdirp =
		options.mkdirp ??
		((path: string) => {
			mkdirSync(path, { recursive: true });
		});
	const gitClone = options.gitClone ?? defaultGitClone;
	const fetcher: FetchLike = options.fetchImpl ?? fetch;
	mkdirp(options.destRoot);
	const projects =
		target.owner && target.name
			? [{ owner: target.owner, name: target.name }]
			: await listWatermarkedRepos(await options.token(), fetcher);
	const result: ProjectSyncResult = {
		cloned: [],
		skipped: [],
	};
	for (const project of projects) {
		const dest = join(options.destRoot, project.name);
		if (!exists(dest)) {
			try {
				await gitClone(githubCloneUrl(project.owner, project.name), dest);
				result.cloned.push(project.name);
			} catch (caught) {
				if (!exists(dest)) {
					throw caught;
				}
				result.skipped.push(project.name);
			}
		} else {
			result.skipped.push(project.name);
		}
	}
	return result;
}

export async function defaultGitClone(
	url: string,
	dest: string,
): Promise<void> {
	const proc = Bun.spawn(["git", "clone", "--depth", "1", url, dest], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	const [stderr, code] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(stderr.trim() || "git clone failed");
	}
}

export async function defaultGit(
	args: string[],
	cwd: string,
): Promise<GitResult> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

export async function pushProject(
	options: ProjectPushOptions,
	put: ProjectPushPut,
): Promise<ProjectPushResult> {
	const dest = join(options.destRoot, put.name);
	const exists = options.exists ?? existsSync;
	if (!exists(dest)) {
		throw new Error("project is not on this board");
	}
	const git = options.git ?? defaultGit;
	const origin = await gitOk(
		git,
		["remote", "get-url", "origin"],
		dest,
		"project origin is missing",
	);
	if (!githubOriginMatches(origin.stdout, put.owner, put.name)) {
		throw new Error("project origin does not match GitHub");
	}
	await gitOk(git, ["add", "-A"], dest, "git add failed");
	const status = await gitOk(
		git,
		["status", "--porcelain"],
		dest,
		"git status failed",
	);
	let committed = false;
	if (status.stdout.trim()) {
		await gitOk(
			git,
			[
				"-c",
				`user.name=${PROJECT_PUSH_GIT_NAME}`,
				"-c",
				`user.email=${PROJECT_PUSH_GIT_EMAIL}`,
				"commit",
				"-m",
				put.message,
			],
			dest,
			"git commit failed",
		);
		committed = true;
	}
	await gitOk(git, ["push"], dest, "git push failed");
	const rev = await gitOk(
		git,
		["rev-parse", "HEAD"],
		dest,
		"git rev-parse failed",
	);
	return {
		committed,
		pushed: true,
		sha: rev.stdout.trim(),
		message: put.message,
	};
}

export async function removeProject(
	options: ProjectRemoveOptions,
	put: ProjectRemovePut,
): Promise<ProjectRemoveResult> {
	const dest = join(options.destRoot, put.name);
	const exists = options.exists ?? existsSync;
	const git = options.git ?? defaultGit;
	if (exists(dest)) {
		const origin = await gitOk(
			git,
			["remote", "get-url", "origin"],
			dest,
			"project origin is missing",
		);
		if (!githubOriginMatches(origin.stdout, put.owner, put.name)) {
			throw new Error("project origin does not match GitHub");
		}
	}
	if (exists(dest)) {
		const rm =
			options.rm ??
			((path: string) => {
				rmSync(path, { recursive: true, force: true });
			});
		rm(dest);
		return { removed: true };
	}
	return { removed: false };
}

async function gitOk(
	git: GitRunner,
	args: string[],
	cwd: string,
	fallback: string,
): Promise<GitResult> {
	const result = await git(args, cwd);
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || fallback);
	}
	return result;
}

async function listWatermarkedRepos(
	token: string,
	fetcher: FetchLike,
): Promise<GithubProject[]> {
	const repos = await listInstallationRepos(token, fetcher);
	const candidates = pickProjectWatermarkCandidates(
		repos.map((repo) => ({
			...repo,
			full_name: `${repo.owner}/${repo.name}`,
		})),
	);
	const marked: GithubProject[] = [];
	await mapPool(candidates, 8, async (repo) => {
		if (await repoHasWatermark(token, repo, fetcher)) {
			marked.push(repo);
		}
	});
	return marked;
}

async function listInstallationRepos(
	token: string,
	fetcher: FetchLike,
): Promise<GithubProject[]> {
	const repos: GithubProject[] = [];
	let path: string | null = "/installation/repositories?per_page=100";
	while (path) {
		const response = await githubGet(token, path, fetcher);
		if (!response.ok) {
			throw new Error(`github repositories ${response.status}`);
		}
		const body = (await response.json()) as { repositories?: RepoJson[] };
		for (const item of body.repositories ?? []) {
			const mapped = mapRepo(item);
			if (mapped) {
				repos.push(mapped);
			}
		}
		path = nextPath(response.headers.get("link"));
	}
	return repos;
}

async function repoHasWatermark(
	token: string,
	repo: GithubProject,
	fetcher: FetchLike,
): Promise<boolean> {
	const response = await githubGet(
		token,
		`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${PROJECT_WATERMARK_PATH}`,
		fetcher,
	);
	return response.ok;
}

async function githubGet(
	token: string,
	path: string,
	fetcher: FetchLike,
): Promise<Response> {
	const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
	return fetcher(url, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"user-agent": "gpio-companion",
		},
	});
}

function mapRepo(item: RepoJson): GithubProject | null {
	const name = item.name?.trim() ?? "";
	const owner = item.owner?.login?.trim() ?? "";
	if (!name || !owner) {
		return null;
	}
	return {
		owner,
		name,
		...(item.description ? { description: item.description } : {}),
	};
}

function nextPath(link: string | null): string | null {
	if (!link) {
		return null;
	}
	const match = /<([^>]+)>;\s*rel="next"/.exec(link);
	if (!match?.[1]) {
		return null;
	}
	try {
		const url = new URL(match[1]);
		return `${url.pathname}${url.search}`;
	} catch {
		return null;
	}
}

async function mapPool<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next;
			next += 1;
			await fn(items[index] as T);
		}
	}
	const workers = Math.min(Math.max(limit, 1), items.length || 1);
	await Promise.all(Array.from({ length: workers }, () => worker()));
}
