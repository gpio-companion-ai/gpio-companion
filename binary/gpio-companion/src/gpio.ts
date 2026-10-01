import { existsSync, readFileSync } from "node:fs";
import {
	analogToPwmPercent,
	assertGpioDrive,
	GPIO_MAX_PWM,
	GPIO_PWM_HZ,
	GPIO_RESERVED_PHYSICAL,
	type GpioApply,
	type GpioDir,
	GpioError,
	type GpioPinState,
	type GpioSnapshot,
	gpioNamedLine,
	type HardwareId,
	type HeaderPinDef,
	headerPinsForBoard,
	isGpioNoTone,
	isGpioTone,
	parseGpioChips,
	resolveSkuChip,
	skuPinout,
} from "gpio-companion";
import { readBoardModel } from "./board-model.ts";
import { privileged } from "./priv.ts";

export type GpioInfoLine = {
	chip: string;
	line: number;
	name: string;
	dir?: GpioDir;
};

export type GpioLineRef = {
	chip: string;
	line: number;
	name: string;
};

export type GpioLive = {
	dir?: GpioDir;
	value?: 0 | 1;
	analog?: number;
	hz?: number;
};

export type GpioBackend = {
	gpioinfo(): Promise<string>;
	readall(): Promise<string>;
	get(ref: GpioLineRef): Promise<GpioLive>;
	getMany?(refs: GpioLineRef[]): Promise<Map<string, GpioLive>>;
	set(ref: GpioLineRef, dir: GpioDir, value?: 0 | 1): Promise<void>;
	pwm?(): Promise<Map<number, number>>;
	analogWrite?(ref: GpioLineRef, analog: number): Promise<void>;
	tone?(ref: GpioLineRef, hz: number): Promise<void>;
	noTone?(ref: GpioLineRef): Promise<void>;
};

const PROBE_MS = 30_000;

let gpioEscalate: boolean | null = null;

export function resetGpioEscalate(): void {
	gpioEscalate = null;
}

export function isGpioPermissionDenied(message: string): boolean {
	return /permission denied|operation not permitted/i.test(message);
}

function canEscalateGpio(): boolean {
	return typeof process.getuid !== "function" || process.getuid() !== 0;
}

function gpioCmd(cmd: string[]): string[] {
	return gpioEscalate === true ? privileged(cmd) : cmd;
}

export type GpioController = {
	snapshot(hardware: HardwareId): Promise<GpioSnapshot>;
	apply(hardware: HardwareId, put: GpioApply): Promise<GpioSnapshot>;
	releaseAll?(): Promise<void>;
	setSketchStatus?(sketchStatus: () => SketchStatus | null): void;
};

export type SketchPinStatus = {
	physical: number;
	chip: string;
	line: number;
	mode: "in" | "out";
	value?: 0 | 1;
	analog?: number;
	hz?: number;
};

export type SketchStatus = {
	pid: number;
	started?: number;
	pins: SketchPinStatus[];
};

export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	if (pid === process.pid) {
		return true;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

export function readSketchStatus(
	path: string | null | undefined,
): SketchStatus | null {
	if (!path) {
		return null;
	}
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as {
		pid?: unknown;
		started?: unknown;
		pins?: unknown;
	};
	if (!isPidAlive(Number(record.pid))) {
		return null;
	}
	if (!Array.isArray(record.pins)) {
		return null;
	}
	const pins: SketchPinStatus[] = [];
	for (const item of record.pins) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const pin = item as Record<string, unknown>;
		const physical = Number(pin.physical);
		const line = Number(pin.line);
		if (
			!Number.isInteger(physical) ||
			physical < 1 ||
			physical > 40 ||
			typeof pin.chip !== "string" ||
			!pin.chip ||
			!Number.isInteger(line)
		) {
			continue;
		}
		const status: SketchPinStatus = {
			physical,
			chip: pin.chip,
			line,
			mode: pin.mode === "out" ? "out" : "in",
		};
		if (pin.value === 0 || pin.value === 1) {
			status.value = pin.value;
		}
		if (
			typeof pin.analog === "number" &&
			pin.analog >= 0 &&
			pin.analog <= 255
		) {
			status.analog = pin.analog;
		}
		if (typeof pin.hz === "number" && pin.hz >= 31 && pin.hz <= 65535) {
			status.hz = pin.hz;
		}
		pins.push(status);
	}
	const out: SketchStatus = { pid: Number(record.pid), pins };
	if (typeof record.started === "number" && Number.isFinite(record.started)) {
		out.started = record.started;
	}
	return out;
}

export type GpioControllerOptions = {
	model?: string | (() => string | undefined);
	sketchStatus?: () => SketchStatus | null;
};

export function parseGpioinfo(text: string): GpioInfoLine[] {
	const lines: GpioInfoLine[] = [];
	let chip = "";
	for (const raw of text.split("\n")) {
		const chipMatch = /^(gpiochip\d+)\b/.exec(raw.trim());
		if (chipMatch?.[1]) {
			chip = chipMatch[1];
			continue;
		}
		const lineMatch = /^\s*line\s+(\d+):\s+"?([^"\s]+)"?\s+(.*)$/.exec(raw);
		if (!chip || !lineMatch) {
			continue;
		}
		const offset = Number(lineMatch[1]);
		const name = (lineMatch[2] ?? "").trim();
		const rest = (lineMatch[3] ?? "").toLowerCase();
		const dir: GpioDir | undefined = rest.includes("output")
			? "out"
			: rest.includes("input")
				? "in"
				: undefined;
		if (!Number.isInteger(offset)) {
			continue;
		}
		lines.push({
			chip,
			line: offset,
			name: !name || name === "unnamed" ? "" : name,
			dir,
		});
	}
	return lines;
}

export function parseWiringOpReadall(text: string): Map<number, string> {
	const names = new Map<number, string>();
	for (const raw of text.split("\n")) {
		if (!raw.includes("||")) {
			continue;
		}
		const [left, right] = raw.split("||");
		addReadallSide(names, left ?? "", "left");
		addReadallSide(names, right ?? "", "right");
	}
	return names;
}

export function resolveHeaderLines(
	hardware: HardwareId,
	gpioinfoText: string,
	readallText = "",
	model?: string,
): Map<number, GpioLineRef> {
	const sku = skuPinout(model);
	if (sku) {
		const chips = parseGpioChips(gpioinfoText);
		const resolved = new Map<number, GpioLineRef>();
		for (const pin of sku.lines) {
			resolved.set(pin.physical, {
				chip: resolveSkuChip(pin.domain, chips),
				line: pin.line,
				name: pin.soc ?? pin.name,
			});
		}
		return resolved;
	}
	const info = parseGpioinfo(gpioinfoText);
	const byName = new Map<string, GpioInfoLine>();
	for (const line of info) {
		if (!line.name) {
			continue;
		}
		byName.set(normalizeLineName(line.name), line);
	}
	const wiringNames = parseWiringOpReadall(readallText);
	const resolved = new Map<number, GpioLineRef>();
	for (const pin of headerPinsForBoard(hardware, model)) {
		if (pin.type !== "gpio") {
			continue;
		}
		const ref = resolvePinLine(
			hardware,
			pin.physical,
			pin,
			byName,
			wiringNames,
		);
		if (ref) {
			resolved.set(pin.physical, {
				chip: ref.chip,
				line: ref.line,
				name: ref.name,
			});
		}
	}
	return resolved;
}

export function createGpioController(
	backend: GpioBackend,
	options?: GpioControllerOptions,
): GpioController {
	let sketchLookup: (() => SketchStatus | null) | null =
		options?.sketchStatus ?? null;
	function model(): string | undefined {
		if (typeof options?.model === "function") {
			return options.model();
		}
		return options?.model;
	}
	let probeCache: {
		key: string;
		at: number;
		gpioinfoText: string;
		readallText: string;
	} | null = null;
	async function loadProbe(hardware: HardwareId, force = false) {
		const board = model() ?? "";
		const key = `${hardware}:${board}`;
		if (
			!force &&
			probeCache &&
			probeCache.key === key &&
			Date.now() - probeCache.at < PROBE_MS
		) {
			return probeCache;
		}
		const next = await probe(backend);
		probeCache = { key, at: Date.now(), ...next };
		return probeCache;
	}
	return {
		async snapshot(hardware) {
			const cached = await loadProbe(hardware);
			return readSnapshot(
				hardware,
				backend,
				cached.gpioinfoText,
				cached.readallText,
				model(),
				() => sketchLookup?.() ?? null,
			);
		},
		setSketchStatus(sketchStatus) {
			sketchLookup = sketchStatus;
		},
		async apply(hardware, put) {
			const board = model();
			const sku = skuPinout(board);
			const physical = put.physical;
			if (sku && physical > sku.pinCount) {
				throw new GpioError(`pin ${physical} is not on this header`);
			}
			const pin = assertGpioDrive(hardware, physical);
			const { gpioinfoText, readallText } = await loadProbe(hardware, true);
			const ref = resolveHeaderLines(
				hardware,
				gpioinfoText,
				readallText,
				board,
			).get(physical);
			if (!ref) {
				throw new GpioError(
					pin.resolve === "live"
						? `pin ${physical} is unresolved`
						: `pin ${physical} line not found`,
				);
			}
			if (isGpioTone(put)) {
				if (!backend.tone) {
					throw new GpioError("tone is unavailable");
				}
				await backend.tone(ref, put.hz);
			} else if (isGpioNoTone(put)) {
				if (backend.noTone) {
					await backend.noTone(ref);
				} else {
					await backend.set(ref, "in");
				}
			} else if (put.dir === "pwm") {
				if (!backend.analogWrite) {
					throw new GpioError("pwm is unavailable");
				}
				await backend.analogWrite(ref, put.analog ?? 0);
			} else {
				if (backend.noTone) {
					await backend.noTone(ref);
				}
				await backend.set(ref, put.dir, put.value);
			}
			return readSnapshot(
				hardware,
				backend,
				gpioinfoText,
				readallText,
				board,
				() => sketchLookup?.() ?? null,
			);
		},
	};
}

export function createLibgpiodGpio(
	options?: GpioControllerOptions,
): GpioController {
	const held = new Map<
		string,
		{ proc: ReturnType<typeof Bun.spawn>; value: 0 | 1 }
	>();
	const pwmHeld = new Map<string, PwmHold>();
	const offHeld = new Set<string>();
	let gate = Promise.resolve();
	function serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = gate.then(fn, fn);
		gate = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}
	const controller = createGpioController(
		{
			gpioinfo: () => spawnText(["gpioinfo"]),
			readall: () => spawnText(["gpio", "readall"]).catch(() => ""),
			pwm: readSysfsPwm,
			async get(ref) {
				const heldLive = liveFromHeld(held, pwmHeld, offHeld, ref);
				if (heldLive) {
					return heldLive;
				}
				const text = await spawnGpioGet(ref);
				return parseGpioGet(text);
			},
			async getMany(refs) {
				return readManyLives(refs, held, pwmHeld, offHeld);
			},
			async set(ref, dir, value) {
				await serial(async () => {
					await releasePwm(pwmHeld, ref);
					await releaseHeld(held, ref);
					if (dir === "off") {
						offHeld.add(lineKey(ref));
						return;
					}
					offHeld.delete(lineKey(ref));
					if (dir === "in") {
						await spawnGpioGet(ref, false);
						return;
					}
					if (value !== 0 && value !== 1) {
						throw new GpioError("value is required for output");
					}
					const proc = await spawnGpioHold(ref, value);
					if (proc) {
						held.set(lineKey(ref), { proc, value });
					}
				});
			},
			async analogWrite(ref, analog) {
				await serial(async () => {
					offHeld.delete(lineKey(ref));
					await releaseHeld(held, ref);
					const current = pwmHeld.get(lineKey(ref));
					if (current && current.hz === undefined) {
						if (writeHeldStdin(current.proc, `duty ${analog}\n`)) {
							current.analog = analog;
							return;
						}
					}
					await startPwm(pwmHeld, ref, analog, undefined);
				});
			},
			async tone(ref, hz) {
				await serial(async () => {
					offHeld.delete(lineKey(ref));
					await releaseHeld(held, ref);
					const current = pwmHeld.get(lineKey(ref));
					if (current && current.hz !== undefined) {
						if (writeHeldStdin(current.proc, `hz ${hz}\n`)) {
							current.hz = hz;
							return;
						}
					}
					await startPwm(pwmHeld, ref, 128, hz);
				});
			},
			async noTone(ref) {
				await serial(async () => {
					await releasePwm(pwmHeld, ref);
				});
			},
		},
		{ model: () => readBoardModel(), sketchStatus: options?.sketchStatus },
	);
	return {
		snapshot: controller.snapshot,
		apply: controller.apply,
		setSketchStatus: controller.setSketchStatus,
		async releaseAll() {
			await serial(async () => {
				offHeld.clear();
				for (const [key, current] of [...held.entries()]) {
					held.delete(key);
					await killTree(current.proc);
				}
				for (const [key, current] of [...pwmHeld.entries()]) {
					pwmHeld.delete(key);
					writeHeldStdin(current.proc, "stop\n");
					await killTree(current.proc);
				}
			});
		},
	};
}

export function memoryGpioBackend(
	infoText: string,
	readallText = "",
	values: Record<string, 0 | 1> = {},
	pwm: Record<number, number> = {},
): GpioBackend {
	const state = new Map<string, GpioLive>();
	for (const line of parseGpioinfo(infoText)) {
		const key = lineKey(line);
		state.set(key, { dir: line.dir ?? "in", value: values[key] ?? 0 });
	}
	return {
		async gpioinfo() {
			return infoText;
		},
		async readall() {
			return readallText;
		},
		async get(ref) {
			return state.get(lineKey(ref)) ?? { dir: "in", value: 0 };
		},
		async set(ref, dir, value) {
			if (dir === "off") {
				state.set(lineKey(ref), { dir: "off" });
				return;
			}
			state.set(lineKey(ref), {
				dir,
				value: dir === "out" ? (value ?? 0) : 0,
			});
		},
		async analogWrite(ref, analog) {
			state.set(lineKey(ref), {
				dir: "pwm",
				analog,
				value: analog >= 128 ? 1 : 0,
			});
		},
		async tone(ref, hz) {
			state.set(lineKey(ref), { dir: "out", hz, analog: 128, value: 1 });
		},
		async noTone(ref) {
			const current = state.get(lineKey(ref)) ?? { dir: "in", value: 0 };
			state.set(lineKey(ref), { dir: "in", value: current.value ?? 0 });
		},
		async pwm() {
			return new Map(
				Object.entries(pwm).map(([channel, percent]) => [
					Number(channel),
					percent,
				]),
			);
		},
	};
}

async function readSnapshot(
	hardware: HardwareId,
	backend: GpioBackend,
	gpioinfoText?: string,
	readallText?: string,
	model?: string,
	sketchStatus?: () => SketchStatus | null,
): Promise<GpioSnapshot> {
	const infoText = gpioinfoText ?? (await backend.gpioinfo());
	const wiringText =
		readallText ?? (hardware === "orangepi" ? await backend.readall() : "");
	const pwmDuties = backend.pwm
		? await backend.pwm().catch(() => new Map<number, number>())
		: new Map<number, number>();
	const resolved = resolveHeaderLines(hardware, infoText, wiringText, model);
	const infoDirs = gpioinfoDirs(infoText);
	const sketch = sketchStatus?.() ?? null;
	const sketchByPhysical = new Map(
		(sketch?.pins ?? []).map((pin) => [pin.physical, pin] as const),
	);
	const pins: GpioPinState[] = [];
	const gpioRefs: GpioLineRef[] = [];
	for (const def of headerPinsForBoard(hardware, model)) {
		if (def.type !== "gpio") {
			continue;
		}
		const ref = resolved.get(def.physical);
		if (ref) {
			gpioRefs.push(ref);
		}
	}
	const lives = await readLives(backend, gpioRefs);
	for (const def of headerPinsForBoard(hardware, model)) {
		const reserved = GPIO_RESERVED_PHYSICAL[hardware].includes(def.physical);
		const ref = resolved.get(def.physical);
		if (def.type !== "gpio") {
			pins.push({
				physical: def.physical,
				name: def.name,
				type: def.type,
			});
			continue;
		}
		if (!ref) {
			const pin: GpioPinState = {
				physical: def.physical,
				name: def.name,
				type: "gpio",
				reserved,
				unresolved: !reserved,
			};
			if (def.alt?.length) {
				pin.alt = def.alt;
			}
			const pwm = pwmForPin(def, pwmDuties);
			if (pwm !== undefined) {
				pin.pwm = pwm;
			}
			pins.push(pin);
			continue;
		}
		const live = lives.get(lineKey(ref));
		const infoDir = infoDirs.get(lineKey(ref));
		const pwm = pwmForPin(def, pwmDuties);
		const sketchPin = sketchByPhysical.get(def.physical);
		const pin: GpioPinState = {
			physical: def.physical,
			name: def.name,
			type: "gpio",
			chip: ref.chip,
			line: ref.line,
			dir: live?.dir ?? infoDir,
			value: live?.value,
			reserved,
		};
		if (def.alt?.length) {
			pin.alt = def.alt;
		}
		if (sketchPin) {
			pin.sketch = true;
			delete pin.dir;
			delete pin.value;
			delete pin.analog;
			delete pin.hz;
			pin.dir = sketchPin.mode === "in" ? "in" : "out";
			if (sketchPin.mode === "in") {
				pin.value = sketchPin.value ?? 0;
			} else if (typeof sketchPin.analog === "number") {
				pin.analog = sketchPin.analog;
				pin.pwm = analogToPwmPercent(sketchPin.analog);
				pin.dir = "pwm";
				pin.value = sketchPin.analog >= 128 ? 1 : 0;
			} else {
				pin.value = sketchPin.value ?? 0;
				if (typeof sketchPin.hz === "number") {
					pin.hz = sketchPin.hz;
				}
			}
		} else if (live?.dir !== "off") {
			if (live?.analog !== undefined) {
				pin.analog = live.analog;
				pin.pwm = analogToPwmPercent(live.analog);
				pin.dir = "pwm";
			} else if (pwm !== undefined) {
				pin.pwm = pwm;
			}
			if (live?.hz !== undefined) {
				pin.hz = live.hz;
				pin.dir = "out";
			}
		}
		pins.push(pin);
	}
	return sketch ? { hardware, pins, sketch: true } : { hardware, pins };
}

async function probe(backend: GpioBackend): Promise<{
	gpioinfoText: string;
	readallText: string;
}> {
	return {
		gpioinfoText: await backend.gpioinfo(),
		readallText: await backend.readall().catch(() => ""),
	};
}

function resolvePinLine(
	hardware: HardwareId,
	physical: number,
	pin: { name: string; bcm?: number | null; resolve?: "live" },
	byName: Map<string, GpioInfoLine>,
	wiringNames: Map<number, string>,
): GpioLineRef | undefined {
	if (hardware === "raspberrypi" && pin.bcm != null) {
		const named = byName.get(normalizeLineName(gpioNamedLine(pin.bcm)));
		if (named) {
			return named;
		}
		const fallback = [...byName.values()].find(
			(line) => line.chip === "gpiochip0" && line.line === pin.bcm,
		);
		if (fallback) {
			return fallback;
		}
	}
	const wiring = wiringNames.get(physical);
	if (wiring) {
		const named = byName.get(normalizeLineName(wiring));
		if (named) {
			return named;
		}
	}
	if (pin.name !== "GPIO") {
		const exact = byName.get(normalizeLineName(pin.name));
		if (exact) {
			return exact;
		}
		for (const [name, line] of byName) {
			if (name.includes(normalizeLineName(pin.name))) {
				return line;
			}
		}
	}
	return undefined;
}

function addReadallSide(
	names: Map<number, string>,
	side: string,
	which: "left" | "right",
) {
	const fields = side.split("|").map((part) => part.trim());
	const cells = fields.filter((part) => part.length > 0);
	if (cells.length < 2) {
		return;
	}
	if (which === "left") {
		const physical = Number(cells[cells.length - 1]);
		const name = cells[2] ?? "";
		if (Number.isInteger(physical) && isGpioName(name)) {
			names.set(physical, name);
		}
		return;
	}
	const physical = Number(cells[0]);
	const name = cells[3] ?? cells[2] ?? "";
	if (Number.isInteger(physical) && isGpioName(name)) {
		names.set(physical, name);
	}
}

function isGpioName(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) {
		return false;
	}
	const lower = trimmed.toLowerCase();
	return !(
		lower.includes("3.3") ||
		lower.includes("5v") ||
		lower === "0v" ||
		lower === "gnd"
	);
}

function normalizeLineName(name: string): string {
	return name.trim().toUpperCase().replace(/[.\s]/g, "");
}

function lineKey(ref: { chip: string; line: number }): string {
	return `${ref.chip}:${ref.line}`;
}

export function parseGpioGet(text: string): GpioLive {
	const trimmed = text.trim();
	if (/\binactive\b/i.test(trimmed)) {
		return { value: 0 };
	}
	if (/\bactive\b/i.test(trimmed)) {
		return { value: 1 };
	}
	const match = /\b([01])\b/.exec(trimmed);
	if (!match) {
		throw new GpioError("gpioget returned no value");
	}
	return { value: match[1] === "1" ? 1 : 0 };
}

export function parseGpioGetMany(text: string): GpioLive[] {
	const lives: GpioLive[] = [];
	for (const raw of text.split(/\n/)) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		if (/\bactive\b|\binactive\b|=/.test(trimmed) || /^[01]$/.test(trimmed)) {
			try {
				lives.push(parseGpioGet(trimmed));
				continue;
			} catch {
				undefined;
			}
		}
		for (const token of trimmed.split(/\s+/)) {
			if (!token) {
				continue;
			}
			try {
				lives.push(parseGpioGet(token));
			} catch {
				undefined;
			}
		}
	}
	return lives;
}

async function readLives(
	backend: GpioBackend,
	refs: GpioLineRef[],
): Promise<Map<string, GpioLive>> {
	if (refs.length === 0) {
		return new Map();
	}
	if (backend.getMany) {
		return backend.getMany(refs);
	}
	const lives = new Map<string, GpioLive>();
	for (const ref of refs) {
		try {
			lives.set(lineKey(ref), await backend.get(ref));
		} catch {
			undefined;
		}
	}
	return lives;
}

function liveFromHeld(
	held: Map<string, { proc: ReturnType<typeof Bun.spawn>; value: 0 | 1 }>,
	pwmHeld: Map<string, PwmHold>,
	offHeld: Set<string>,
	ref: GpioLineRef,
): GpioLive | undefined {
	if (offHeld.has(lineKey(ref))) {
		return { dir: "off" };
	}
	const pwm = pwmHeld.get(lineKey(ref));
	if (pwm) {
		return {
			dir: pwm.hz ? "out" : "pwm",
			value: pwm.analog >= 128 ? 1 : 0,
			analog: pwm.hz ? undefined : pwm.analog,
			hz: pwm.hz,
		};
	}
	const current = held.get(lineKey(ref));
	if (current) {
		return { dir: "out", value: current.value };
	}
	return undefined;
}

async function readManyLives(
	refs: GpioLineRef[],
	held: Map<string, { proc: ReturnType<typeof Bun.spawn>; value: 0 | 1 }>,
	pwmHeld: Map<string, PwmHold>,
	offHeld: Set<string>,
): Promise<Map<string, GpioLive>> {
	const lives = new Map<string, GpioLive>();
	const pending: GpioLineRef[] = [];
	for (const ref of refs) {
		const heldLive = liveFromHeld(held, pwmHeld, offHeld, ref);
		if (heldLive) {
			lives.set(lineKey(ref), heldLive);
			continue;
		}
		pending.push(ref);
	}
	if (pending.length === 0) {
		return lives;
	}
	const batched = await spawnGpioGetMany(pending);
	for (const [key, live] of batched) {
		lives.set(key, live);
	}
	return lives;
}

type PwmHold = {
	proc: ReturnType<typeof Bun.spawn>;
	analog: number;
	hz?: number;
};

function gpioinfoDirs(text: string): Map<string, GpioDir> {
	const dirs = new Map<string, GpioDir>();
	for (const line of parseGpioinfo(text)) {
		if (line.dir) {
			dirs.set(lineKey(line), line.dir);
		}
	}
	return dirs;
}

function pwmForPin(
	def: HeaderPinDef,
	duties: Map<number, number>,
): number | undefined {
	const alts = def.alt ?? [];
	if (alts.includes("PWM0") && duties.has(0)) {
		return duties.get(0);
	}
	if (alts.includes("PWM1") && duties.has(1)) {
		return duties.get(1);
	}
	return undefined;
}

async function readSysfsPwm(): Promise<Map<number, number>> {
	const duties = new Map<number, number>();
	for (const chip of ["pwmchip0", "pwmchip1"]) {
		for (const channel of [0, 1]) {
			const percent = await readSysfsPwmChannel(chip, channel);
			if (percent !== undefined && !duties.has(channel)) {
				duties.set(channel, percent);
			}
		}
	}
	return duties;
}

async function readSysfsPwmChannel(
	chip: string,
	channel: number,
): Promise<number | undefined> {
	const base = `/sys/class/pwm/${chip}/pwm${channel}`;
	try {
		const [enableText, periodText, dutyText] = await Promise.all([
			Bun.file(`${base}/enable`).text(),
			Bun.file(`${base}/period`).text(),
			Bun.file(`${base}/duty_cycle`).text(),
		]);
		if (enableText.trim() !== "1") {
			return undefined;
		}
		const period = Number(periodText.trim());
		const duty = Number(dutyText.trim());
		if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(duty)) {
			return undefined;
		}
		return Math.round((Math.min(duty, period) / period) * 1000) / 10;
	} catch {
		return undefined;
	}
}

async function releaseHeld(
	held: Map<string, { proc: ReturnType<typeof Bun.spawn>; value: 0 | 1 }>,
	ref: GpioLineRef,
): Promise<void> {
	const current = held.get(lineKey(ref));
	if (!current) {
		return;
	}
	held.delete(lineKey(ref));
	await killTree(current.proc);
}

async function spawnGpioHold(
	ref: GpioLineRef,
	value: 0 | 1,
): Promise<ReturnType<typeof Bun.spawn> | undefined> {
	const signal = await spawnDetached([
		"gpioset",
		"-m",
		"signal",
		"-c",
		ref.chip,
		`${ref.line}=${value}`,
	]);
	if (signal) {
		return signal;
	}
	const waiting = await spawnDetached(
		["gpioset", "-c", ref.chip, `${ref.line}=${value}`],
		"pipe",
	);
	if (waiting) {
		return waiting;
	}
	try {
		await spawnGpioSet(ref, value);
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			throw error;
		}
		await spawnText(["gpioset", ref.chip, `${ref.line}=${value}`]);
	}
	return undefined;
}

async function spawnDetached(
	cmd: string[],
	stdin: "ignore" | "pipe" = "ignore",
): Promise<ReturnType<typeof Bun.spawn> | undefined> {
	const proc = Bun.spawn(gpioCmd(cmd), {
		stdout: "ignore",
		stderr: "pipe",
		stdin,
	});
	const exited = await Promise.race([
		proc.exited,
		Bun.sleep(80).then(() => null),
	]);
	if (exited === null) {
		if (gpioEscalate === null) {
			gpioEscalate = false;
		}
		return proc;
	}
	const stderr = await readPipe(proc.stderr);
	if (
		gpioEscalate !== true &&
		canEscalateGpio() &&
		isGpioPermissionDenied(stderr)
	) {
		gpioEscalate = true;
		return spawnDetached(cmd, stdin);
	}
	return undefined;
}

async function startPwm(
	held: Map<string, PwmHold>,
	ref: GpioLineRef,
	analog: number,
	hz?: number,
): Promise<void> {
	await releasePwm(held, ref);
	await sweepPwmOrphans(ref);
	if (held.size >= GPIO_MAX_PWM) {
		throw new GpioError("too many pwm pins");
	}
	const bin = resolvePwmBin();
	if (!bin) {
		throw new GpioError("gpio-pwm helper is not installed");
	}
	const cmd = [
		bin,
		"--chip",
		ref.chip,
		"--line",
		String(ref.line),
		"--mode",
		hz ? "tone" : "pwm",
		"--duty",
		String(analog),
		"--hz",
		String(hz ?? GPIO_PWM_HZ),
	];
	const proc = Bun.spawn(gpioCmd(cmd), {
		stdout: "ignore",
		stderr: "pipe",
		stdin: "pipe",
	});
	const exited = await Promise.race([
		proc.exited,
		Bun.sleep(80).then(() => null),
	]);
	if (exited !== null) {
		const stderr = await readPipe(proc.stderr);
		if (
			gpioEscalate !== true &&
			canEscalateGpio() &&
			isGpioPermissionDenied(stderr)
		) {
			gpioEscalate = true;
			await startPwm(held, ref, analog, hz);
			return;
		}
		throw new GpioError(stderr.trim() || "gpio-pwm failed");
	}
	if (gpioEscalate === null) {
		gpioEscalate = false;
	}
	held.set(lineKey(ref), { proc, analog, hz });
}

async function releasePwm(
	held: Map<string, PwmHold>,
	ref: GpioLineRef,
): Promise<void> {
	const current = held.get(lineKey(ref));
	if (!current) {
		return;
	}
	held.delete(lineKey(ref));
	writeHeldStdin(current.proc, "stop\n");
	await killTree(current.proc);
}

async function sweepPwmOrphans(ref: GpioLineRef): Promise<void> {
	const needle = `gpio-pwm --chip ${ref.chip} --line ${ref.line} `;
	await spawnText(["pkill", "-f", needle]).catch(() => undefined);
}

function writeHeldStdin(
	proc: ReturnType<typeof Bun.spawn>,
	text: string,
): boolean {
	try {
		const stdin = proc.stdin;
		if (!stdin || typeof stdin === "number") {
			return false;
		}
		stdin.write(text);
		return true;
	} catch {
		return false;
	}
}

export type KillableProc = {
	pid?: number;
	kill(signal?: "SIGTERM" | "SIGKILL"): void;
	exited: Promise<number>;
};

export async function killTree(proc: KillableProc): Promise<void> {
	const pid = proc.pid;
	if (pid) {
		await spawnText(["pkill", "-TERM", "-P", String(pid)]).catch(
			() => undefined,
		);
	}
	try {
		proc.kill("SIGTERM");
	} catch {
		undefined;
	}
	const done = await Promise.race([
		proc.exited.then(() => true),
		Bun.sleep(200).then(() => false),
	]);
	if (!done && pid) {
		await spawnText(["pkill", "-KILL", "-P", String(pid)]).catch(
			() => undefined,
		);
		try {
			proc.kill("SIGKILL");
		} catch {
			undefined;
		}
	}
	await proc.exited.catch(() => undefined);
}

function resolvePwmBin(): string | undefined {
	const env = process.env.GPIO_COMPANION_PWM?.trim();
	if (env && existsSync(env)) {
		return env;
	}
	const installed = "/usr/local/lib/gpio-companion/gpio-pwm";
	const source = new URL("../../../native/gpio-pwm/gpio-pwm", import.meta.url)
		.pathname;
	for (const path of [installed, source]) {
		if (existsSync(path)) {
			return path;
		}
	}
	return undefined;
}

async function spawnGpioGet(ref: GpioLineRef, asIs = true): Promise<string> {
	const extra = asIs ? ["-a"] : [];
	try {
		return await spawnText([
			"gpioget",
			...extra,
			"--numeric",
			"-c",
			ref.chip,
			String(ref.line),
		]);
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			throw error;
		}
	}
	try {
		return await spawnText(["gpioget", "-c", ref.chip, String(ref.line)]);
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			throw error;
		}
	}
	return spawnText(["gpioget", ref.chip, String(ref.line)]);
}

async function spawnGpioGetMany(
	refs: GpioLineRef[],
): Promise<Map<string, GpioLive>> {
	const lives = new Map<string, GpioLive>();
	const byChip = new Map<string, GpioLineRef[]>();
	for (const ref of refs) {
		const group = byChip.get(ref.chip) ?? [];
		group.push(ref);
		byChip.set(ref.chip, group);
	}
	for (const [chip, group] of byChip) {
		const values = await spawnGpioGetChip(chip, group);
		if (values && values.length === group.length) {
			for (let index = 0; index < group.length; index += 1) {
				const ref = group[index];
				const live = values[index];
				if (ref && live) {
					lives.set(lineKey(ref), live);
				}
			}
			continue;
		}
		for (const ref of group) {
			try {
				lives.set(lineKey(ref), parseGpioGet(await spawnGpioGet(ref)));
			} catch {
				undefined;
			}
		}
	}
	return lives;
}

async function spawnGpioGetChip(
	chip: string,
	refs: GpioLineRef[],
): Promise<GpioLive[] | null> {
	const lines = refs.map((ref) => String(ref.line));
	try {
		return parseGpioGetMany(
			await spawnText(["gpioget", "--numeric", "-c", chip, ...lines]),
		);
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			return null;
		}
	}
	try {
		return parseGpioGetMany(await spawnText(["gpioget", "-c", chip, ...lines]));
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			return null;
		}
	}
	try {
		return parseGpioGetMany(await spawnText(["gpioget", chip, ...lines]));
	} catch {
		return null;
	}
}

async function spawnGpioSet(ref: GpioLineRef, value: 0 | 1): Promise<void> {
	try {
		await spawnText(["gpioset", "-c", ref.chip, `${ref.line}=${value}`]);
	} catch (error) {
		if (!isUnknownCliOption(error)) {
			throw error;
		}
		await spawnText(["gpioset", ref.chip, `${ref.line}=${value}`]);
	}
}

function isUnknownCliOption(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /invalid option|unrecognized option|unknown option/i.test(message);
}

async function spawnText(cmd: string[]): Promise<string> {
	const first = await runCmd(gpioCmd(cmd));
	if (first.code === 0) {
		if (gpioEscalate === null) {
			gpioEscalate = false;
		}
		return first.stdout;
	}
	const message =
		first.stderr.trim() || first.stdout.trim() || `${cmd[0]} failed`;
	if (
		gpioEscalate !== true &&
		canEscalateGpio() &&
		isGpioPermissionDenied(message)
	) {
		gpioEscalate = true;
		const retry = await runCmd(privileged(cmd));
		if (retry.code === 0) {
			return retry.stdout;
		}
		throw new GpioError(retry.stderr.trim() || retry.stdout.trim() || message);
	}
	throw new GpioError(message);
}

async function runCmd(
	cmd: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		readPipe(proc.stdout),
		readPipe(proc.stderr),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

async function readPipe(
	stream: ReadableStream<Uint8Array> | number | undefined,
): Promise<string> {
	if (!stream || typeof stream === "number") {
		return "";
	}
	return new Response(stream).text();
}
