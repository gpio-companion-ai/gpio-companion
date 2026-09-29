import { chmod } from "node:fs/promises";
import {
	OPENCODE_SERVER_USERNAME,
	opencodeProxyTarget,
	opencodeUpstreamUrl,
} from "gpio-companion";
import {
	dashboardOrigin,
	type FetchLike,
	forgetAiCredentials,
} from "./ai-credentials.ts";

export const DEFAULT_OPENCODE_SERVER_ENV =
	"/etc/gpio-companion/opencode-server.env";

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
]);

export type OpencodeServerAuth = {
	username: string;
	password: string;
};

export function opencodeBasicAuthorization(auth: OpencodeServerAuth): string {
	return `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
}

export async function readOpencodeServerAuth(
	path: string,
): Promise<OpencodeServerAuth> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error("opencode server password is not set");
	}
	let username = OPENCODE_SERVER_USERNAME;
	let password = "";
	for (const line of (await file.text()).split("\n")) {
		if (line.startsWith("OPENCODE_SERVER_USERNAME=")) {
			const value = line.slice("OPENCODE_SERVER_USERNAME=".length).trim();
			if (value) {
				username = value;
			}
		}
		if (line.startsWith("OPENCODE_SERVER_PASSWORD=")) {
			password = line.slice("OPENCODE_SERVER_PASSWORD=".length).trim();
		}
	}
	if (!password) {
		throw new Error("opencode server password is not set");
	}
	return { username, password };
}

export async function rotateOpencodeServerPassword(
	path: string,
): Promise<void> {
	if (!path.trim()) {
		return;
	}
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const password = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	await Bun.write(
		path,
		`OPENCODE_SERVER_USERNAME=${OPENCODE_SERVER_USERNAME}\nOPENCODE_SERVER_PASSWORD=${password}\n`,
	);
	await chmod(path, 0o600);
}

export async function assertOpencodeProxyGranted(options: {
	claimed: boolean;
	uuid: string;
	key: string;
	origin?: string;
	fetchImpl?: FetchLike;
}): Promise<void> {
	const uuid = options.uuid.trim();
	if (!options.claimed || !uuid || !options.key) {
		throw new Error("opencode proxy revoked");
	}
	const fetcher = options.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await fetcher(
			`${dashboardOrigin(options.origin)}/api/ai/credentials`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ uuid, key: options.key }),
			},
		);
	} catch {
		throw new Error("opencode proxy revoked");
	}
	if (!response.ok) {
		throw new Error("opencode proxy revoked");
	}
}

export async function proxyOpencodeRequest(options: {
	request: Request;
	path: string;
	search: string;
	bodyText: string;
	upstream?: string;
	auth: OpencodeServerAuth;
	fetchImpl?: FetchLike;
}): Promise<Response> {
	const target = opencodeProxyTarget(
		options.path,
		options.search,
		options.upstream,
	);
	opencodeUpstreamUrl(options.upstream);
	const headers = new Headers();
	headers.set("authorization", opencodeBasicAuthorization(options.auth));
	for (const name of [
		"content-type",
		"accept",
		"last-event-id",
		"x-opencode-directory",
	]) {
		const value = options.request.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}
	const method = options.request.method.toUpperCase();
	const init: RequestInit = { method, headers };
	if (method !== "GET" && method !== "HEAD") {
		init.body = options.bodyText;
	}
	const fetcher = options.fetchImpl ?? fetch;
	let upstream: Response;
	try {
		upstream = await fetcher(target, init);
	} catch {
		return Response.json(
			{ error: "opencode server unavailable" },
			{ status: 503 },
		);
	}
	const out = new Headers();
	upstream.headers.forEach((value, key) => {
		const lower = key.toLowerCase();
		if (HOP_BY_HOP.has(lower) || lower.startsWith("access-control-")) {
			return;
		}
		out.set(key, value);
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: out,
	});
}

export async function restartOpencodeUserService(
	spawn: typeof Bun.spawn = Bun.spawn,
): Promise<void> {
	const uid = typeof process.getuid === "function" ? process.getuid() : 0;
	const runtime = `/run/user/${uid}`;
	const proc = spawn(
		["systemctl", "--user", "restart", "gpio-opencode.service"],
		{
			env: {
				...process.env,
				XDG_RUNTIME_DIR: runtime,
				DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
			},
			stdout: "ignore",
			stderr: "pipe",
		},
	);
	await proc.exited;
}

export async function revokeOpencodeAccess(options: {
	envPath?: string;
	uuid?: string;
	rotate?: (path: string) => Promise<void>;
	restart?: () => Promise<void>;
}): Promise<void> {
	const uuid = options.uuid?.trim() ?? "";
	if (uuid) {
		forgetAiCredentials(uuid);
	}
	const envPath = options.envPath?.trim() ?? "";
	if (envPath) {
		await (options.rotate ?? rotateOpencodeServerPassword)(envPath);
	}
	if (options.restart) {
		await options.restart();
		return;
	}
	if (!envPath) {
		return;
	}
	await restartOpencodeUserService().catch(() => undefined);
}
