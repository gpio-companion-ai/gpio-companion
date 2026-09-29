import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { wrapAction } from "../../lib/action.ts";
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
} from "../../lib/github.ts";
import type { GithubAppEnv } from "../../lib/github-app.ts";
import {
	deleteProjectForUser,
	pushProjectToLiveBoards,
} from "../../lib/projects-push.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = GithubAppEnv & {
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

async function accountForUser(env: PagesEnv, userId: string) {
	return githubAccountForUser(env, userId);
}

export const GET = wrapAction(async function GET() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const account = await accountForUser(ctx.env, identity.id);
	if (!githubConfigured(account)) {
		return {
			configured: false,
			repos: [] as Awaited<ReturnType<typeof listRepos>>,
		};
	}
	return {
		configured: true,
		repos: await listRepos(
			account,
			await loadIndexedProjects(ctx.env.DYNAMIC_PAGE_KV, identity.id),
		),
	};
});

export const POST = wrapAction(async function POST(
	owner: string,
	repo: string,
	ref?: string,
) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const account = await accountForUser(ctx.env, identity.id);
	if (!githubConfigured(account)) {
		throw new Error("github is not configured");
	}
	return loadProjectBundle(account, owner, repo, parseProjectRef(ref));
});

export const PUT = wrapAction(async function PUT(
	owner: string,
	repo: string,
	path: string,
	ref?: string,
) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const account = await accountForUser(ctx.env, identity.id);
	if (!githubConfigured(account)) {
		throw new Error("github is not configured");
	}
	const selected = parseProjectRef(ref);
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

export const PATCH = wrapAction(async function PATCH(name: string) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const account = await accountForUser(ctx.env, identity.id);
	if (!githubConfigured(account)) {
		throw new Error("github is not configured");
	}
	const repo = await createGpioCompanionRepo(account, name);
	await indexProject(ctx.env.DYNAMIC_PAGE_KV, identity.id, repo);
	await pushProjectToLiveBoards(ctx.env, identity.id, repo);
	return repo;
});

export const DELETE = wrapAction(async function DELETE(
	owner: string,
	name: string,
) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const account = await accountForUser(ctx.env, identity.id);
	if (!githubConfigured(account)) {
		throw new Error("github is not configured");
	}
	return deleteProjectForUser(ctx.env, identity.id, owner, name, account);
});
