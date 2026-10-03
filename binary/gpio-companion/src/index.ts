import { existsSync, readFileSync } from "node:fs";
import {
	DEFAULT_DEVICE_KEY_ID,
	type HardwareId,
	isHardwareId,
	type ProjectSyncPut,
	parseDeviceConfig,
	publicDeviceUrl,
	VERSION,
} from "gpio-companion";
import { createArduinoProxy, watchUsbSerialPorts } from "./arduino-proxy.ts";
import { startBleBridge } from "./ble.ts";
import {
	fetchGithubCredentials,
	loadGithubCreds,
	persistGithubLogin,
	runGitCredentialHelper,
} from "./github-credentials.ts";
import { createLibgpiodGpio } from "./gpio.ts";
import { startHubClient } from "./hub-client.ts";
import { revokeOpencodeAccess } from "./opencode-proxy.ts";
import { DEFAULT_PAIRING_PATH, filePairingStore } from "./pairing.ts";
import { profileSyncMessage, syncProfile } from "./profile-sync.ts";
import {
	projectsRoot,
	pushProject,
	removeProject,
	syncProjects,
} from "./projects.ts";
import { DEFAULT_SECRETS_PATH, fileSecretsStore } from "./secrets.ts";
import { startDeviceApi } from "./serve.ts";
import {
	DEFAULT_CLOCK_STAMP_PATH,
	DEFAULT_CONFIG_PATH,
	DEFAULT_DEVICE_AUTH_PATH,
	DEFAULT_NONCE_PATH,
	DEFAULT_PORT,
	DEFAULT_TUNNEL_ENV_PATH,
	fileConfigStore,
} from "./store.ts";
import { applyCloudflaredReplica } from "./tunnel.ts";
import { applySystemdUpdate } from "./update.ts";
import { applyNetworkManagerWifi } from "./wifi.ts";

const command = process.argv[2] ?? "serve";

if (command === "version" || command === "-v" || command === "--version") {
	console.log(VERSION);
	process.exit(0);
}

if (command === "git-credential" || command === "github-token") {
	const pairingUuid = process.env.GPIO_COMPANION_PAIRING_UUID ?? "";
	const pairingKey = process.env.GPIO_COMPANION_PAIRING_KEY ?? "";
	const port = Number(process.env.GPIO_COMPANION_PORT ?? DEFAULT_PORT);
	try {
		if (command === "github-token") {
			const creds = await loadGithubCreds(pairingUuid, pairingKey, port);
			process.stdout.write(`${creds.token}\n`);
			process.exit(0);
		}
		const output = await runGitCredentialHelper(
			process.argv[3] ?? "get",
			await Bun.stdin.text(),
			{ uuid: pairingUuid, key: pairingKey },
		);
		process.stdout.write(output);
		process.exit(0);
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : "github failed";
		console.error(message);
		process.exit(1);
	}
}

const LOCAL_COMMANDS = new Set([
	"sketch",
	"run",
	"flash",
	"gpio",
	"proxy",
	"verify",
	"console",
	"ui",
	"app",
	"status",
	"health",
	"help",
	"--help",
	"-h",
]);

if (LOCAL_COMMANDS.has(command)) {
	const { run } = await import("./cli.ts");
	const code = await run(process.argv.slice(2), {
		cwd: process.cwd(),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
	});
	process.exit(code);
}

if (command !== "serve") {
	console.error(
		"usage: gpio-companion serve | version | git-credential | github-token | sketch | flash | gpio | proxy | verify | console | ui | app | status | health",
	);
	process.exit(1);
}

const hardware = readHardware();
const configPath = process.env.GPIO_COMPANION_CONFIG ?? DEFAULT_CONFIG_PATH;
const envPath =
	process.env.GPIO_COMPANION_TUNNEL_ENV ?? DEFAULT_TUNNEL_ENV_PATH;
const secretsPath = process.env.GPIO_COMPANION_SECRETS ?? DEFAULT_SECRETS_PATH;
const pairingPath = process.env.GPIO_COMPANION_PAIRING ?? DEFAULT_PAIRING_PATH;
const pairingUuid = process.env.GPIO_COMPANION_PAIRING_UUID ?? "";
const pairingKey = process.env.GPIO_COMPANION_PAIRING_KEY ?? "";
const port = Number(process.env.GPIO_COMPANION_PORT ?? DEFAULT_PORT);
const secrets = fileSecretsStore(secretsPath);
const pairing = filePairingStore(pairingPath, pairingUuid, pairingKey);

const deviceAuth = loadDeviceAuth();

const gpio = createLibgpiodGpio();
const proxy = createArduinoProxy();
const githubCredentials = async () => {
	const state = await pairing.read();
	const creds = await fetchGithubCredentials({
		uuid: state.uuid || pairingUuid,
		key: state.key || pairingKey,
	});
	await persistGithubLogin(secrets, creds);
	return creds;
};
const PROJECT_SYNC_MS = 15 * 60 * 1000;
const projectSyncEnabled = process.env.GPIO_COMPANION_PROJECT_SYNC !== "0";
const profileSyncEnabled = process.env.GPIO_COMPANION_PROFILE_SYNC !== "0";
const configStore = fileConfigStore(configPath, hardware);
const hubEnabled = process.env.GPIO_COMPANION_HUB !== "0";
const timers: Array<
	ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>
> = [];

async function syncGithubProjects(target: ProjectSyncPut = {}): Promise<void> {
	try {
		await syncProjects(
			{
				destRoot: projectsRoot(),
				token: async () => (await githubCredentials()).token,
			},
			target,
		);
	} catch (caught) {
		const message =
			caught instanceof Error ? caught.message : "projects sync failed";
		console.error(`gpio-companion projects sync: ${message}`);
	}
}

async function syncDashboardProfile(): Promise<void> {
	try {
		await syncProfile({
			store: configStore,
			uuid: (await pairing.read()).uuid || pairingUuid,
			key: (await pairing.read()).key || pairingKey,
		});
	} catch (caught) {
		console.error(`gpio-companion profile sync: ${profileSyncMessage(caught)}`);
	}
}

const server = startDeviceApi({
	port,
	store: configStore,
	secrets,
	pairing,
	applyTunnel: applyCloudflaredReplica(envPath),
	applyWifi: applyNetworkManagerWifi(),
	applyUpdate: applySystemdUpdate(),
	applyProjects: async (target) => {
		void syncGithubProjects(target);
	},
	applyProjectPush: (put) => pushProject({ destRoot: projectsRoot() }, put),
	applyProjectRemove: (put) =>
		removeProject(
			{
				destRoot: projectsRoot(),
			},
			put,
		),
	gpio,
	proxy,
	revokeOpencode: () =>
		revokeOpencodeAccess({
			envPath:
				process.env.GPIO_COMPANION_OPENCODE_SERVER_ENV ??
				"/etc/gpio-companion/opencode-server.env",
			uuid: pairingUuid,
		}),
	deviceAuth,
	githubCredentials,
	clockStampPath:
		process.env.GPIO_COMPANION_CLOCK_STAMP ?? DEFAULT_CLOCK_STAMP_PATH,
	noncePath: process.env.GPIO_COMPANION_NONCES ?? DEFAULT_NONCE_PATH,
});
if (projectSyncEnabled) {
	timers.push(
		setInterval(
			() => {
				void githubCredentials().catch(() => undefined);
			},
			30 * 60 * 1000,
		),
	);
	void syncGithubProjects();
	timers.push(
		setTimeout(() => {
			void syncGithubProjects();
		}, 30_000),
	);
	timers.push(
		setTimeout(() => {
			void syncGithubProjects();
		}, 150_000),
	);
	timers.push(
		setInterval(() => {
			void syncGithubProjects();
		}, PROJECT_SYNC_MS),
	);
}
if (profileSyncEnabled) {
	void syncDashboardProfile();
	timers.push(
		setInterval(() => {
			void syncDashboardProfile();
		}, PROJECT_SYNC_MS),
	);
}

const ble = startBleBridge({
	pairingUuid,
	hardware,
	port: server.port ?? 4150,
	deviceUrl: readDeviceUrl(configPath),
});
const { run, flash } = server;
const hub = hubEnabled
	? startHubClient({
			uuid: pairingUuid,
			key: pairingKey,
			flash,
			run,
			proxy,
		})
	: { stop() {} };
void proxy.probe();
const stopUsbWatch = watchUsbSerialPorts(() => {
	void proxy.probe();
});

console.log(
	`gpio-companion device API on http://${server.hostname}:${server.port}`,
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	for (const timer of timers) {
		clearInterval(timer);
		clearTimeout(timer);
	}
	timers.length = 0;
	stopUsbWatch();
	hub.stop();
	run.stop();
	server.app.stop();
	proxy.release();
	await Promise.all([gpio.releaseAll?.() ?? Promise.resolve(), ble.stop()]);
	try {
		server.stop(true);
	} catch {
		undefined;
	}
	await reapChildren(process.pid);
	process.exit(signal === "SIGKILL" ? 1 : 0);
}

async function reapChildren(pid: number): Promise<void> {
	await Bun.spawn(["pkill", "-TERM", "-P", String(pid)], {
		stdout: "ignore",
		stderr: "ignore",
	}).exited.catch(() => undefined);
	await Bun.sleep(200);
	await Bun.spawn(["pkill", "-KILL", "-P", String(pid)], {
		stdout: "ignore",
		stderr: "ignore",
	}).exited.catch(() => undefined);
}

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGHUP", () => {
	undefined;
});

function loadDeviceAuth(): { keyId: string; publicKeyPem: string } {
	const authPath =
		process.env.GPIO_COMPANION_DEVICE_AUTH ?? DEFAULT_DEVICE_AUTH_PATH;
	let keyId = process.env.GPIO_COMPANION_DEVICE_KEY_ID ?? DEFAULT_DEVICE_KEY_ID;
	let publicKeyPem = process.env.GPIO_COMPANION_DEVICE_PUBLIC_KEY ?? "";
	if (existsSync(authPath)) {
		try {
			const parsed = JSON.parse(readFileSync(authPath, "utf8")) as {
				keyId?: unknown;
				publicKeyPem?: unknown;
			};
			if (!process.env.GPIO_COMPANION_DEVICE_KEY_ID) {
				if (typeof parsed.keyId === "string" && parsed.keyId.trim()) {
					keyId = parsed.keyId.trim();
				}
			}
			if (!process.env.GPIO_COMPANION_DEVICE_PUBLIC_KEY) {
				if (
					typeof parsed.publicKeyPem === "string" &&
					parsed.publicKeyPem.trim()
				) {
					publicKeyPem = parsed.publicKeyPem;
				}
			}
		} catch {
			// keep env / defaults
		}
	}
	return { keyId, publicKeyPem };
}

function readDeviceUrl(path: string): string {
	if (!existsSync(path)) {
		return "";
	}
	try {
		return publicDeviceUrl(
			parseDeviceConfig(JSON.parse(readFileSync(path, "utf8"))).tunnel
				.apiHostname,
		);
	} catch {
		return "";
	}
}

function readHardware(): HardwareId {
	const value = process.env.GPIO_COMPANION_HARDWARE ?? "raspberrypi";
	if (!isHardwareId(value)) {
		console.error(`invalid GPIO_COMPANION_HARDWARE: ${value}`);
		process.exit(1);
	}
	return value;
}
