import { homedir } from "node:os";
import { join } from "node:path";
import {
	type DeviceConfig,
	deviceOpencodePermissionMode,
	OPENCODE_PROXY_PATH,
	type OpencodePermissionMode,
} from "gpio-companion";
import { restartOpencodeUserService } from "./opencode-proxy.ts";
import type { ConfigStore } from "./store.ts";

export const OPENCODE_PERMISSION_MODE_PATH = `${OPENCODE_PROXY_PATH}/permission-mode`;

export const OPENCODE_PERMISSION_ALLOW = "allow" as const;
export const OPENCODE_PERMISSION_ASK = "ask" as const;

export const OPENCODE_PERMISSIONS_ALLOW_ALL = [
	{ action: "*", resource: "*", effect: "allow" },
] as const;

export const OPENCODE_PERMISSIONS_ASK_ALL = [
	{ action: "*", resource: "*", effect: "ask" },
] as const;

export type OpencodePermissionSchema = "v1" | "v2";

export function opencodePermissionSchemaForVersion(
	version: string,
): OpencodePermissionSchema {
	const match = /^(\d+)/.exec(version.trim());
	const major = match ? Number(match[1]) : 0;
	return major >= 2 ? "v2" : "v1";
}

function defaultOpencodeHome(): string {
	return process.env.GPIO_COMPANION_OPENCODE_HOME?.trim() || homedir();
}

async function execOpencodeVersion(home: string): Promise<string> {
	const bin = join(home, ".opencode", "bin", "opencode");
	const command = (await Bun.file(bin).exists()) ? bin : "opencode";
	const proc = Bun.spawn([command, "--version"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const timer = setTimeout(() => {
		proc.kill();
	}, 5000);
	try {
		const text = await new Response(proc.stdout).text();
		return text.trim();
	} finally {
		clearTimeout(timer);
		await proc.exited;
	}
}

export async function detectOpencodePermissionSchema(
	home = defaultOpencodeHome(),
): Promise<OpencodePermissionSchema> {
	try {
		const file = Bun.file(join(home, ".opencode", "version"));
		if (await file.exists()) {
			const version = (await file.text()).trim();
			if (version) return opencodePermissionSchemaForVersion(version);
		}
	} catch {}
	try {
		const version = await execOpencodeVersion(home);
		if (version) return opencodePermissionSchemaForVersion(version);
	} catch {}
	return "v1";
}

export function defaultOpencodePermissionConfigPath(): string {
	const home = process.env.GPIO_COMPANION_OPENCODE_HOME?.trim() || homedir();
	return join(home, ".config", "opencode", "opencode.json");
}

export async function readOpencodePermissionConfig(
	path: string,
): Promise<Record<string, unknown>> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return {};
	}
	try {
		const loaded = await file.json();
		if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
			return loaded as Record<string, unknown>;
		}
	} catch {
		return {};
	}
	return {};
}

export async function writeOpencodePermissionConfig(
	path: string,
	mode: OpencodePermissionMode,
	options?: { schema?: OpencodePermissionSchema },
): Promise<"changed" | "unchanged"> {
	const data = await readOpencodePermissionConfig(path);
	const schema = options?.schema ?? "v1";
	const next: Record<string, unknown> = { ...data };
	if (schema === "v2") {
		next.permissions =
			mode === "full"
				? [...OPENCODE_PERMISSIONS_ALLOW_ALL.map((rule) => ({ ...rule }))]
				: [...OPENCODE_PERMISSIONS_ASK_ALL.map((rule) => ({ ...rule }))];
		delete next.permission;
	} else {
		next.permission =
			mode === "full" ? OPENCODE_PERMISSION_ALLOW : OPENCODE_PERMISSION_ASK;
		delete next.permissions;
	}
	const text = `${JSON.stringify(next, null, "\t")}\n`;
	const file = Bun.file(path);
	if ((await file.exists()) && (await file.text()) === text) {
		return "unchanged";
	}
	await Bun.write(path, text);
	return "changed";
}

export function parseOpencodePermissionModeBody(
	bodyText: string,
): OpencodePermissionMode | null {
	let body: unknown;
	try {
		body = JSON.parse(bodyText);
	} catch {
		return null;
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	const mode = (body as Record<string, unknown>).mode;
	if (mode !== "ask" && mode !== "full") {
		return null;
	}
	return mode;
}

export async function handleOpencodePermissionMode(options: {
	method: string;
	bodyText: string;
	store: Pick<ConfigStore, "read" | "write">;
	opencodeJsonPath?: string;
	schema?: OpencodePermissionSchema;
	home?: string;
	restart?: () => Promise<void>;
}): Promise<Response> {
	const config = await options.store.read();
	const current = deviceOpencodePermissionMode(config);
	if (options.method === "GET") {
		return Response.json({ mode: current });
	}
	if (options.method !== "POST") {
		return Response.json({ error: "method not allowed" }, 405);
	}
	const mode = parseOpencodePermissionModeBody(options.bodyText);
	if (!mode) {
		return Response.json(
			{ error: "mode must be ask or full" },
			{ status: 400 },
		);
	}
	const path =
		options.opencodeJsonPath?.trim() || defaultOpencodePermissionConfigPath();
	const schema =
		options.schema ?? (await detectOpencodePermissionSchema(options.home));
	const changed = await writeOpencodePermissionConfig(path, mode, { schema });
	const next: DeviceConfig = { ...config, opencodePermission: mode };
	await options.store.write(next);
	let restarted = false;
	if (changed === "changed" || current !== mode) {
		try {
			await (options.restart ?? restartOpencodeUserService)();
			restarted = true;
		} catch {
			restarted = false;
		}
	} else {
		restarted = true;
	}
	return Response.json({ mode, restarted });
}
