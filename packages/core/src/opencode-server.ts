export const OPENCODE_PROXY_PATH = "/v1/opencode";
export const OPENCODE_LOOPBACK_URL = "http://127.0.0.1:4096";
export const OPENCODE_SERVER_PORT = 4096;
export const OPENCODE_SERVER_USERNAME = "opencode";

export function isOpencodeProxyPath(path: string): boolean {
	return (
		path === OPENCODE_PROXY_PATH || path.startsWith(`${OPENCODE_PROXY_PATH}/`)
	);
}

export function isOpencodeLoopbackHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function opencodeUpstreamUrl(raw?: string): string {
	const value = (raw?.trim() || OPENCODE_LOOPBACK_URL).replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("opencode upstream must be loopback");
	}
	if (url.protocol !== "http:" || !isOpencodeLoopbackHost(url.hostname)) {
		throw new Error("opencode upstream must be loopback");
	}
	if (url.port === "4150") {
		throw new Error("opencode upstream must be loopback");
	}
	return url.origin;
}

export function opencodeProxyTarget(
	path: string,
	search: string,
	upstream?: string,
): string {
	if (!isOpencodeProxyPath(path)) {
		throw new Error("opencode proxy path required");
	}
	const origin = opencodeUpstreamUrl(upstream);
	const suffix =
		path === OPENCODE_PROXY_PATH ? "/" : path.slice(OPENCODE_PROXY_PATH.length);
	const url = new URL(
		suffix.startsWith("/") ? suffix : `/${suffix}`,
		`${origin}/`,
	);
	if (url.origin !== origin) {
		throw new Error("opencode proxy path escaped");
	}
	url.search = search;
	return url.toString();
}
