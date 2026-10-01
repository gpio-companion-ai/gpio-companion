import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { census, leftoverLabels } from "./census.ts";
import { closeWs, deviceJson, openSignedWs, paths } from "./client.ts";
import type { CompanionHandle } from "./start.ts";

const PIN = 11;
const CYCLES = 20;

export type LeakReport = {
	warmupRssKb: number;
	warmupFds: number;
	afterRssKb: number;
	afterFds: number;
};

export async function runScenarios(
	handle: CompanionHandle,
): Promise<LeakReport> {
	const { client, pid, root } = handle;
	await expectOk(deviceJson(client, "/v1/gpio"));
	await gpioHold(handle);
	await pwmAndTone(handle);
	const sketchDir = await writeSketch(root);
	await hostRun(handle, sketchDir);
	await gpioThenRun(handle, sketchDir);
	await runLiveGpio(handle, sketchDir);
	await flashJobs(handle, sketchDir);
	await consoleUsb(handle);
	await sockets(handle);
	await removedT3Routes(handle);
	await circuitVerify(handle);
	assertNoHolds(pid, root, "after t3 removal", ["python3"]);
	const warmup = census(pid, root);
	for (let i = 0; i < CYCLES; i += 1) {
		await gpioHold(handle);
		await hostRun(handle, sketchDir);
		const ws = await openSignedWs(client, "gpio");
		await closeWs(ws);
	}
	assertNoHolds(pid, root, "after cycles", ["python3"]);
	const after = census(pid, root);
	await hangFlash(handle, sketchDir);
	return {
		warmupRssKb: warmup.rssKb,
		warmupFds: warmup.fds,
		afterRssKb: after.rssKb,
		afterFds: after.fds,
	};
}

async function gpioHold(handle: CompanionHandle): Promise<void> {
	const { client, pid, root } = handle;
	const put = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, dir: "out", value: 1 }),
	});
	if (put.status !== 200) {
		throw new Error(
			`gpio hold failed ${put.status} ${JSON.stringify(put.body)}`,
		);
	}
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("gpioset"),
		"gpioset hold",
	);
	const release = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, dir: "in" }),
	});
	if (release.status !== 200) {
		throw new Error(`gpio release failed ${release.status}`);
	}
	await waitUntil(
		() => !leftoverLabels(census(pid, root)).includes("gpioset"),
		"gpioset gone",
	);
}

async function pwmAndTone(handle: CompanionHandle): Promise<void> {
	const { client, pid, root } = handle;
	const pwm = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, dir: "pwm", analog: 128 }),
	});
	if (pwm.status !== 200) {
		throw new Error(`pwm failed ${pwm.status} ${JSON.stringify(pwm.body)}`);
	}
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("gpio-pwm"),
		"gpio-pwm hold",
	);
	const tone = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, op: "tone", hz: 440 }),
	});
	if (tone.status !== 200) {
		throw new Error(`tone failed ${tone.status} ${JSON.stringify(tone.body)}`);
	}
	const off = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, op: "notone" }),
	});
	if (off.status !== 200) {
		throw new Error(`notone failed ${off.status}`);
	}
	await waitUntil(
		() => !leftoverLabels(census(pid, root)).includes("gpio-pwm"),
		"gpio-pwm gone",
	);
}

async function hostRun(handle: CompanionHandle, dir: string): Promise<void> {
	const { client, pid, root } = handle;
	const start = await deviceJson(client, paths.run, {
		method: "POST",
		body: JSON.stringify({ dir }),
	});
	if (start.status !== 200) {
		throw new Error(
			`run start failed ${start.status} ${JSON.stringify(start.body)}`,
		);
	}
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.run);
		return Boolean((status.body as { running?: boolean } | null)?.running);
	}, "run running");
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("sketch"),
		"sketch hold",
	);
	await deviceJson(client, paths.runStop, { method: "POST", body: "{}" });
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.run);
		return !(status.body as { running?: boolean } | null)?.running;
	}, "run stopped");
	await waitUntil(
		() => !leftoverLabels(census(pid, root)).includes("sketch"),
		"sketch gone",
	);
}

async function gpioThenRun(
	handle: CompanionHandle,
	dir: string,
): Promise<void> {
	const { client, pid, root } = handle;
	await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, dir: "out", value: 1 }),
	});
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("gpioset"),
		"hold before run",
	);
	await hostRun(handle, dir);
	await waitUntil(
		() => !leftoverLabels(census(pid, root)).includes("gpioset"),
		"releaseAll on run",
	);
}

async function runLiveGpio(
	handle: CompanionHandle,
	dir: string,
): Promise<void> {
	const { client, pid, root } = handle;
	const start = await deviceJson(client, paths.run, {
		method: "POST",
		body: JSON.stringify({ dir }),
	});
	if (start.status !== 200) {
		throw new Error(
			`live run start failed ${start.status} ${JSON.stringify(start.body)}`,
		);
	}
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("sketch"),
		"live sketch hold",
	);
	const get = await deviceJson(client, paths.gpio);
	if (get.status !== 200) {
		throw new Error(`live gpio get failed ${get.status}`);
	}
	const snapshot = get.body as {
		sketch?: boolean;
		pins?: Array<{
			physical: number;
			dir?: string;
			value?: number;
			analog?: number;
			sketch?: boolean;
		}>;
	};
	if (!snapshot.sketch) {
		throw new Error("live snapshot missing sketch flag");
	}
	const pin11 = snapshot.pins?.find((pin) => pin.physical === PIN);
	if (pin11?.sketch !== true || pin11.dir !== "out" || pin11.value !== 1) {
		throw new Error(`sketch pin ${PIN} not merged ${JSON.stringify(pin11)}`);
	}
	const pin13 = snapshot.pins?.find((pin) => pin.physical === 13);
	if (pin13?.sketch !== true || pin13.dir !== "pwm" || pin13.analog !== 100) {
		throw new Error(`sketch pin 13 not merged ${JSON.stringify(pin13)}`);
	}
	const blocked = await deviceJson(client, paths.gpio, {
		method: "PUT",
		body: JSON.stringify({ physical: PIN, dir: "out", value: 0 }),
	});
	if (blocked.status !== 409) {
		throw new Error(
			`expected 409 during sketch got ${blocked.status} ${JSON.stringify(blocked.body)}`,
		);
	}
	await deviceJson(client, paths.runStop, { method: "POST", body: "{}" });
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.run);
		return !(status.body as { running?: boolean } | null)?.running;
	}, "live run stopped");
	await waitUntil(
		() => !leftoverLabels(census(pid, root)).includes("sketch"),
		"live sketch gone",
	);
	const after = await deviceJson(client, paths.gpio);
	if ((after.body as { sketch?: boolean } | null)?.sketch) {
		throw new Error("sketch flag still set after stop");
	}
	await gpioHold(handle);
}

async function flashJobs(handle: CompanionHandle, dir: string): Promise<void> {
	const { client } = handle;
	const ports = await deviceJson(client, paths.flashPorts);
	if (ports.status !== 200) {
		throw new Error(`flash ports failed ${ports.status}`);
	}
	const start = await deviceJson(client, paths.flash, {
		method: "POST",
		body: JSON.stringify({
			fqbn: "arduino:avr:uno",
			dir,
			port: "/dev/ttyACM99",
		}),
	});
	if (start.status !== 200) {
		throw new Error(
			`flash start failed ${start.status} ${JSON.stringify(start.body)}`,
		);
	}
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.flash);
		return !(status.body as { running?: boolean } | null)?.running;
	}, "flash finished");
	const proxy = await deviceJson(client, paths.flashProxy, {
		method: "POST",
		body: JSON.stringify({ fqbn: "arduino:avr:uno", port: "/dev/ttyACM99" }),
	});
	if (proxy.status !== 200) {
		throw new Error(
			`flash proxy failed ${proxy.status} ${JSON.stringify(proxy.body)}`,
		);
	}
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.flash);
		return !(status.body as { running?: boolean } | null)?.running;
	}, "flash proxy finished");
}

async function consoleUsb(handle: CompanionHandle): Promise<void> {
	const { client, pid, root } = handle;
	await deviceJson(client, paths.consoleUsb, {
		method: "POST",
		body: JSON.stringify({ port: "/dev/ttyUSB0" }),
	});
	await Bun.sleep(100);
	await deviceJson(client, paths.consoleUsbStop, {
		method: "POST",
		body: "{}",
	});
	assertNoHolds(pid, root, "console usb", ["python3"]);
}

async function sockets(handle: CompanionHandle): Promise<void> {
	const { client } = handle;
	const open: WebSocket[] = [];
	for (let i = 0; i < 8; i += 1) {
		open.push(await openSignedWs(client, i % 2 === 0 ? "gpio" : "debug"));
	}
	const extra = await openSignedWs(client, "console").catch(() => null);
	if (extra && extra.readyState === WebSocket.OPEN) {
		open.push(extra);
	}
	for (const ws of open) {
		await closeWs(ws);
	}
}

async function removedT3Routes(handle: CompanionHandle): Promise<void> {
	const { client } = handle;
	const removed = await Promise.all([
		deviceJson(client, "/v1/t3/status"),
		deviceJson(client, "/v1/t3/status"),
		deviceJson(client, "/v1/t3/pair", { method: "POST", body: "{}" }),
	]);
	for (const response of removed) {
		if (response.status !== 404) {
			throw new Error(
				`t3 route still served ${response.status} ${JSON.stringify(response.body)}`,
			);
		}
	}
}

async function circuitVerify(handle: CompanionHandle): Promise<void> {
	const { client, pid, root } = handle;
	const idle = await deviceJson(client, paths.verify);
	if (idle.status !== 200) {
		throw new Error(
			`verify get failed ${idle.status} ${JSON.stringify(idle.body)}`,
		);
	}
	if (
		typeof (idle.body as { running?: unknown } | null)?.running !== "boolean"
	) {
		throw new Error(
			`verify status missing running ${JSON.stringify(idle.body)}`,
		);
	}
	const start = await deviceJson(client, paths.verify, {
		method: "POST",
		body: JSON.stringify({ repo: "blink-led" }),
	});
	if (start.status !== 200) {
		throw new Error(
			`verify start failed ${start.status} ${JSON.stringify(start.body)}`,
		);
	}
	await waitUntil(async () => {
		const status = await deviceJson(client, paths.verify);
		const body = status.body as {
			running?: boolean;
			last?: { results?: unknown[] } | null;
		} | null;
		return Boolean(body && body.running === false && body.last);
	}, "verify finished");
	const stop = await deviceJson(client, paths.verifyStop, {
		method: "POST",
		body: "{}",
	});
	if (stop.status !== 200) {
		throw new Error(
			`verify stop failed ${stop.status} ${JSON.stringify(stop.body)}`,
		);
	}
	assertNoHolds(pid, root, "after verify", ["python3"]);
}

async function hangFlash(handle: CompanionHandle, dir: string): Promise<void> {
	const { client, pid, root } = handle;
	await writeFile(join(root, "hang-flash"), "1\n");
	const start = await deviceJson(client, paths.flash, {
		method: "POST",
		body: JSON.stringify({
			fqbn: "arduino:avr:uno",
			dir,
			port: "/dev/ttyACM99",
		}),
	});
	if (start.status !== 200) {
		throw new Error(`hang flash failed ${start.status}`);
	}
	await waitUntil(
		() => leftoverLabels(census(pid, root)).includes("arduino-cli"),
		"arduino-cli hang",
	);
}

async function writeSketch(root: string): Promise<string> {
	const dir = join(root, "sketch");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "sketch.c"),
		"void setup(void) {}\nvoid loop(void) {}\n",
	);
	return dir;
}

function assertNoHolds(
	pid: number,
	root: string,
	when: string,
	allow: string[],
): void {
	const leftovers = leftoverLabels(census(pid, root)).filter(
		(label) => !allow.includes(label),
	);
	if (leftovers.length) {
		throw new Error(`${when}: leftovers ${leftovers.join(",")}`);
	}
}

async function expectOk(
	pending: Promise<{ status: number; body: unknown }>,
): Promise<void> {
	const result = await pending;
	if (result.status !== 200) {
		throw new Error(
			`expected 200 got ${result.status} ${JSON.stringify(result.body)}`,
		);
	}
}

async function waitUntil(
	check: () => boolean | Promise<boolean>,
	label: string,
	timeoutMs = 8_000,
): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) {
			return;
		}
		await Bun.sleep(40);
	}
	throw new Error(`timeout waiting for ${label}`);
}
