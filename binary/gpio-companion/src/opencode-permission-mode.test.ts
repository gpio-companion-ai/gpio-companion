import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDeviceConfig } from "gpio-companion";
import {
	defaultOpencodePermissionConfigPath,
	handleOpencodePermissionMode,
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

describe("opencode permission mode", () => {
	test("writes allow permissions for full control", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(
			path,
			JSON.stringify(
				{
					model: "gpio-companion/@cf/zai-org/glm-5.3",
					provider: { "gpio-companion": { npm: "@ai-sdk/openai-compatible" } },
				},
				null,
				"\t",
			),
		);
		expect(await writeOpencodePermissionConfig(path, "full")).toBe("changed");
		const written = JSON.parse(await readFile(path, "utf8"));
		expect(written.permission).toEqual({
			edit: "allow",
			bash: "allow",
			webfetch: "allow",
		});
		expect(written.model).toBe("gpio-companion/@cf/zai-org/glm-5.3");
		expect(written.provider["gpio-companion"].npm).toBe(
			"@ai-sdk/openai-compatible",
		);
		expect(await writeOpencodePermissionConfig(path, "full")).toBe("unchanged");
	});

	test("restores ask and keeps other keys", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-perm-"));
		const path = join(dir, "opencode.json");
		await writeFile(path, JSON.stringify({ model: "m", permission: "ask" }));
		expect(await writeOpencodePermissionConfig(path, "ask")).toBe("changed");
		expect(await writeOpencodePermissionConfig(path, "ask")).toBe("unchanged");
		expect(await writeOpencodePermissionConfig(path, "full")).toBe("changed");
		expect(await writeOpencodePermissionConfig(path, "ask")).toBe("changed");
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
			restart: async () => {
				restarts += 1;
			},
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ mode: "full" });
		expect(store.value().opencodePermission).toBe("full");
		expect(JSON.parse(await readFile(path, "utf8")).permission).toEqual({
			edit: "allow",
			bash: "allow",
			webfetch: "allow",
		});
		expect(restarts).toBe(1);
		const again = await handleOpencodePermissionMode({
			method: "POST",
			bodyText: `{"mode":"full"}`,
			store,
			opencodeJsonPath: path,
			restart: async () => {
				restarts += 1;
			},
		});
		expect(await again.json()).toEqual({ mode: "full" });
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
			restart: async () => {
				restarts += 1;
			},
		});
		expect(await response.json()).toEqual({ mode: "ask" });
		expect(store.value().opencodePermission).toBe("ask");
		expect(JSON.parse(await readFile(path, "utf8")).permission).toBe("ask");
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
