import { afterAll, describe, expect, test } from "bun:test";
import {
	lstat,
	mkdir,
	mkdtemp,
	readlink,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "storage-link.sh");
const dirs: string[] = [];

async function tempDir() {
	const dir = await mkdtemp(join(tmpdir(), "gpio-storage-"));
	dirs.push(dir);
	return dir;
}

async function bash(body: string, env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bash", "-ec", body], {
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

function sourcePrelude(dir: string, extra = "") {
	return `
GPIO_STORAGE_HOME="${dir}/home"
GPIO_STORAGE_MEDIA_ROOT="${dir}/media"
GPIO_STORAGE_STATE_DIR="${dir}/state"
GPIO_STORAGE_MOUNTS_FILE="${dir}/mounts"
GPIO_STORAGE_SKIP_MOUNT=1
GPIO_STORAGE_SKIP_CHOWN=1
GPIO_USER=root
mkdir -p "${dir}/home" "${dir}/media" "${dir}/state"
[[ -f "${dir}/mounts" ]] || : > "${dir}/mounts"
${extra}
source "${script}"
`;
}

afterAll(async () => {
	await Promise.all(
		dirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("storage-link", () => {
	test("sanitizes labels", async () => {
		const result = await bash(`
source "${script}"
storage_sanitize "My Stick!"
storage_sanitize ""
storage_sanitize "---"
storage_sanitize "abcdefghijklmnopqrstuvwxyz0123456789-EXTRA"
`);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim().split("\n")).toEqual([
			"My-Stick",
			"disk",
			"disk",
			"abcdefghijklmnopqrstuvwxyz0123456789-EXT",
		]);
	});

	test("skips the boot and root disk", async () => {
		const dir = await tempDir();
		await writeFile(
			join(dir, "mounts"),
			"/dev/mmcblk0p2 / ext4 rw 0 0\n/dev/mmcblk0p1 /boot vfat rw 0 0\n",
		);
		const result = await bash(
			`
${sourcePrelude(dir)}
if storage_is_system mmcblk0p2; then echo root-yes; else echo root-no; fi
if storage_is_system mmcblk0p1; then echo boot-yes; else echo boot-no; fi
if storage_is_system mmcblk1p1; then echo sd-yes; else echo sd-no; fi
if storage_is_system sda1; then echo usb-yes; else echo usb-no; fi
if storage_is_system mmcblk0boot0; then echo eboot-yes; else echo eboot-no; fi
`,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("root-yes");
		expect(result.stdout).toContain("boot-yes");
		expect(result.stdout).toContain("sd-no");
		expect(result.stdout).toContain("usb-no");
		expect(result.stdout).toContain("eboot-yes");
	});

	test("skips USB that holds /", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "mounts"), "/dev/sda2 / ext4 rw 0 0\n");
		const result = await bash(`
${sourcePrelude(dir)}
if storage_is_system sda1; then echo yes; else echo no; fi
`);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim()).toBe("yes");
	});

	test("creates ~/storage/<label> on add", async () => {
		const dir = await tempDir();
		const result = await bash(
			`
${sourcePrelude(dir, "GPIO_STORAGE_LABEL=BACKUP")}
storage_add sda1
readlink -f "${dir}/home/storage/BACKUP"
test -f "${dir}/state/sda1"
`,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim()).toBe(join(dir, "media/BACKUP"));
		const st = await lstat(join(dir, "home/storage/BACKUP"));
		expect(st.isSymbolicLink()).toBe(true);
		expect(await readlink(join(dir, "home/storage/BACKUP"))).toBe(
			join(dir, "media/BACKUP"),
		);
	});

	test("suffixes colliding labels", async () => {
		const dir = await tempDir();
		await mkdir(join(dir, "home/storage"), { recursive: true });
		await writeFile(join(dir, "home/storage/BACKUP"), "taken");
		const result = await bash(
			`
${sourcePrelude(dir, "GPIO_STORAGE_LABEL=BACKUP")}
storage_add sda1
readlink "${dir}/home/storage/BACKUP-2"
`,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout.trim()).toBe(join(dir, "media/BACKUP-2"));
	});

	test("remove drops the symlink and state", async () => {
		const dir = await tempDir();
		const result = await bash(
			`
${sourcePrelude(dir, "GPIO_STORAGE_LABEL=USB-KEY")}
storage_add sda1
storage_remove sda1
if [[ -e "${dir}/home/storage/USB-KEY" ]]; then echo still; else echo gone; fi
if [[ -e "${dir}/state/sda1" ]]; then echo state; else echo no-state; fi
if [[ -d "${dir}/media/USB-KEY" ]]; then echo media; else echo no-media; fi
`,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("gone");
		expect(result.stdout).toContain("no-state");
		expect(result.stdout).toContain("no-media");
	});

	test("does not add the system disk", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "mounts"), "/dev/mmcblk0p2 / ext4 rw 0 0\n");
		const result = await bash(
			`
${sourcePrelude(dir, "GPIO_STORAGE_LABEL=ROOT")}
storage_add mmcblk0p2
if [[ -e "${dir}/home/storage/ROOT" ]]; then echo linked; else echo skipped; fi
`,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("skipped");
	});
});
