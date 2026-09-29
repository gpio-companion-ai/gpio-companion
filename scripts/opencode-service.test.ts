import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const libSh = join(import.meta.dir, "lib.sh");
const tunnelScript = join(import.meta.dir, "create-cloudflare-tunnel.py");
const dirs: string[] = [];

async function tempDir() {
	const dir = await mkdtemp(join(tmpdir(), "gpio-oc-unit-"));
	dirs.push(dir);
	return dir;
}

async function bash(script: string, env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bash", "-ec", script], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...env },
	});
	const [stdout, stderr, exit] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exit };
}

afterAll(async () => {
	await Promise.all(
		dirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("opencode user service", () => {
	test("installs a loopback unit from the GPIO home and mints a private password", async () => {
		const dir = await tempDir();
		const bin = join(dir, "bin");
		const home = join(dir, "home");
		const bindir = join(dir, "usr-local-bin");
		const config = join(dir, "config");
		await mkdir(bin, { recursive: true });
		await mkdir(bindir, { recursive: true });
		await mkdir(join(home, ".opencode", "bin"), { recursive: true });
		const real = join(home, ".opencode", "bin", "opencode");
		await writeFile(real, "#!/bin/sh\nexit 0\n");
		await chmod(real, 0o755);
		await writeFile(
			join(bin, "loginctl"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$GPIO_OC_LOGIN_LOG"
exit 0
`,
		);
		await writeFile(
			join(bin, "systemctl"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$GPIO_OC_SYS_LOG"
exit 0
`,
		);
		await chmod(join(bin, "loginctl"), 0o755);
		await chmod(join(bin, "systemctl"), 0o755);
		const loginLog = join(dir, "loginctl.log");
		const sysLog = join(dir, "systemctl.log");
		const user = process.env.USER || "root";
		const result = await bash(
			`
PATH="${bin}:$PATH"
source "${libSh}"
GPIO_USER="${user}"
unset GPIO_COMPANION_T3_SKIP_RESTART
install_opencode_service
`,
			{
				GPIO_COMPANION_HOME: home,
				GPIO_COMPANION_BIN_DIR: bindir,
				GPIO_COMPANION_CONFIG_DIR: config,
				GPIO_COMPANION_T3_USER_WAIT_ATTEMPTS: "0",
				GPIO_OC_LOGIN_LOG: loginLog,
				GPIO_OC_SYS_LOG: sysLog,
			},
		);
		expect(result.exit).toBe(0);
		expect(result.stderr).toBe("");
		const unit = await Bun.file(
			join(home, ".config/systemd/user/gpio-opencode.service"),
		).text();
		expect(unit).toContain("serve --hostname 127.0.0.1 --port 4096");
		expect(unit).not.toContain("0.0.0.0");
		expect(unit).not.toContain("--cors");
		expect(unit).not.toContain("--mdns");
		expect(unit).not.toContain("OPENCODE_SERVER_PASSWORD=");
		expect(unit).toContain(`EnvironmentFile=-${config}/opencode-server.env`);
		const secret = await Bun.file(join(config, "opencode-server.env")).text();
		expect(secret).toContain("OPENCODE_SERVER_USERNAME=opencode");
		expect(secret).toMatch(/OPENCODE_SERVER_PASSWORD=[0-9a-f]{64}/);
		expect(result.stdout).not.toContain(secret.split("\n")[1]);
		expect(result.stderr).not.toContain("OPENCODE_SERVER_PASSWORD=");
		const mode = await bash(
			`stat -c %a "${join(config, "opencode-server.env")}"`,
		);
		expect(mode.stdout.trim()).toBe("600");
		expect(await Bun.file(loginLog).text()).toContain(`enable-linger ${user}`);
		const sys = await Bun.file(sysLog).text();
		expect(sys).toContain(`start user@`);
		expect(sys).toContain("--user daemon-reload");
		expect(sys).toContain("--user enable --now gpio-opencode.service");
		expect(sys).not.toContain("t3");
	});

	test("upgrade restarts the unit once and reaps a leaked serve", async () => {
		const dir = await tempDir();
		const bin = join(dir, "bin");
		const home = join(dir, "home");
		const unitDir = join(home, ".config/systemd/user");
		await mkdir(bin, { recursive: true });
		await mkdir(unitDir, { recursive: true });
		await mkdir(join(home, ".opencode/bin"), { recursive: true });
		const real = join(home, ".opencode/bin/opencode");
		const log = join(dir, "oc.log");
		await writeFile(
			real,
			`#!/bin/sh
printf '%s\\n' "$*" >> "$GPIO_OC_LOG"
exit 0
`,
		);
		await chmod(real, 0o755);
		await writeFile(join(unitDir, "gpio-opencode.service"), "[Service]\n");
		await writeFile(join(bin, "loginctl"), "#!/bin/sh\nexit 0\n");
		await writeFile(
			join(bin, "systemctl"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$GPIO_OC_SYS_LOG"
case "$*" in
*show*) echo 111 ;;
esac
exit 0
`,
		);
		await writeFile(join(bin, "pgrep"), "#!/bin/sh\necho 111\necho 222\n");
		await writeFile(
			join(bin, "ps"),
			`#!/bin/sh
case "$*" in
*111*) echo 5 ;;
*) echo 9 ;;
esac
`,
		);
		for (const name of ["loginctl", "systemctl", "pgrep", "ps"]) {
			await chmod(join(bin, name), 0o755);
		}
		const sysLog = join(dir, "systemctl.log");
		const user = process.env.USER || "root";
		const result = await bash(
			`
PATH="${bin}:/usr/bin:/bin"
source "${libSh}"
GPIO_USER="${user}"
unset GPIO_COMPANION_T3_SKIP_RESTART
unset GPIO_COMPANION_OPENCODE_SKIP_RESTART
update_opencode
reap_leaked_opencode_servers
`,
			{
				GPIO_COMPANION_HOME: home,
				GPIO_COMPANION_BIN_DIR: join(dir, "usr-local-bin"),
				GPIO_COMPANION_T3_USER_WAIT_ATTEMPTS: "0",
				GPIO_OC_LOG: log,
				GPIO_OC_SYS_LOG: sysLog,
			},
		);
		expect(result.exit).toBe(0);
		expect(await Bun.file(log).text()).toContain("upgrade");
		const sys = await Bun.file(sysLog).text();
		expect(sys).toContain("--user restart gpio-opencode.service");
		expect(sys.match(/restart gpio-opencode\.service/g)?.length).toBe(1);
		expect(result.stderr).toContain("stopping leaked opencode pid 222");
		expect(result.stderr).not.toContain("stopping leaked opencode pid 111");
	});

	test("does not publish a public code hostname or port 4096", async () => {
		const tunnel = await Bun.file(tunnelScript).text();
		expect(tunnel).not.toContain("code-");
		expect(tunnel).not.toContain("4096");
		expect(tunnel).toContain("127.0.0.1:4150");
		expect(tunnel).not.toContain("127.0.0.1:3773");
		expect(tunnel).not.toContain("t3-");
	});
});
