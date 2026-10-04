export type ArduinoLayoutSeat =
	| { kind: "gpio"; physical: number }
	| { kind: "label"; name: string }
	| { kind: "gap" };

export type ArduinoHeaderLayout = {
	left: ArduinoLayoutSeat[];
	right: ArduinoLayoutSeat[];
	extra: number[];
};

function gpio(physical: number): ArduinoLayoutSeat {
	return { kind: "gpio", physical };
}

function label(name: string): ArduinoLayoutSeat {
	return { kind: "label", name };
}

const GAP: ArduinoLayoutSeat = { kind: "gap" };

function range(start: number, end: number): ArduinoLayoutSeat[] {
	const seats: ArduinoLayoutSeat[] = [];
	const step = start <= end ? 1 : -1;
	for (let pin = start; pin !== end + step; pin += step) {
		seats.push(gpio(pin));
	}
	return seats;
}

const LAYOUTS: Record<
	string,
	{ left: ArduinoLayoutSeat[]; right: ArduinoLayoutSeat[] }
> = {
	uno: {
		left: [
			label("IOREF"),
			label("RESET"),
			label("3V3"),
			label("5V"),
			label("GND"),
			label("GND"),
			label("VIN"),
			...range(14, 19),
		],
		right: range(13, 0),
	},
	nano: {
		left: [
			gpio(13),
			label("3V3"),
			label("AREF"),
			...range(14, 21),
			label("5V"),
			label("RST"),
			label("GND"),
			label("VIN"),
		],
		right: [
			gpio(12),
			gpio(11),
			gpio(10),
			gpio(9),
			gpio(8),
			gpio(7),
			gpio(6),
			gpio(5),
			gpio(4),
			gpio(3),
			gpio(2),
			label("GND"),
			label("RST"),
			gpio(0),
			gpio(1),
		],
	},
	nano_33_iot: {
		left: [
			gpio(13),
			label("3V3"),
			label("AREF"),
			...range(14, 21),
			label("5V"),
			label("RST"),
			label("GND"),
			label("VIN"),
		],
		right: [
			gpio(12),
			gpio(11),
			gpio(10),
			gpio(9),
			gpio(8),
			gpio(7),
			gpio(6),
			gpio(5),
			gpio(4),
			gpio(3),
			gpio(2),
			label("GND"),
			label("RST"),
			gpio(0),
			gpio(1),
		],
	},
	mega: {
		left: [...range(54, 69)],
		right: range(13, 0),
	},
	mkrwifi1010: {
		left: [label("AREF"), ...range(15, 21)],
		right: range(0, 14),
	},
	mkrzero: {
		left: [label("AREF"), ...range(15, 21)],
		right: range(0, 14),
	},
	mzero: {
		left: [...range(14, 19)],
		right: range(13, 0),
	},
};

function boardKey(board?: string): string | undefined {
	const raw = (board ?? "").trim().toLowerCase();
	if (!raw) {
		return undefined;
	}
	if (raw.includes("mega")) {
		return "mega";
	}
	if (
		raw.includes("nano_33") ||
		raw.includes("nano-33") ||
		raw.includes("nano33")
	) {
		return "nano_33_iot";
	}
	if (raw.includes("nano")) {
		return "nano";
	}
	if (raw.includes("mkrwifi") || raw.includes("mkr_wifi")) {
		return "mkrwifi1010";
	}
	if (raw.includes("mkrzero") || raw.includes("mkr_zero")) {
		return "mkrzero";
	}
	if (raw.includes("mzero") || raw.endsWith(":mzero") || raw === "mzero") {
		return "mzero";
	}
	if (raw.includes("uno")) {
		return "uno";
	}
	return raw;
}

function inferBoard(
	pins: Array<{ physical: number; name?: string }>,
): string | undefined {
	const names = new Set(pins.map((pin) => pin.name ?? ""));
	if (names.has("A15") || pins.some((pin) => pin.physical >= 54)) {
		return "mega";
	}
	if (names.has("A6") && names.has("A7")) {
		return "nano";
	}
	if (names.has("D14") && names.has("A0")) {
		return "mkrwifi1010";
	}
	if (names.has("D13") && names.has("A5") && !names.has("A6")) {
		return "uno";
	}
	return undefined;
}

function padColumns(
	left: ArduinoLayoutSeat[],
	right: ArduinoLayoutSeat[],
): { left: ArduinoLayoutSeat[]; right: ArduinoLayoutSeat[] } {
	const length = Math.max(left.length, right.length);
	return {
		left: [...left, ...Array.from({ length: length - left.length }, () => GAP)],
		right: [
			...right,
			...Array.from({ length: length - right.length }, () => GAP),
		],
	};
}

export function arduinoProxyHeaderLayout(
	pins: Array<{ physical: number; name?: string }>,
	board?: string,
): ArduinoHeaderLayout {
	const key = boardKey(board) ?? inferBoard(pins);
	const known = key ? LAYOUTS[key] : undefined;
	if (known) {
		const used = new Set<number>();
		for (const seat of [...known.left, ...known.right]) {
			if (seat.kind === "gpio") {
				used.add(seat.physical);
			}
		}
		const extra = pins
			.map((pin) => pin.physical)
			.filter((physical) => !used.has(physical))
			.sort((a, b) => a - b);
		return { ...padColumns(known.left, known.right), extra };
	}
	const analog = pins
		.filter((pin) => (pin.name ?? "").startsWith("A"))
		.map((pin) => gpio(pin.physical));
	const digital = pins
		.filter((pin) => !(pin.name ?? "").startsWith("A"))
		.sort((a, b) => a.physical - b.physical)
		.map((pin) => gpio(pin.physical));
	if (analog.length > 0 && digital.length > 0) {
		return { ...padColumns(analog, digital), extra: [] };
	}
	const mid = Math.ceil(pins.length / 2);
	const sorted = [...pins].sort((a, b) => a.physical - b.physical);
	return {
		...padColumns(
			sorted.slice(0, mid).map((pin) => gpio(pin.physical)),
			sorted.slice(mid).map((pin) => gpio(pin.physical)),
		),
		extra: [],
	};
}

export function arduinoLayoutPhysicals(layout: ArduinoHeaderLayout): number[] {
	return [...layout.left, ...layout.right]
		.filter(
			(seat): seat is { kind: "gpio"; physical: number } =>
				seat.kind === "gpio",
		)
		.map((seat) => seat.physical)
		.concat(layout.extra);
}

export function pinByPhysical<T extends { physical: number }>(
	pins: T[],
	physical: number,
): T | undefined {
	return pins.find((pin) => pin.physical === physical);
}
