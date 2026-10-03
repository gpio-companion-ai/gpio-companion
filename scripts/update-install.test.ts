import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const libSh = join(import.meta.dir, "lib.sh");

const dirs: string[] = [];

async function tempDir() {
	const { mkdtemp } = await import("node:fs/promises");
	const dir = await mkdtemp(join(tmpdir(), "gpio-install-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (dirs.length > 0) {
		const dir = dirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function bash(script: string, extraEnv: Record<string, string> = {}) {
	const proc = Bun.spawn(["bash", "-ec", script], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...extraEnv },
	});
	const [stdout, stderr, exit] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exit };
}

async function writeFakeBinary(
	path: string,
	versionBehavior: "ok" | "fail",
	marker = "default",
) {
	const body =
		versionBehavior === "ok"
			? `#!/bin/sh\ncase "$1" in --version) echo 0.0.0-${marker}; exit 0;; esac\nexit 0\n`
			: "#!/bin/sh\nexit 1\n";
	await Bun.write(path, body);
	await Bun.$`chmod 0755 ${path}`.quiet();
}

describe("swap_gpio_companion_bin", () => {
	test("installs a healthy binary and backs up the outgoing one", async () => {
		const dir = await tempDir();
		const binDir = join(dir, "bin");
		const src = join(dir, "src-new");
		const current = join(binDir, "gpio-companion");
		await Bun.$`mkdir -p ${binDir}`.quiet();
		await writeFakeBinary(src, "ok", "new");
		await writeFakeBinary(current, "ok", "current");
		const result = await bash(
			`
			source "${libSh}"
			swap_gpio_companion_bin "${src}"
			`,
			{ GPIO_COMPANION_BIN_DIR: binDir },
		);
		expect(result.exit).toBe(0);
		expect(result.stderr).not.toContain("smoke test");
		const swapped = await Bun.file(current).text();
		const backup = await Bun.file(
			join(binDir, "gpio-companion.bak-previous"),
		).text();
		expect(swapped).toBe(await Bun.file(src).text());
		expect(backup).not.toBe(await Bun.file(src).text());
		const leftovers = await Array.fromAsync(
			new Bun.Glob(".gpio-companion.*").scan({ cwd: binDir }),
		);
		expect(leftovers).toEqual([]);
	});

	test("refuses a binary that fails the --version smoke test and keeps the current one", async () => {
		const dir = await tempDir();
		const binDir = join(dir, "bin");
		const src = join(dir, "src-broken");
		const current = join(binDir, "gpio-companion");
		await Bun.$`mkdir -p ${binDir}`.quiet();
		await writeFakeBinary(src, "fail");
		await writeFakeBinary(current, "ok");
		const before = await Bun.file(current).text();
		const result = await bash(
			`
			source "${libSh}"
			swap_gpio_companion_bin "${src}"
			`,
			{ GPIO_COMPANION_BIN_DIR: binDir },
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr).toContain("--version smoke test");
		expect(await Bun.file(current).text()).toBe(before);
		const backupExists = await Bun.file(
			join(binDir, "gpio-companion.bak-previous"),
		).exists();
		expect(backupExists).toBeFalse();
		const leftovers = await Array.fromAsync(
			new Bun.Glob(".gpio-companion.*").scan({ cwd: binDir }),
		);
		expect(leftovers).toEqual([]);
	});

	test("installs without a backup when no healthy current binary exists", async () => {
		const dir = await tempDir();
		const binDir = join(dir, "bin");
		const src = join(dir, "src-new");
		const target = join(binDir, "gpio-companion");
		await Bun.$`mkdir -p ${binDir}`.quiet();
		await writeFakeBinary(src, "ok");
		await Bun.write(target, "corrupt-garbage");
		await Bun.$`chmod 0644 ${target}`.quiet();
		const result = await bash(
			`
			source "${libSh}"
			swap_gpio_companion_bin "${src}"
			`,
			{ GPIO_COMPANION_BIN_DIR: binDir },
		);
		expect(result.exit).toBe(0);
		expect(await Bun.file(target).text()).toBe(await Bun.file(src).text());
		const backupExists = await Bun.file(
			join(binDir, "gpio-companion.bak-previous"),
		).exists();
		expect(backupExists).toBeFalse();
	});

	test("rotates the backup on each healthy swap", async () => {
		const dir = await tempDir();
		const binDir = join(dir, "bin");
		const srcA = join(dir, "src-a");
		const srcB = join(dir, "src-b");
		const target = join(binDir, "gpio-companion");
		const backup = join(binDir, "gpio-companion.bak-previous");
		await Bun.$`mkdir -p ${binDir}`.quiet();
		await writeFakeBinary(srcA, "ok");
		await writeFakeBinary(srcB, "ok");
		const result = await bash(
			`
			source "${libSh}"
			swap_gpio_companion_bin "${srcA}"
			cp -p "${srcA}" "${dir}/first-installed"
			swap_gpio_companion_bin "${srcB}"
			`,
			{ GPIO_COMPANION_BIN_DIR: binDir },
		);
		expect(result.exit).toBe(0);
		expect(await Bun.file(target).text()).toBe(await Bun.file(srcB).text());
		expect(await Bun.file(backup).text()).toBe(await Bun.file(srcA).text());
	});
});

describe("gpio_build_mem_available", () => {
	test("fails when MemAvailable is below the minimum", async () => {
		const result = await bash(
			`
			source "${libSh}"
			if gpio_build_mem_available; then echo OK; else echo LOW; fi
			`,
			{ GPIO_COMPANION_BUILD_MIN_MEM_KB: "999999999" },
		);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim()).toBe("LOW");
	});

	test("passes when MemAvailable is above the minimum", async () => {
		const result = await bash(
			`
			source "${libSh}"
			if gpio_build_mem_available; then echo OK; else echo LOW; fi
			`,
			{ GPIO_COMPANION_BUILD_MIN_MEM_KB: "0" },
		);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim()).toBe("OK");
	});
});
