const home = Bun.env.HOME ?? "";
const javaHome = Bun.env.JAVA_HOME || `${home}/.local/jdk`;
const androidHome =
	Bun.env.ANDROID_HOME || Bun.env.ANDROID_SDK_ROOT || `${home}/Android/sdk`;
const adbBin = `${androidHome}/platform-tools/adb`;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const apk = `${root}/android/app/build/outputs/apk/debug/app-debug.apk`;
const pkg = "com.gpiocompanion.app";

type Args = {
	connect?: string;
	pair?: string;
	pairCode?: string;
	skipBuild: boolean;
	noLaunch: boolean;
	help: boolean;
};

function parseArgs(argv: string[]): Args {
	const out: Args = { skipBuild: false, noLaunch: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") out.help = true;
		else if (a === "--skip-build") out.skipBuild = true;
		else if (a === "--no-launch") out.noLaunch = true;
		else if (a === "--connect") out.connect = argv[++i];
		else if (a === "--pair") {
			out.pair = argv[++i];
			out.pairCode = argv[++i];
		} else throw new Error(`unknown arg: ${a}`);
	}
	out.connect ||= Bun.env.ADB_CONNECT;
	out.pair ||= Bun.env.ADB_PAIR;
	out.pairCode ||= Bun.env.ADB_PAIR_CODE;
	return out;
}

function usage(): string {
	return [
		"Build the gpio-companion Android debug APK and install it over ADB (USB or wireless).",
		"",
		"  bun run android:push",
		"  bun run android:push -- --connect 192.168.1.20:43567",
		"  bun run android:push -- --pair 192.168.1.20:37123 123456 --connect 192.168.1.20:43567",
		"  bun run android:push -- --skip-build --connect 100.96.0.1:43663",
		"",
		"Env: ADB_CONNECT, ADB_PAIR, ADB_PAIR_CODE, JAVA_HOME, ANDROID_HOME",
		"Phone: Developer options → Wireless debugging → IP address & port",
	].join("\n");
}

async function run(
	cmd: string[],
	opts: { allowFail?: boolean } = {},
): Promise<number> {
	const proc = Bun.spawn(cmd, {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...Bun.env,
			JAVA_HOME: javaHome,
			ANDROID_HOME: androidHome,
			ANDROID_SDK_ROOT: androidHome,
			PATH: `${javaHome}/bin:${androidHome}/platform-tools:${Bun.env.PATH ?? ""}`,
		},
	});
	const code = await proc.exited;
	if (code !== 0 && !opts.allowFail)
		throw new Error(`${cmd.join(" ")} exited ${code}`);
	return code;
}

async function capture(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...Bun.env,
			PATH: `${androidHome}/platform-tools:${Bun.env.PATH ?? ""}`,
		},
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0)
		throw new Error(`${cmd.join(" ")}: ${err.trim() || out.trim() || code}`);
	return out;
}

type Device = { serial: string; state: string };

async function devices(): Promise<Device[]> {
	const out = await capture([adbBin, "devices"]);
	const rows: Device[] = [];
	for (const line of out.split("\n")) {
		const m = line.match(/^(\S+)\s+(\S+)/);
		if (!m || m[1] === "List") continue;
		rows.push({ serial: m[1], state: m[2] });
	}
	return rows;
}

async function waitForDevice(serial?: string, tries = 20): Promise<Device> {
	for (let i = 0; i < tries; i++) {
		const list = await devices();
		const hit = serial
			? list.find((d) => d.serial === serial && d.state === "device")
			: list.find((d) => d.state === "device");
		if (hit) return hit;
		const bad = serial ? list.find((d) => d.serial === serial) : list[0];
		if (bad?.state === "unauthorized") {
			throw new Error("ADB unauthorized — tap Allow on the phone");
		}
		await Bun.sleep(1000);
	}
	const list = await devices();
	throw new Error(
		`no ADB device in 'device' state. attached: ${
			list.map((d) => `${d.serial} ${d.state}`).join(", ") || "(none)"
		}\nEnable Wireless debugging, then pass --connect IP:PORT (and --pair IP:PORT CODE if first time).`,
	);
}

const args = parseArgs(Bun.argv.slice(2));
if (args.help) {
	console.log(usage());
	process.exit(0);
}

if (args.pair) {
	if (!args.pairCode)
		throw new Error("--pair needs host:port and a 6-digit code");
	await run([adbBin, "pair", args.pair, args.pairCode]);
}
if (args.connect) {
	await run([adbBin, "connect", args.connect], { allowFail: true });
}

const device = await waitForDevice(args.connect);
console.log(`using ${device.serial}`);

if (!args.skipBuild) {
	await run([
		`${root}/android/gradlew`,
		"-p",
		"android",
		":app:assembleDebug",
		"--no-daemon",
	]);
}

if (!(await Bun.file(apk).exists())) {
	throw new Error(`missing ${apk} — run without --skip-build`);
}

async function install(): Promise<void> {
	const code = await run(
		[adbBin, "-s", device.serial, "install", "-r", "--no-incremental", apk],
		{ allowFail: true },
	);
	if (code === 0) return;
	if (args.connect) {
		await run([adbBin, "disconnect", args.connect], { allowFail: true });
		await run([adbBin, "connect", args.connect], { allowFail: true });
		await waitForDevice(args.connect, 15);
	}
	await run([
		adbBin,
		"-s",
		device.serial,
		"install",
		"-r",
		"--no-incremental",
		apk,
	]);
}

await install();

if (!args.noLaunch) {
	await run([
		adbBin,
		"-s",
		device.serial,
		"shell",
		"am",
		"start",
		"-n",
		`${pkg}/.MainActivity`,
	]);
}

console.log(`installed ${pkg} on ${device.serial}`);
