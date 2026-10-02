import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDeviceConfig } from "gpio-companion";
import {
	defaultOpencodePermissionConfigPath,
	detectOpencodePermissionSchema,
	handleOpencodePermissionMode,
	opencodePermissionSchemaForVersion,
	parseOpencodePermissionModeBody,
	writeOpencodePermissionConfig,
} from "./opencode-permission-mode.ts";

function memoryStore(config = emptyDeviceConfig("raspberrypi")) {
	let current = config;
	return {
		read: async () => current,
		write: async (next: typeof current) => {
			current = next;
		},
		value: () => current,
	};
}

describe("opencode permission schema version", () => {
	test("maps versions to schemas", () => {
		expect(opencodePermissionSchemaForVersion("1.18.34")).toBe("v1");
		expect(opencodePermissionSchemaForVersion("1.0.0")).toBe("v1");
		expect(opencodePermissionSchemaForVersion("2.0.1")).toBe("v2");
		expect(opencodePermissionSchemaForVersion("10.0.0")).toBe("v2");
		expect(opencodePermissionSchemaForVersion("")).toBe("v1");
		expect(opencodePermissionSchemaForVersion("garbage")).toBe("v1");
	});

	test("detects schema from the version file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		await writeFile(join(dir, "marker"), "");
		await mkdir(join(dir, ".opencode"));
		await writeFile(join(dir, ".opencode", "version"), "1.18.34\n");
		expect(await detectOpencodePermissionSchema(dir)).toBe("v1");
		await writeFile(join(dir, ".opencode", "version"), "2.0.0\n");
		expect(await detectOpencodePermissionSchema(dir)).toBe("v2");
	});
});

async function mkdir(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(path, { recursive: true });
}

describe("opencode permission mode", () => {
	test("v1 schema writes permission and drops permissions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(
			path,
			JSON.stringify(
				{
					model: "gpio-companion/@cf/zai-org/glm-5.3",
					provider: { "gpio-companion": { npm: "@ai-sdk/openai-compatible" } },
					permissions: [{ action: "*", resource: "*", effect: "ask" }],
				},
				null,
				"\t",
			),
		);
		expect(
			await writeOpencodePermissionConfig(path, "full", { schema: "v1" }),
		).toBe("changed");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permission).toBe("allow");
		expect(written.permissions).toBeUndefined();
		expect(written.model).toBe("gpio-companion/@cf/zai-org/glm-5.3");
		expect(written.provider["gpio-companion"].npm).toBe(
			"@ai-sdk/openai-compatible",
		);
		expect(
			await writeOpencodePermissionConfig(path, "full", { schema: "v1" }),
		).toBe("unchanged");
	});

	test("v2 schema writes permissions and drops permission", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(
			path,
			JSON.stringify({
				model: "m",
				permission: "ask",
			}),
		);
		expect(
			await writeOpencodePermissionConfig(path, "full", { schema: "v2" }),
		).toBe("changed");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permissions).toEqual([
			{ action: "*", resource: "*", effect: "allow" },
		]);
		expect(written.permission).toBeUndefined();
		expect(written.model).toBe("m");
		expect(
			await writeOpencodePermissionConfig(path, "full", { schema: "v2" }),
		).toBe("unchanged");
	});

	test("defaults to the v1 schema", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(path, JSON.stringify({ model: "m" }));
		expect(await writeOpencodePermissionConfig(path, "ask")).toBe("changed");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permission).toBe("ask");
		expect(written.permissions).toBeUndefined();
	});

	test("restores ask and keeps other keys", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(
			path,
			`${JSON.stringify({ model: "m", permission: "ask" }, null, "\t")}\n`,
		);
		expect(
			await writeOpencodePermissionConfig(path, "ask", { schema: "v1" }),
		).toBe("unchanged");
		expect(
			await writeOpencodePermissionConfig(path, "full", { schema: "v1" }),
		).toBe("changed");
		expect(
			await writeOpencodePermissionConfig(path, "ask", { schema: "v1" }),
		).toBe("changed");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permission).toBe("ask");
		expect(written.model).toBe("m");
	});

	test("parses the mode body strictly", () => {
		expect(parseOpencodePermissionModeBody(`{"mode":"full"}`)).toBe("full");
		expect(parseOpencodePermissionModeBody(`{"mode":"ask"}`)).toBe("ask");
		expect(parseOpencodePermissionModeBody(`{"mode":"once"}`)).toBeNull();
		expect(parseOpencodePermissionModeBody(`{"mode":null}`)).toBeNull();
		expect(parseOpencodePermissionModeBody("nope")).toBeNull();
	});

	test("GET returns the stored mode", async () => {
		const store = memoryStore();
		const response = await handleOpencodePermissionMode({
			method: "GET",
			bodyText: "",
			store,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ mode: "ask" });
	});

	test("POST full control persists config and restarts once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		const store = memoryStore();
		let restarts = 0;
		const response = await handleOpencodePermissionMode({
			method: "POST",
			bodyText: `{"mode":"full"}`,
			store,
			opencodeJsonPath: path,
			schema: "v1",
			restart: async () => {
				restarts += 1;
			},
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ mode: "full", restarted: true });
		expect(store.value().opencodePermission).toBe("full");
		expect(JSON.parse(await readFile(path, "utf8")).permission).toBe("allow");
		expect(
			JSON.parse(await readFile(path, "utf8")).permissions,
		).toBeUndefined();
		expect(restarts).toBe(1);
		const again = await handleOpencodePermissionMode({
			method: "POST",
			bodyText: `{"mode":"full"}`,
			store,
			opencodeJsonPath: path,
			schema: "v1",
			restart: async () => {
				restarts += 1;
			},
		});
		expect(await again.json()).toEqual({ mode: "full", restarted: true });
		expect(restarts).toBe(1);
	});

	test("POST ask restores prompting and restarts on change", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		const store = memoryStore({
			...emptyDeviceConfig("raspberrypi"),
			opencodePermission: "full",
		});
		let restarts = 0;
		const response = await handleOpencodePermissionMode({
			method: "POST",
			bodyText: `{"mode":"ask"}`,
			store,
			opencodeJsonPath: path,
			schema: "v2",
			restart: async () => {
				restarts += 1;
			},
		});
		expect(await response.json()).toEqual({ mode: "ask", restarted: true });
		expect(store.value().opencodePermission).toBe("ask");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permission).toBeUndefined();
		expect(written.permissions).toEqual([
			{ action: "*", resource: "*", effect: "ask" },
		]);
		expect(restarts).toBe(1);
	});

	test("rejects unknown modes and methods", async () => {
		const store = memoryStore();
		const bad = await handleOpencodePermissionMode({
			method: "POST",
			bodyText: `{"mode":"deny"}`,
			store,
		});
		expect(bad.status).toBe(400);
		const method = await handleOpencodePermissionMode({
			method: "DELETE",
			bodyText: "",
			store,
		});
		expect(method.status).toBe(405);
		expect(defaultOpencodePermissionConfigPath()).toContain("opencode.json");
	});
});
