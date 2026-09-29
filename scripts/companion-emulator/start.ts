import { chmodSync, mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDeviceKeyPair } from "../../packages/core/src/index.ts";
import { census, leftoverLabels } from "./census.ts";
import type { CompanionClient } from "./client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const STUBS = join(HERE, "stubs");
const SERVE = join(REPO, "binary/gpio-companion/src/index.ts");
const STUB_NAMES = [
	"gpioset",
	"gpioget",
	"gpioinfo",
	"gpio-pwm",
	"gcc",
	"arduino-cli",
	"stty",
	"systemctl",
	"nmcli",
	"python3",
	"sudo",
	"gpio",
];

export type CompanionHandle = {
	pid: number;
	port: number;
	url: string;
	root: string;
	client: CompanionClient;
	proc: ReturnType<typeof Bun.spawn>;
	logs: string[];
	stop(): Promise<void>;
};

export async function startCompanion(): Promise<CompanionHandle> {
	const root = await mkdtemp(join(tmpdir(), "gpio-emu-"));
	mkdirSync(join(root, "alive"), { recursive: true });
	mkdirSync(join(root, "lines"), { recursive: true });
	const keys = await generateDeviceKeyPair();
	const port = 21000 + Math.floor(Math.random() * 10000);
	await Bun.write(
		join(root, "config.json"),
		`${JSON.stringify(
			{
				hardware: "raspberrypi",
				tunnel: {
					token: "",
					hostname: "",
					apiHostname: "api-emu.gpio-companion.com",
					tunnelId: "emu",
				},
			},
			null,
			"\t",
		)}\n`,
	);
	await Bun.write(
		join(root, "device-auth.json"),
		`${JSON.stringify(
			{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
			null,
			"\t",
		)}\n`,
	);
	await Bun.write(join(root, "ble-gatt-server.py"), "print('emu ble')\n");
	const projectsDir = join(root, "projects");
	mkdirSync(join(projectsDir, "blink-led", "breadboard"), { recursive: true });
	await Bun.write(
		join(projectsDir, "blink-led", "breadboard", "diagram.json"),
		`${JSON.stringify({
			version: 1,
			parts: [
				{ id: "bb1", type: "wokwi-breadboard-half" },
				{
					id: "header",
					type: "gpio-companion-header",
					attrs: { hardware: "raspberrypi" },
				},
				{ id: "led1", type: "wokwi-led" },
			],
			connections: [
				["header:13", "bb1:12a", "orange", []],
				["header:15", "bb1:12e", "orange", []],
				["header:11", "bb1:10a", "yellow", []],
				["led1:A", "bb1:10e", "green", []],
			],
		})}\n`,
	);
	for (const name of STUB_NAMES) {
		chmodSync(join(STUBS, name), 0o755);
	}
	chmodSync(join(STUBS, "_common.sh"), 0o755);
	const uuid = "11111111-1111-4111-8111-111111111111";
	const key = "emu-pairing-key";
	const realPython = Bun.which("python3") ?? "";
	const logs: string[] = [];
	const proc = Bun.spawn(["bun", SERVE, "serve"], {
		cwd: REPO,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			PATH: `${STUBS}:${process.env.PATH ?? ""}`,
			GPIO_EMU_ROOT: root,
			GPIO_EMU_STUBS: STUBS,
			GPIO_EMU_REAL_PYTHON: realPython,
			GPIO_USER: userInfo().username,
			GPIO_COMPANION_HARDWARE: "raspberrypi",
			GPIO_COMPANION_PORT: String(port),
			GPIO_COMPANION_CONFIG: join(root, "config.json"),
			GPIO_COMPANION_SECRETS: join(root, "secrets.env"),
			GPIO_COMPANION_PAIRING: join(root, "pairing.json"),
			GPIO_COMPANION_PAIRING_UUID: uuid,
			GPIO_COMPANION_PAIRING_KEY: key,
			GPIO_COMPANION_DEVICE_AUTH: join(root, "device-auth.json"),
			GPIO_COMPANION_CLOCK_STAMP: join(root, "clock"),
			GPIO_COMPANION_NONCES: join(root, "nonces.json"),
			GPIO_COMPANION_TUNNEL_ENV: join(root, "cloudflared.env"),
			GPIO_COMPANION_PWM: join(STUBS, "gpio-pwm"),
			GPIO_COMPANION_BLE: "1",
			GPIO_COMPANION_BLE_SCRIPT: join(root, "ble-gatt-server.py"),
			GPIO_COMPANION_HUB: "0",
			GPIO_COMPANION_PROJECT_SYNC: "0",
			GPIO_COMPANION_PROJECTS_DIR: projectsDir,
			GPIO_COMPANION_DASHBOARD_URL: "https://gpio-companion.com",
		},
	});
	const url = `http://127.0.0.1:${port}/`;
	void collectLogs(proc, logs);
	try {
		await waitHealthy(url);
	} catch (error) {
		proc.kill("SIGKILL");
		throw new Error(
			`${error instanceof Error ? error.message : "start failed"}\n${logs.join("")}`,
		);
	}
	const pid = proc.pid;
	if (!pid) {
		proc.kill("SIGKILL");
		throw new Error("companion pid missing");
	}
	return {
		pid,
		port,
		url,
		root,
		client: { url, keys },
		proc,
		async stop() {
			proc.kill("SIGTERM");
			const done = await Promise.race([
				proc.exited.then(() => true),
				Bun.sleep(15_000).then(() => false),
			]);
			if (!done) {
				proc.kill("SIGKILL");
				await proc.exited.catch(() => undefined);
			}
		},
		logs,
	};
}

async function collectLogs(
	proc: ReturnType<typeof Bun.spawn>,
	logs: string[],
): Promise<void> {
	const decoder = new TextDecoder();
	async function read(stream: ReadableStream<Uint8Array> | number | undefined) {
		if (!stream || typeof stream === "number") {
			return;
		}
		const reader = stream.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			logs.push(decoder.decode(value, { stream: true }));
		}
	}
	await Promise.all([read(proc.stdout), read(proc.stderr)]);
}

export function assertClean(pid: number, root: string, when: string): void {
	const snapshot = census(pid, root);
	const leftovers = leftoverLabels(snapshot);
	if (snapshot.zombies.length || leftovers.length) {
		throw new Error(
			`${when}: leftovers ${leftovers.join(",") || "none"} zombies=${snapshot.zombies.length}`,
		);
	}
}

async function waitHealthy(url: string, timeoutMs = 15_000): Promise<void> {
	const started = Date.now();
	let last = "";
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`${url}health`);
			if (response.ok) {
				return;
			}
			last = `${response.status}`;
		} catch (caught) {
			last = caught instanceof Error ? caught.message : "fetch failed";
		}
		await Bun.sleep(50);
	}
	throw new Error(`companion did not start: ${last}`);
}
