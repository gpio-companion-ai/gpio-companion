import { GITHUB_GIT_USER } from "gpio-companion";
import type { FetchLike } from "./ai-credentials.ts";
import type { SecretsStore } from "./secrets.ts";

export const DEFAULT_DASHBOARD_URL = "https://gpio-companion.com";
export const GITHUB_TOKEN_SKEW_MS = 5 * 60 * 1000;

export type GithubInstallationCreds = {
	token: string;
	expiresAt: string;
	login: string;
	username: string;
};

export type GithubCredentialsOptions = {
	origin?: string;
	uuid: string;
	key: string;
	fetchImpl?: FetchLike;
};

const cache = new Map<string, GithubInstallationCreds>();

export function dashboardOrigin(origin?: string): string {
	return (
		origin ||
		process.env.GPIO_COMPANION_DASHBOARD_URL ||
		DEFAULT_DASHBOARD_URL
	).replace(/\/+$/, "");
}

export function credentialsCacheKey(uuid: string): string {
	return uuid.trim();
}

export function cachedGithubCredentials(
	uuid: string,
	now = Date.now(),
): GithubInstallationCreds | null {
	const hit = cache.get(credentialsCacheKey(uuid));
	if (!hit) {
		return null;
	}
	if (Date.parse(hit.expiresAt) - now <= GITHUB_TOKEN_SKEW_MS) {
		cache.delete(credentialsCacheKey(uuid));
		return null;
	}
	return hit;
}

export function rememberGithubCredentials(
	uuid: string,
	creds: GithubInstallationCreds,
): void {
	cache.set(credentialsCacheKey(uuid), creds);
}

export function forgetGithubCredentials(uuid: string): void {
	cache.delete(credentialsCacheKey(uuid));
}

export async function fetchGithubTokenLocal(
	port = Number(process.env.GPIO_COMPANION_PORT ?? 4150),
	fetchImpl: FetchLike = fetch,
): Promise<GithubInstallationCreds> {
	const response = await fetchImpl(`http://127.0.0.1:${port}/v1/github-token`);
	if (!response.ok) {
		throw new Error(`github token ${response.status}`);
	}
	return (await response.json()) as GithubInstallationCreds;
}

export async function loadGithubCreds(
	uuid: string,
	key: string,
	port?: number,
	fetchImpl?: FetchLike,
): Promise<GithubInstallationCreds> {
	try {
		return await fetchGithubTokenLocal(port, fetchImpl);
	} catch {
		return fetchGithubCredentials({ uuid, key, fetchImpl });
	}
}

export async function fetchGithubCredentials(
	options: GithubCredentialsOptions,
): Promise<GithubInstallationCreds> {
	const uuid = options.uuid.trim();
	if (!uuid || !options.key) {
		throw new Error("pairing uuid and key are required");
	}
	const cached = cachedGithubCredentials(uuid);
	if (cached) {
		return cached;
	}
	const fetcher = options.fetchImpl ?? fetch;
	const origin = dashboardOrigin(options.origin);
	const response = await fetcher(`${origin}/api/github-credentials`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ uuid, key: options.key }),
	});
	if (!response.ok) {
		let detail = `github credentials ${response.status}`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body.error) {
				detail = body.error;
			}
		} catch {
			detail = `github credentials ${response.status}`;
		}
		throw new Error(detail);
	}
	const body = (await response.json()) as Partial<GithubInstallationCreds>;
	const token = body.token?.trim() ?? "";
	if (!token) {
		throw new Error("github credentials missing token");
	}
	const creds: GithubInstallationCreds = {
		token,
		expiresAt: body.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
		login: body.login?.trim() ?? "",
		username: body.username?.trim() || GITHUB_GIT_USER,
	};
	rememberGithubCredentials(uuid, creds);
	return creds;
}

export async function persistGithubLogin(
	secrets: SecretsStore,
	creds: GithubInstallationCreds,
): Promise<void> {
	const current = await secrets.read();
	await secrets.write({
		...current,
		githubUsername: creds.login || current.githubUsername,
		githubToken: creds.token,
		githubUrl: current.githubUrl || "https://github.com",
	});
}

export function parseGitCredentialInput(text: string): {
	protocol: string;
	host: string;
} {
	const fields: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const index = line.indexOf("=");
		if (index <= 0) {
			continue;
		}
		fields[line.slice(0, index)] = line.slice(index + 1).trim();
	}
	return {
		protocol: fields.protocol ?? "",
		host: fields.host ?? "",
	};
}

export function formatGitCredentialOutput(
	creds: GithubInstallationCreds,
): string {
	return `username=${creds.username}\npassword=${creds.token}\n`;
}

export async function runGitCredentialHelper(
	operation: string,
	input: string,
	options: GithubCredentialsOptions,
): Promise<string> {
	const host = parseGitCredentialInput(input);
	if (operation === "erase") {
		forgetGithubCredentials(options.uuid);
		return "";
	}
	if (operation !== "get") {
		return "";
	}
	if (host.host && host.host !== "github.com") {
		return "";
	}
	try {
		const creds = await loadGithubCreds(
			options.uuid,
			options.key,
			undefined,
			options.fetchImpl,
		);
		return formatGitCredentialOutput(creds);
	} catch (caught) {
		forgetGithubCredentials(options.uuid);
		if (operation === "get") {
			throw caught;
		}
		return "";
	}
}
