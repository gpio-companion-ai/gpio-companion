import {
	dashboardOrigin,
	type FetchLike,
	fetchAiCredentials,
} from "./ai-credentials.ts";

const SECRET_KEYS = new Set([
	"appId",
	"accessKey",
	"secretKey",
	"appSecret",
	"apiKey",
]);

export async function proxyJlcpcbRequest(options: {
	request: Request;
	bodyText: string;
	uuid: string;
	key: string;
	origin?: string;
	fetchImpl?: FetchLike;
}): Promise<Response> {
	const method = options.request.method.toUpperCase();
	if (method !== "GET" && method !== "POST") {
		return Response.json({ error: "method not allowed" }, { status: 405 });
	}
	const creds = await fetchAiCredentials({
		uuid: options.uuid,
		key: options.key,
		origin: options.origin,
		fetchImpl: options.fetchImpl,
	});
	const headers = new Headers();
	headers.set("authorization", `Bearer ${creds.token}`);
	const init: RequestInit = { method, headers };
	if (method === "POST") {
		headers.set("content-type", "application/json");
		init.body = stripSecretFields(options.bodyText);
	}
	const fetcher = options.fetchImpl ?? fetch;
	const upstream = await fetcher(
		`${dashboardOrigin(options.origin)}/api/jlcpcb/device`,
		init,
	);
	const text = await upstream.text();
	return new Response(stripSecretFields(text), {
		status: upstream.status,
		headers: {
			"content-type":
				upstream.headers.get("content-type") ?? "application/json",
		},
	});
}

function stripSecretFields(text: string): string {
	if (!text) {
		return text;
	}
	try {
		return JSON.stringify(dropSecrets(JSON.parse(text)));
	} catch {
		return text;
	}
}

function dropSecrets(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(dropSecrets);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const next: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (SECRET_KEYS.has(key)) {
			continue;
		}
		next[key] = dropSecrets(item);
	}
	return next;
}
