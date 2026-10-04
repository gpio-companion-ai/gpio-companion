import { connect } from "node:net";

const home = Bun.env.HOME ?? "";
const javaHome = Bun.env.JAVA_HOME || `${home}/.local/jdk`;
const androidHome =
	Bun.env.ANDROID_HOME || Bun.env.ANDROID_SDK_ROOT || `${home}/Android/sdk`;
const adbBin = `${androidHome}/platform-tools/adb`;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const expoBin = `${root}/node_modules/.bin/expo`;
const phoneHost = "100.96.0.1";
const metroPort = 1111;
const stateFile = `${root}/.expo/adb-phone.txt`;
const noAvd = `${root}/.expo/no-avd`;
const knownPorts = [43663, 38779, 38101, 5555];

const envBase = {
	...Bun.env,
	JAVA_HOME: javaHome,
	ANDROID_HOME: androidHome,
	ANDROID_SDK_ROOT: androidHome,
	PATH: `${javaHome}/bin:${androidHome}/platform-tools:${androidHome}/emulator:${Bun.env.PATH ?? ""}`,
};

type Device = { serial: string; state: string; model?: string };

function parseArgs(argv: string[]): { run: boolean; connectOnly: boolean } {
	return {
		run: argv.includes("--run"),
		connectOnly: argv.includes("--connect-only"),
	};
}

async function capture(cmd: string[]): Promise<{ code: number; out: string }> {
	const proc = Bun.spawn(cmd, {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		env: envBase,
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out: `${out}\n${err}` };
}

async function devices(): Promise<Device[]> {
	const { out } = await capture([adbBin, "devices", "-l"]);
	const rows: Device[] = [];
	for (const line of out.split("\n")) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 2 || parts[0] === "List") continue;
		const model = parts
			.find((part) => part.startsWith("model:"))
			?.slice("model:".length);
		rows.push({ serial: parts[0], state: parts[1], model });
	}
	return rows;
}

async function ping(host: string): Promise<boolean> {
	const proc = Bun.spawn(["ping", "-c", "1", "-W", "2", host], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

function probe(host: string, port: number, ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const done = (ok: boolean) => {
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(ms);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

async function scanPorts(host: string): Promise<number[]> {
	const ports = [...knownPorts];
	for (let port = 30000; port <= 65535; port++) ports.push(port);
	const open: number[] = [];
	const queue = ports.filter((port, index) => ports.indexOf(port) === index);
	let cursor = 0;
	async function worker(): Promise<void> {
		while (cursor < queue.length) {
			const port = queue[cursor++];
			if (await probe(host, port, 200)) open.push(port);
		}
	}
	await Promise.all(Array.from({ length: 200 }, () => worker()));
	return open.sort((a, b) => a - b);
}

async function remember(serial: string): Promise<void> {
	await Bun.write(stateFile, `${serial}\n`);
}

async function connectSpec(spec: string): Promise<Device | undefined> {
	await capture(["timeout", "3", adbBin, "connect", spec]);
	await Bun.sleep(400);
	const list = await devices();
	return list.find(
		(device) => device.serial === spec && device.state === "device",
	);
}

async function connectPhone(): Promise<Device | undefined> {
	if (!(await ping(phoneHost))) return undefined;
	const saved = await Bun.file(stateFile)
		.text()
		.then((text) => text.trim())
		.catch(() => "");
	const specs = [
		Bun.env.ADB_CONNECT,
		saved,
		...knownPorts.map((port) => `${phoneHost}:${port}`),
	].filter(
		(spec): spec is string => !!spec && spec.startsWith(`${phoneHost}:`),
	);
	for (const spec of [...new Set(specs)]) {
		const hit = await connectSpec(spec);
		if (hit) {
			await remember(hit.serial);
			return hit;
		}
	}
	const mdns = await capture([adbBin, "mdns", "services"]);
	for (const match of mdns.out.matchAll(/(\d+\.\d+\.\d+\.\d+:\d+)/g)) {
		if (!match[1].startsWith(`${phoneHost}:`)) continue;
		const hit = await connectSpec(match[1]);
		if (hit) {
			await remember(hit.serial);
			return hit;
		}
	}
	for (const port of await scanPorts(phoneHost)) {
		const hit = await connectSpec(`${phoneHost}:${port}`);
		if (hit) {
			await remember(hit.serial);
			return hit;
		}
	}
	return undefined;
}

async function warpHost(): Promise<string> {
	if (Bun.env.REACT_NATIVE_PACKAGER_HOSTNAME)
		return Bun.env.REACT_NATIVE_PACKAGER_HOSTNAME;
	const { out } = await capture([
		"ip",
		"-4",
		"-o",
		"addr",
		"show",
		"CloudflareWARP",
	]);
	const match = out.match(/inet (\d+\.\d+\.\d+\.\d+)/);
	return match?.[1] ?? "100.96.0.3";
}

async function launch(serial: string, host: string): Promise<void> {
	const url = `gpio-companion://expo-development-client/?url=${encodeURIComponent(`http://${host}:${metroPort}`)}`;
	const view = await capture([
		adbBin,
		"-s",
		serial,
		"shell",
		"am",
		"start",
		"-a",
		"android.intent.action.VIEW",
		"-d",
		url,
	]);
	if (view.code === 0) return;
	await capture([
		adbBin,
		"-s",
		serial,
		"shell",
		"am",
		"start",
		"-n",
		"com.gpiocompanion.app/.MainActivity",
	]);
}

async function waitForPort(port: number): Promise<void> {
	for (let i = 0; i < 120; i++) {
		if (await probe("127.0.0.1", port, 200)) return;
		await Bun.sleep(500);
	}
}

const args = parseArgs(Bun.argv.slice(2));
const phone = await connectPhone();
const host = await warpHost();
if (!phone) {
	console.error(`no device at ${phoneHost}; not opening emulator gpio_api36`);
	if (args.connectOnly || args.run) process.exit(1);
} else {
	console.log(
		`android target ${phone.serial} (${phone.model ?? "phone"}), not gpio_api36`,
	);
}
if (args.connectOnly) process.exit(phone ? 0 : 1);

await Bun.write(`${noAvd}/.keep`, "");
const env = {
	...envBase,
	ANDROID_AVD_HOME: noAvd,
	REACT_NATIVE_PACKAGER_HOSTNAME: host,
	...(phone ? { ANDROID_SERIAL: phone.serial } : {}),
};
const cmd = args.run
	? [
			expoBin,
			"run:android",
			"--port",
			String(metroPort),
			"--device",
			phone?.model ?? phoneHost,
		]
	: [expoBin, "start", "--dev-client", "--port", String(metroPort)];

if (args.run && !phone?.model) {
	console.error(`connected phone has no model name; refusing gpio_api36`);
	process.exit(1);
}

const proc = Bun.spawn(cmd, {
	cwd: root,
	env,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

if (!args.run && phone) {
	await waitForPort(metroPort);
	await launch(phone.serial, host);
}

process.exit(await proc.exited);
