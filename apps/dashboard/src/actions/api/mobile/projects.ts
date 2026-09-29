"no action";

import {
	createGpioCompanionRepo,
	githubAccountForUser,
	githubConfigured,
	indexProject,
	listRepos,
	loadIndexedProjects,
	loadProjectBundle,
	parseProjectRef,
	readRepoFile,
	readRepoModelFile,
} from "../../../lib/github.ts";
import type { GithubAppEnv } from "../../../lib/github-app.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";
import {
	deleteProjectForUser,
	pushProjectToLiveBoards,
} from "../../../lib/projects-push.ts";

function env(ctx: MobileContext): GithubAppEnv & {
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
} {
	return ctx.env as GithubAppEnv & {
		GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
		GPIO_COMPANION_DEVICE_KEY_ID?: string;
	};
}

export async function onRequestGet(ctx: MobileContext) {
	const response = await runMobile(ctx, async (identity) => {
		const account = await githubAccountForUser(env(ctx), identity.id);
		if (!githubConfigured(account)) {
			return { configured: false, repos: [] };
		}
		return {
			configured: true,
			repos: await listRepos(
				account,
				await loadIndexedProjects(env(ctx).DYNAMIC_PAGE_KV, identity.id),
			),
		};
	});
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "private, no-store");
	return new Response(response.body, { status: response.status, headers });
}

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const owner = asString(body.owner).trim();
		const repo = asString(body.repo).trim();
		if (!owner || !repo) {
			throw new Error("owner and repo are required");
		}
		const account = await githubAccountForUser(env(ctx), identity.id);
		if (!githubConfigured(account)) {
			throw new Error("github is not configured");
		}
		return loadProjectBundle(account, owner, repo, parseProjectRef(body.ref));
	});
}

export async function onRequestPut(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const owner = asString(body.owner).trim();
		const repo = asString(body.repo).trim();
		const path = asString(body.path).trim();
		if (!owner || !repo || !path) {
			throw new Error("owner, repo, and path are required");
		}
		const account = await githubAccountForUser(env(ctx), identity.id);
		if (!githubConfigured(account)) {
			throw new Error("github is not configured");
		}
		const selected = parseProjectRef(body.ref);
		if (path.endsWith(".glb")) {
			return {
				text: "",
				base64: (await readRepoModelFile(account, owner, repo, path, selected))
					.base64,
			};
		}
		return {
			text: await readRepoFile(account, owner, repo, path, selected),
		};
	});
}

export async function onRequestPatch(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const name = asString(body.name).trim();
		if (!name) {
			throw new Error("name is required");
		}
		const account = await githubAccountForUser(env(ctx), identity.id);
		if (!githubConfigured(account)) {
			throw new Error("github is not configured");
		}
		const repo = await createGpioCompanionRepo(account, name);
		await indexProject(env(ctx).DYNAMIC_PAGE_KV, identity.id, repo);
		await pushProjectToLiveBoards(env(ctx), identity.id, repo);
		return repo;
	});
}

export async function onRequestDelete(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const url = new URL(ctx.request.url);
		const body = await readJsonBody(ctx.request);
		const owner =
			asString(body.owner).trim() || asString(url.searchParams.get("owner"));
		const name =
			asString(body.name).trim() ||
			asString(body.repo).trim() ||
			asString(url.searchParams.get("name")) ||
			asString(url.searchParams.get("repo"));
		if (!owner || !name) {
			throw new Error("owner and name are required");
		}
		return deleteProjectForUser(env(ctx), identity.id, owner, name);
	});
}
