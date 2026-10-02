import {
	createGithubAppJwt,
	GITHUB_API,
	GITHUB_GIT_USER,
	timingSafeEqualString,
} from "gpio-companion";
import { loadDevices, type PairingKv, pairOwnerKey } from "./pairing-store.ts";

export type GithubAppEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GITHUB_APP_ID?: string;
	GITHUB_APP_PRIVATE_KEY?: string;
	GITHUB_APP_SLUG?: string;
	GITHUB_APP_CLIENT_ID?: string;
	GITHUB_APP_CLIENT_SECRET?: string;
	PUBLIC_AUTH_REDIRECT_URI?: string;
};

export type GithubAppInstall = {
	installationId: number;
	login: string;
	userToken?: string;
	userTokenExpiresAt?: string;
	refreshToken?: string;
};

export type GithubInstallationToken = {
	token: string;
	expiresAt: string;
	login: string;
	username: string;
};

export type GithubAppStatus = {
	connected: boolean;
	login: string;
	installUrl: string;
	canCreate: boolean;
};

export function githubAppKey(userId: string): string {
	return `github-app:${userId}`;
}

export function githubAppStateKey(state: string): string {
	return `github-app-state:${state}`;
}

export function parseGithubAppInstall(
	raw: string | null,
): GithubAppInstall | null {
	if (!raw) {
		return null;
	}
	const parsed = JSON.parse(raw) as Partial<GithubAppInstall>;
	const installationId = Number(parsed.installationId);
	const login = typeof parsed.login === "string" ? parsed.login.trim() : "";
	if (!Number.isFinite(installationId) || installationId <= 0 || !login) {
		return null;
	}
	const userToken =
		typeof parsed.userToken === "string" ? parsed.userToken.trim() : "";
	const refreshToken =
		typeof parsed.refreshToken === "string" ? parsed.refreshToken.trim() : "";
	const userTokenExpiresAt =
		typeof parsed.userTokenExpiresAt === "string"
			? parsed.userTokenExpiresAt.trim()
			: "";
	return {
		installationId,
		login,
		...(userToken ? { userToken } : {}),
		...(refreshToken ? { refreshToken } : {}),
		...(userTokenExpiresAt ? { userTokenExpiresAt } : {}),
	};
}

export async function loadGithubAppInstall(
	kv: PairingKv,
	userId: string,
): Promise<GithubAppInstall | null> {
	return parseGithubAppInstall(await kv.get(githubAppKey(userId)));
}

export async function saveGithubAppInstall(
	kv: PairingKv,
	userId: string,
	install: GithubAppInstall,
): Promise<void> {
	await kv.put(githubAppKey(userId), JSON.stringify(install));
}

export function githubAppCanCreate(install: GithubAppInstall): boolean {
	return Boolean(install.userToken || install.refreshToken);
}

export function githubAppInstallUrl(slug: string, state: string): string {
	return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export function githubAppOrigin(request: Request, env: GithubAppEnv): string {
	const redirect = env.PUBLIC_AUTH_REDIRECT_URI?.trim() ?? "";
	return redirect ? new URL(redirect).origin : new URL(request.url).origin;
}

export function githubAppCallbackUri(
	request: Request,
	env: GithubAppEnv,
): string {
	return `${githubAppOrigin(request, env)}/profile/github`;
}

export function githubAppCallbackCandidates(
	request: Request,
	env: GithubAppEnv,
	preferred?: string,
): string[] {
	const origin = githubAppOrigin(request, env);
	const allowed = new Set([
		`${origin}/profile/github`,
		`${origin}/devices/keys`,
	]);
	const preferredUri = preferred?.trim() ?? "";
	const list = [
		preferredUri && allowed.has(preferredUri) ? preferredUri : "",
		`${origin}/profile/github`,
		`${origin}/devices/keys`,
	].filter(Boolean);
	return [...new Set(list)];
}

export function githubAppOAuthConfigured(env: GithubAppEnv): boolean {
	return Boolean(
		env.GITHUB_APP_CLIENT_ID?.trim() && env.GITHUB_APP_CLIENT_SECRET?.trim(),
	);
}

export function githubAppOAuthUrl(
	clientId: string,
	redirectUri: string,
	state: string,
): string {
	const url = new URL("https://github.com/login/oauth/authorize");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("state", state);
	return url.toString();
}

export function githubAppConnectUrl(
	env: GithubAppEnv,
	slug: string,
	state: string,
	request: Request,
): string {
	const clientId = env.GITHUB_APP_CLIENT_ID?.trim() ?? "";
	if (clientId && githubAppOAuthConfigured(env)) {
		return githubAppOAuthUrl(
			clientId,
			githubAppCallbackUri(request, env),
			state,
		);
	}
	return githubAppInstallUrl(slug, state);
}

async function githubAppHeaders(env: GithubAppEnv): Promise<HeadersInit> {
	const jwt = await createGithubAppJwt(
		env.GITHUB_APP_ID ?? "",
		env.GITHUB_APP_PRIVATE_KEY ?? "",
	);
	return {
		authorization: `Bearer ${jwt}`,
		accept: "application/vnd.github+json",
		"user-agent": "gpio-companion",
		"x-github-api-version": "2022-11-28",
	};
}

async function githubAppFetch(
	env: GithubAppEnv,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = await githubAppHeaders(env);
	let last: Response | undefined;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		last = await fetch(`${GITHUB_API}${path}`, {
			...init,
			headers: { ...headers, ...(init.headers ?? {}) },
		});
		if (last.status < 500) {
			return last;
		}
	}
	return last as Response;
}

export async function readGithubInstallation(
	env: GithubAppEnv,
	installationId: number,
): Promise<{ id: number; login: string }> {
	const response = await githubAppFetch(
		env,
		`/app/installations/${installationId}`,
	);
	if (!response.ok) {
		throw new Error("github app installation not found");
	}
	const body = (await response.json()) as {
		id?: number;
		account?: { login?: string };
	};
	const login = body.account?.login?.trim() ?? "";
	if (!login) {
		throw new Error("github app installation has no account");
	}
	return { id: body.id ?? installationId, login };
}

export async function mintInstallationToken(
	env: GithubAppEnv,
	installationId: number,
	login: string,
): Promise<GithubInstallationToken> {
	const response = await githubAppFetch(
		env,
		`/app/installations/${installationId}/access_tokens`,
		{ method: "POST" },
	);
	if (!response.ok) {
		throw new Error("github app token mint failed");
	}
	const body = (await response.json()) as {
		token?: string;
		expires_at?: string;
	};
	const token = body.token?.trim() ?? "";
	if (!token) {
		throw new Error("github app token mint failed");
	}
	return {
		token,
		expiresAt:
			body.expires_at ?? new Date(Date.now() + 3_600_000).toISOString(),
		login,
		username: GITHUB_GIT_USER,
	};
}

type GithubOAuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
};

function oauthExpiry(expiresIn: number | undefined): string {
	const seconds = Number(expiresIn);
	const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
	return ms ? new Date(Date.now() + ms).toISOString() : "";
}

async function githubOAuthTokenRequest(
	env: GithubAppEnv,
	body: Record<string, string>,
): Promise<GithubOAuthTokens> {
	const clientId = env.GITHUB_APP_CLIENT_ID?.trim() ?? "";
	const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim() ?? "";
	if (!clientId || !clientSecret) {
		throw new Error("github app oauth is not configured");
	}
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			"user-agent": "gpio-companion",
		},
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			...body,
		}),
	});
	const payload = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error?: string;
		error_description?: string;
	};
	const accessToken = payload.access_token?.trim() ?? "";
	if (!response.ok || !accessToken) {
		throw new Error(
			payload.error_description?.trim() ||
				payload.error?.trim() ||
				"github app oauth failed",
		);
	}
	return {
		accessToken,
		refreshToken: payload.refresh_token?.trim() ?? "",
		expiresAt: oauthExpiry(payload.expires_in),
	};
}

export async function exchangeGithubOAuthCode(
	env: GithubAppEnv,
	code: string,
	redirectUri: string,
): Promise<GithubOAuthTokens> {
	return githubOAuthTokenRequest(env, {
		code,
		redirect_uri: redirectUri,
	});
}

async function exchangeGithubOAuthCodeWithFallback(
	env: GithubAppEnv,
	code: string,
	request: Request,
	preferred?: string,
): Promise<GithubOAuthTokens> {
	const uris = githubAppCallbackCandidates(request, env, preferred);
	let last: unknown;
	for (const redirectUri of uris) {
		try {
			return await exchangeGithubOAuthCode(env, code, redirectUri);
		} catch (caught) {
			last = caught;
		}
	}
	throw last instanceof Error ? last : new Error("github app oauth failed");
}

async function refreshGithubUserToken(
	env: GithubAppEnv,
	refreshToken: string,
): Promise<GithubOAuthTokens> {
	return githubOAuthTokenRequest(env, {
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});
}

function userTokenFresh(expiresAt: string | undefined): boolean {
	if (!expiresAt) {
		return true;
	}
	const expires = Date.parse(expiresAt);
	if (!Number.isFinite(expires)) {
		return true;
	}
	return expires - Date.now() > 60_000;
}

export async function loadFreshUserToken(
	env: GithubAppEnv,
	userId: string,
	install: GithubAppInstall,
): Promise<string> {
	if (install.userToken && userTokenFresh(install.userTokenExpiresAt)) {
		return install.userToken;
	}
	const refreshToken = install.refreshToken ?? "";
	if (!refreshToken) {
		return install.userToken ?? "";
	}
	try {
		const next = await refreshGithubUserToken(env, refreshToken);
		await saveGithubAppInstall(env.DYNAMIC_PAGE_KV, userId, {
			...install,
			userToken: next.accessToken,
			refreshToken: next.refreshToken || refreshToken,
			...(next.expiresAt ? { userTokenExpiresAt: next.expiresAt } : {}),
		});
		return next.accessToken;
	} catch {
		return install.userToken ?? "";
	}
}

async function userJson<T>(token: string, path: string): Promise<T> {
	const response = await fetch(`${GITHUB_API}${path}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"user-agent": "gpio-companion",
			"x-github-api-version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`github ${response.status}`);
	}
	return (await response.json()) as T;
}

export async function installationIdFromUserToken(
	env: GithubAppEnv,
	userToken: string,
): Promise<number> {
	const appId = Number(env.GITHUB_APP_ID);
	const body = await userJson<{
		installations?: Array<{ id?: number; app_id?: number }>;
	}>(userToken, "/user/installations");
	const match = (body.installations ?? []).find(
		(item) => Number(item.app_id) === appId && Number(item.id) > 0,
	);
	return Number(match?.id) || 0;
}

export async function githubAppStatusForUser(
	env: GithubAppEnv,
	userId: string,
	request: Request,
): Promise<GithubAppStatus> {
	const slug = env.GITHUB_APP_SLUG?.trim() ?? "";
	if (!slug || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
		throw new Error("github app is not configured");
	}
	const install = await loadGithubAppInstall(env.DYNAMIC_PAGE_KV, userId);
	const canCreate = Boolean(install && githubAppCanCreate(install));
	if (install && canCreate) {
		return {
			connected: true,
			login: install.login,
			installUrl: "",
			canCreate: true,
		};
	}
	const state = crypto.randomUUID();
	await env.DYNAMIC_PAGE_KV.put(githubAppStateKey(state), userId, {
		expirationTtl: 3600,
	});
	return {
		connected: Boolean(install),
		login: install?.login ?? "",
		installUrl: githubAppConnectUrl(env, slug, state, request),
		canCreate: false,
	};
}

export async function completeGithubAppConnect(
	env: GithubAppEnv,
	userId: string,
	input: {
		installationId?: number | string;
		code?: string;
		state: string;
		redirectUri?: string;
	},
	request: Request,
): Promise<{ connected: true; login: string; canCreate: boolean }> {
	const state = input.state.trim();
	const expected = await env.DYNAMIC_PAGE_KV.get(githubAppStateKey(state));
	if (!state || expected !== userId) {
		throw new Error("github app state is invalid");
	}
	const existing = await loadGithubAppInstall(env.DYNAMIC_PAGE_KV, userId);
	const code = input.code?.trim() ?? "";
	let userToken = existing?.userToken ?? "";
	let refreshToken = existing?.refreshToken ?? "";
	let userTokenExpiresAt = existing?.userTokenExpiresAt ?? "";
	if (code) {
		const tokens = await exchangeGithubOAuthCodeWithFallback(
			env,
			code,
			request,
			input.redirectUri,
		);
		userToken = tokens.accessToken;
		refreshToken = tokens.refreshToken || refreshToken;
		userTokenExpiresAt = tokens.expiresAt || userTokenExpiresAt;
	}
	let installationId = Number(input.installationId);
	if (!Number.isFinite(installationId) || installationId <= 0) {
		installationId = existing?.installationId ?? 0;
	}
	if ((!Number.isFinite(installationId) || installationId <= 0) && userToken) {
		installationId = await installationIdFromUserToken(env, userToken);
	}
	if (!Number.isFinite(installationId) || installationId <= 0) {
		throw new Error("installation id is required");
	}
	const info = await readGithubInstallation(env, installationId);
	const install: GithubAppInstall = {
		installationId: info.id,
		login: info.login,
		...(userToken ? { userToken } : {}),
		...(refreshToken ? { refreshToken } : {}),
		...(userTokenExpiresAt ? { userTokenExpiresAt } : {}),
	};
	await saveGithubAppInstall(env.DYNAMIC_PAGE_KV, userId, install);
	await env.DYNAMIC_PAGE_KV.delete(githubAppStateKey(state));
	return {
		connected: true,
		login: info.login,
		canCreate: githubAppCanCreate(install),
	};
}

export async function issueGithubCredentials(
	env: GithubAppEnv,
	uuid: string,
	key: string,
): Promise<GithubInstallationToken> {
	const trimmed = uuid.trim();
	if (!trimmed || !key) {
		throw new Error("uuid and key are required");
	}
	const ownerId = await env.DYNAMIC_PAGE_KV.get(pairOwnerKey(trimmed));
	if (!ownerId) {
		throw new Error("unknown pairing");
	}
	const devices = await loadDevices(env.DYNAMIC_PAGE_KV, ownerId);
	const device = devices.find((item) => item.uuid === trimmed);
	if (!device || !timingSafeEqualString(device.key, key)) {
		throw new Error("pairing key mismatch");
	}
	const install = await loadGithubAppInstall(env.DYNAMIC_PAGE_KV, ownerId);
	if (!install) {
		throw new Error("GitHub App is not connected");
	}
	return mintInstallationToken(env, install.installationId, install.login);
}
