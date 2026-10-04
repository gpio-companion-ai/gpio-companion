import { PROJECTS_REMOVE_PATH, PROJECTS_SYNC_PATH } from "gpio-companion";
import { getLiveBoard } from "./debug-live.ts";
import {
	type DeviceSigningEnv,
	type FetchLike,
	signedDeviceFetch,
} from "./device-api.ts";
import {
	deleteGpioCompanionRepo,
	type GithubAccount,
	githubAccountForUser,
	githubConfigured,
	unindexProject,
} from "./github.ts";
import type { GithubAppEnv } from "./github-app.ts";
import { loadDevices, type PairingKv } from "./pairing-store.ts";

export const PROJECT_PUSH_TIMEOUT_MS = 4_000;

export type ProjectPushEnv = DeviceSigningEnv & {
	DYNAMIC_PAGE_KV: PairingKv;
};

export type ProjectPushRepo = {
	owner: string;
	name: string;
};

async function postProjectToLiveBoards(
	env: ProjectPushEnv,
	userId: string,
	repo: ProjectPushRepo,
	path: string,
	options?: {
		now?: number;
		timeoutMs?: number;
		fetchImpl?: FetchLike;
	},
): Promise<void> {
	const devices = await loadDevices(env.DYNAMIC_PAGE_KV, userId);
	await Promise.all(
		devices.map(async (device) => {
			const live = await getLiveBoard(
				env.DYNAMIC_PAGE_KV,
				device.uuid,
				options?.now,
			);
			if (!live) {
				return;
			}
			const deviceUrl = device.deviceUrl || live.deviceUrl;
			if (!deviceUrl) {
				return;
			}
			try {
				await signedDeviceFetch(
					env,
					deviceUrl,
					"POST",
					path,
					{ owner: repo.owner, name: repo.name },
					{
						timeoutMs: options?.timeoutMs ?? PROJECT_PUSH_TIMEOUT_MS,
						fetchImpl: options?.fetchImpl,
					},
				);
			} catch {
				undefined;
			}
		}),
	);
}

export async function pushProjectToLiveBoards(
	env: ProjectPushEnv,
	userId: string,
	repo: ProjectPushRepo,
	options?: {
		now?: number;
		timeoutMs?: number;
		fetchImpl?: FetchLike;
	},
): Promise<void> {
	await postProjectToLiveBoards(env, userId, repo, PROJECTS_SYNC_PATH, options);
}

export async function removeProjectFromLiveBoards(
	env: ProjectPushEnv,
	userId: string,
	repo: ProjectPushRepo,
	options?: {
		now?: number;
		timeoutMs?: number;
		fetchImpl?: FetchLike;
	},
): Promise<void> {
	await postProjectToLiveBoards(
		env,
		userId,
		repo,
		PROJECTS_REMOVE_PATH,
		options,
	);
}

export type ProjectDeleteEnv = ProjectPushEnv & GithubAppEnv;

export async function deleteProjectForUser(
	env: ProjectDeleteEnv,
	userId: string,
	owner: string,
	name: string,
	account?: GithubAccount,
): Promise<{ deleted: true; owner: string; name: string }> {
	const github = account ?? (await githubAccountForUser(env, userId));
	if (!githubConfigured(github)) {
		throw new Error("github is not configured");
	}
	await deleteGpioCompanionRepo(github, owner, name);
	await unindexProject(env.DYNAMIC_PAGE_KV, userId, owner, name);
	await removeProjectFromLiveBoards(env, userId, { owner, name });
	return { deleted: true, owner, name };
}
