import { arduinoProxyBoard, arduinoProxyPins } from "./arduino-proxy.ts";
import { arduinoProxyHeaderLayout } from "./arduino-proxy-layout.ts";
import {
	BREADBOARD_PITCH,
	GPIO_ARDUINO_PROXY_TYPE,
	type Point,
} from "./breadboard.ts";

export { GPIO_ARDUINO_PROXY_TYPE };

export type ArduinoProxyPadKind = "gpio" | "power" | "gnd" | "label";

export type ArduinoProxyPad = {
	name: string;
	aliases: string[];
	label: string;
	kind: ArduinoProxyPadKind;
	physical?: number;
	column: "left" | "right";
	extra?: boolean;
	row: number;
};

export type ArduinoProxyBoardLayout = {
	pads: ArduinoProxyPad[];
	width: number;
	height: number;
	extraOrigin: number;
	mainRows: number;
};

const LEFT_X = BREADBOARD_PITCH * 2.4;
const RIGHT_X = BREADBOARD_PITCH * 11.6;
const WIDTH = BREADBOARD_PITCH * 14;
const ORIGIN_Y = BREADBOARD_PITCH * 2.2;

export function isArduinoProxyPartType(type: string): boolean {
	return type === GPIO_ARDUINO_PROXY_TYPE;
}

export function arduinoProxyBoardTitle(board?: string): string {
	const resolved = arduinoProxyBoard(board ?? "");
	if (resolved) {
		return resolved.name;
	}
	const raw = (board ?? "").trim();
	return raw || "Arduino";
}

export function arduinoProxyBoardLayout(
	board?: string,
): ArduinoProxyBoardLayout {
	const resolved = arduinoProxyBoard(board ?? "");
	const pins = resolved ? arduinoProxyPins(resolved) : [];
	const layout = arduinoProxyHeaderLayout(pins, board);
	// The Live GPIO layout contains signal pins only on Mega. Wiring maps
	// also need the power-header sockets so GND/5V jumpers have real endpoints.
	if (resolved?.id === "mega") {
		layout.left.push(
			...(["IOREF", "RESET", "3V3", "5V", "GND", "GND", "VIN"] as const).map(
				(name) => ({ kind: "label" as const, name }),
			),
		);
	}
	const byPhysical = new Map(pins.map((pin) => [pin.physical, pin]));
	const used = new Map<string, number>();
	const pads: ArduinoProxyPad[] = [];
	const rows = Math.max(layout.left.length, layout.right.length);
	for (let row = 0; row < rows; row += 1) {
		const left = layout.left[row];
		const right = layout.right[row];
		if (left) {
			const pad = seatPad(left, "left", row, false, byPhysical, used);
			if (pad) {
				pads.push(pad);
			}
		}
		if (right) {
			const pad = seatPad(right, "right", row, false, byPhysical, used);
			if (pad) {
				pads.push(pad);
			}
		}
	}
	for (const [index, physical] of layout.extra.entries()) {
		pads.push(
			gpioPad(
				physical,
				byPhysical.get(physical)?.name,
				index % 2 === 0 ? "left" : "right",
				Math.floor(index / 2),
				true,
			),
		);
	}
	const mainRows =
		Math.max(
			0,
			...pads.filter((pad) => !pad.extra).map((pad) => pad.row + 1),
		) || 1;
	const extraRows = Math.max(
		0,
		...pads.filter((pad) => pad.extra).map((pad) => pad.row + 1),
	);
	const extraOrigin = extraRows
		? ORIGIN_Y + BREADBOARD_PITCH * (mainRows + 1.2)
		: ORIGIN_Y + BREADBOARD_PITCH * mainRows;
	return {
		pads,
		width: WIDTH,
		height: extraOrigin + BREADBOARD_PITCH * (extraRows + 0.8),
		extraOrigin,
		mainRows,
	};
}

export function arduinoProxyPads(board?: string): ArduinoProxyPad[] {
	return arduinoProxyBoardLayout(board).pads;
}

export function arduinoProxyBoardSize(board?: string): {
	width: number;
	height: number;
} {
	const layout = arduinoProxyBoardLayout(board);
	return { width: layout.width, height: layout.height };
}

export function arduinoProxyPinOffset(
	board: string | undefined,
	pin: string,
): Point | null {
	const layout = arduinoProxyBoardLayout(board);
	const pad = resolvePad(layout.pads, pin);
	if (!pad) {
		return null;
	}
	return padOffset(layout, pad);
}

export function arduinoProxyPadOffset(
	board: string | undefined,
	pad: ArduinoProxyPad,
): Point {
	return padOffset(arduinoProxyBoardLayout(board), pad);
}

export function arduinoProxyResolvePad(
	board: string | undefined,
	pin: string,
): ArduinoProxyPad | undefined {
	return resolvePad(arduinoProxyPads(board), pin);
}

function padOffset(
	layout: ArduinoProxyBoardLayout,
	pad: ArduinoProxyPad,
): Point {
	return {
		x: pad.column === "right" ? RIGHT_X : LEFT_X,
		y: pad.extra
			? layout.extraOrigin + pad.row * BREADBOARD_PITCH
			: ORIGIN_Y + pad.row * BREADBOARD_PITCH,
	};
}

function resolvePad(
	pads: ArduinoProxyPad[],
	pin: string,
): ArduinoProxyPad | undefined {
	const needle = normalizePin(pin);
	if (!needle) {
		return undefined;
	}
	return pads.find((pad) =>
		pad.aliases.some((alias) => normalizePin(alias) === needle),
	);
}

function seatPad(
	seat:
		| { kind: "gpio"; physical: number }
		| { kind: "label"; name: string }
		| { kind: "gap" },
	column: "left" | "right",
	row: number,
	extra: boolean,
	byPhysical: Map<number, { physical: number; name: string }>,
	used: Map<string, number>,
): ArduinoProxyPad | null {
	if (seat.kind === "gap") {
		return null;
	}
	if (seat.kind === "gpio") {
		return gpioPad(
			seat.physical,
			byPhysical.get(seat.physical)?.name,
			column,
			row,
			extra,
		);
	}
	return labelPad(seat.name, column, row, extra, used);
}

function gpioPad(
	physical: number,
	rawName: string | undefined,
	column: "left" | "right",
	row: number,
	extra: boolean,
): ArduinoProxyPad {
	const label = rawName?.trim() || `D${physical}`;
	const aliases = new Set<string>([String(physical), label]);
	const digital = /^D(\d+)$/i.exec(label);
	if (digital?.[1]) {
		aliases.add(digital[1]);
	}
	const analog = /^A(\d+)$/i.exec(label);
	if (analog) {
		aliases.add(analog[0].toUpperCase());
	}
	const gpio = /^GPIO(\d+)$/i.exec(label);
	if (gpio?.[1]) {
		aliases.add(gpio[1]);
	}
	return {
		name: String(physical),
		aliases: [...aliases],
		label,
		kind: "gpio",
		physical,
		column,
		extra: extra || undefined,
		row,
	};
}

function labelPad(
	raw: string,
	column: "left" | "right",
	row: number,
	extra: boolean,
	used: Map<string, number>,
): ArduinoProxyPad {
	const fallback = raw.trim() || "PIN";
	const base = fallback.toUpperCase().replace("3.3V", "3V3");
	const count = used.get(base) ?? 0;
	used.set(base, count + 1);
	const name =
		count === 0
			? canonicalLabel(base, fallback)
			: `${canonicalLabel(base, fallback)}.${count + 1}`;
	const aliases = new Set<string>([name, fallback, base]);
	if (base === "3V3" || base === "3.3V") {
		aliases.add("3V3");
		aliases.add("3.3V");
	}
	if (base === "RST") {
		aliases.add("RESET");
	}
	if (base === "RESET") {
		aliases.add("RST");
	}
	return {
		name,
		aliases: [...aliases],
		label: name,
		kind: padKind(base),
		column,
		extra: extra || undefined,
		row,
	};
}

function canonicalLabel(base: string, fallback: string): string {
	if (base === "3.3V" || base === "3V3") {
		return "3V3";
	}
	if (
		base === "5V" ||
		base === "GND" ||
		base === "VIN" ||
		base === "IOREF" ||
		base === "RESET" ||
		base === "RST" ||
		base === "AREF"
	) {
		return base;
	}
	return fallback;
}

function padKind(base: string): ArduinoProxyPadKind {
	if (base === "GND") {
		return "gnd";
	}
	if (base === "5V" || base === "VIN" || base === "3V3" || base === "3.3V") {
		return "power";
	}
	return "label";
}

function normalizePin(pin: string): string {
	return pin
		.trim()
		.toUpperCase()
		.replace(/^D(?=\d)/, "")
		.replace("3.3V", "3V3");
}
