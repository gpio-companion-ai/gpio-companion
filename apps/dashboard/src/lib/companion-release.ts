import { COMPANION_REPO } from "gpio-companion";

export type CompanionRelease = {
	version: string | null;
	url: string | null;
};

const CACHE_KEY = "companion-release:latest";
const CACHE_TTL = 1800;

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
};

export async function fetchLatestCompanionRelease(
	env: PagesEnv,
): Promise<CompanionRelease> {
	try {
		const cached = await env.DYNAMIC_PAGE_KV.get(CACHE_KEY);
		if (cached) {
			return JSON.parse(cached) as CompanionRelease;
		}
	} catch {
		// stale or unreadable cache entries fall through to a fresh fetch
	}
	const release = await requestLatestRelease();
	if (release.version) {
		try {
			await env.DYNAMIC_PAGE_KV.put(CACHE_KEY, JSON.stringify(release), {
				expirationTtl: CACHE_TTL,
			});
		} catch {
			// cache write failures must not break the response
		}
	}
	return release;
}

async function requestLatestRelease(): Promise<CompanionRelease> {
	try {
		const response = await fetch(
			`https://api.github.com/repos/${COMPANION_REPO}/releases/latest`,
			{
				headers: {
					accept: "application/vnd.github+json",
					"user-agent": "gpio-companion-dashboard",
				},
			},
		);
		if (!response.ok) {
			return { version: null, url: null };
		}
		const body = (await response.json()) as {
			tag_name?: string;
			html_url?: string;
		};
		const version = body.tag_name?.replace(/^companion-v/, "").trim();
		if (!version) {
			return { version: null, url: null };
		}
		return {
			version,
			url:
				body.html_url ?? `https://github.com/${COMPANION_REPO}/releases/latest`,
		};
	} catch {
		return { version: null, url: null };
	}
}
