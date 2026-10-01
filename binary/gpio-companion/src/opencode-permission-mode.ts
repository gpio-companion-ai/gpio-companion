import { homedir } from "node:os";
import { join } from "node:path";
import {
	OPENCODE_PROXY_PATH,
	deviceOpencodePermissionMode,
	type DeviceConfig,
	type OpencodePermissionMode,
} from "gpio-companion";
import { restartOpencodeUserService } from "./opencode-proxy.ts";
import type { ConfigStore } from "./store.ts";

export const OPENCODE_PERMISSION_MODE_PATH = `${OPENCODE_PROXY_PATH}/permission-mode`;

export const OPENCODE_PERMISSION_ALLOW = {
	edit: "allow",
	bash: "allow",
	webfetch: "allow",
} as const;

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
): Promise<"changed" | "unchanged"> {
	const data = await readOpencodePermissionConfig(path);
	const next = {
		...data,
		permission: mode === "full" ? OPENCODE_PERMISSION_ALLOW : "ask",
	};
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
	const path = options.opencodeJsonPath ?? defaultOpencodePermissionConfigPath();
	const changed = await writeOpencodePermissionConfig(path, mode);
	const next: DeviceConfig = { ...config, opencodePermission: mode };
	await options.store.write(next);
	if (changed === "changed" || current !== mode) {
		await (options.restart ?? restartOpencodeUserService)();
	}
	return Response.json({ mode });
}
