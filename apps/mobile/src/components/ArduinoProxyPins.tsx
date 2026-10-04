import { Pressable, Text, View } from "react-native";
import type { GpioPinState } from "../lib/api.ts";
import {
	type ArduinoLayoutSeat,
	arduinoProxyHeaderLayout,
	pinByPhysical,
} from "../lib/arduino-layout.ts";
import { useColors } from "../lib/color-mode.tsx";
import { type Messages, type Translate, useT } from "../lib/locale.tsx";

function canDriveGpio(pin: GpioPinState): boolean {
	return pin.type === "gpio" && !pin.reserved && !pin.unresolved;
}

function gpioPinTone(pin: GpioPinState): string {
	if (pin.reserved) {
		return "reserved";
	}
	if (pin.dir === "off") {
		return "idle";
	}
	if (typeof pin.hz === "number") {
		return "tone";
	}
	if (typeof pin.analog === "number" || typeof pin.pwm === "number") {
		return "pwm";
	}
	if (pin.value === 1) {
		return "high";
	}
	if (pin.value === 0) {
		return "low";
	}
	return "idle";
}

function pinStatus(pin: GpioPinState, t: Translate<Messages>): string {
	if (pin.reserved) {
		return t("gpio.reserved");
	}
	if (pin.unresolved) {
		return t("gpio.unresolved");
	}
	if (pin.dir === "off") {
		return t("gpio.offDir");
	}
	if (typeof pin.hz === "number") {
		return t("gpio.toneHz", { n: Math.round(pin.hz) });
	}
	if (typeof pin.analog === "number") {
		return t("gpio.pwmDuty", { n: Math.round(pin.analog) });
	}
	if (typeof pin.pwm === "number") {
		return t("gpio.pwmPct", { n: Math.round(pin.pwm) });
	}
	if (pin.dir === "in" && typeof pin.adc === "number") {
		return t("gpio.adc", { n: pin.adc });
	}
	if (pin.dir === "in") {
		return pin.value === 1
			? t("gpio.inHigh")
			: pin.value === 0
				? t("gpio.inLow")
				: pin.dir;
	}
	if (pin.dir === "out") {
		return pin.value === 1
			? t("gpio.outHigh")
			: pin.value === 0
				? t("gpio.outLow")
				: pin.dir;
	}
	if (pin.value === 1) {
		return t("gpio.high");
	}
	if (pin.value === 0) {
		return t("gpio.low");
	}
	return "—";
}

function seatKey(seat: ArduinoLayoutSeat): string {
	if (seat.kind === "gpio") return `g${seat.physical}`;
	if (seat.kind === "label") return `l${seat.name}`;
	return "gap";
}

export default function ArduinoProxyPins({
	pins,
	busy = false,
	selected,
	onSelect,
	fqbn,
}: {
	pins: GpioPinState[];
	busy?: boolean;
	selected?: number;
	onSelect?: (pin: GpioPinState) => void;
	fqbn?: string;
}) {
	const colors = useColors();
	const t = useT();
	if (pins.length === 0) {
		return (
			<Text style={{ color: colors.muted }}>{t("gpio.waitingProxy")}</Text>
		);
	}
	const layout = arduinoProxyHeaderLayout(pins, fqbn);
	const rows = layout.left.map((left, index) => ({
		left,
		right: layout.right[index] ?? { kind: "gap" as const },
	}));
	return (
		<View style={{ width: "100%", gap: 4 }}>
			<Text style={{ color: colors.muted, textAlign: "center", fontSize: 12 }}>
				USB
			</Text>
			{rows.map((row) => (
				<View
					key={`${seatKey(row.left)}/${seatKey(row.right)}`}
					style={{ flexDirection: "row", alignItems: "stretch", gap: 4 }}
				>
					<LayoutSeat
						seat={row.left}
						pins={pins}
						align="left"
						busy={busy}
						selected={selected}
						onSelect={onSelect}
					/>
					<View
						style={{
							width: 12,
							alignSelf: "stretch",
							backgroundColor: colors.chipBg,
							borderRadius: 4,
						}}
					/>
					<LayoutSeat
						seat={row.right}
						pins={pins}
						align="right"
						busy={busy}
						selected={selected}
						onSelect={onSelect}
					/>
				</View>
			))}
			{layout.extra.length > 0 ? (
				<View style={{ gap: 6, paddingTop: 8 }}>
					<Text style={{ color: colors.muted, fontSize: 12 }}>
						{t("gpio.morePins")}
					</Text>
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							gap: 6,
							width: "100%",
						}}
					>
						{layout.extra.map((physical) => {
							const pin = pinByPhysical(pins, physical);
							if (!pin) {
								return null;
							}
							return (
								<PinButton
									key={physical}
									pin={pin}
									align="right"
									busy={busy}
									selected={selected === pin.physical}
									onSelect={onSelect}
								/>
							);
						})}
					</View>
				</View>
			) : null}
		</View>
	);
}

function LayoutSeat({
	seat,
	pins,
	align,
	busy,
	selected,
	onSelect,
}: {
	seat: ArduinoLayoutSeat;
	pins: GpioPinState[];
	align: "left" | "right";
	busy: boolean;
	selected?: number;
	onSelect?: (pin: GpioPinState) => void;
}) {
	const colors = useColors();
	if (seat.kind === "gap") {
		return <View style={{ flex: 1, minWidth: 0 }} />;
	}
	if (seat.kind === "label") {
		return (
			<Text
				numberOfLines={1}
				style={{
					flex: 1,
					minWidth: 0,
					color: colors.muted,
					fontSize: 11,
					paddingHorizontal: 4,
					paddingVertical: 4,
					textAlign: align === "left" ? "right" : "left",
					fontFamily: "monospace",
				}}
			>
				{seat.name}
			</Text>
		);
	}
	const pin = pinByPhysical(pins, seat.physical);
	if (!pin) {
		return <View style={{ flex: 1, minWidth: 0 }} />;
	}
	return (
		<PinButton
			pin={pin}
			align={align}
			busy={busy}
			selected={selected === pin.physical}
			onSelect={onSelect}
		/>
	);
}

function PinButton({
	pin,
	align,
	busy,
	selected,
	onSelect,
}: {
	pin: GpioPinState;
	align: "left" | "right";
	busy: boolean;
	selected: boolean;
	onSelect?: (pin: GpioPinState) => void;
}) {
	const colors = useColors();
	const t = useT();
	const tone = gpioPinTone(pin);
	const locked = busy || !canDriveGpio(pin);
	const status = pinStatus(pin, t);
	const toneColor: Record<string, string> = {
		reserved: colors.border,
		pwm: colors.primary,
		tone: colors.primary,
		high: colors.success,
		low: colors.muted,
		idle: colors.border,
	};
	const dot = (
		<View
			style={{
				width: 8,
				height: 8,
				borderRadius: 4,
				backgroundColor: toneColor[tone] ?? colors.border,
			}}
		/>
	);
	return (
		<Pressable
			disabled={locked}
			onPress={() => onSelect?.(pin)}
			style={{
				flex: 1,
				minWidth: 0,
				opacity: locked ? 0.5 : 1,
				borderWidth: selected ? 2 : 1,
				borderColor: selected ? colors.primary : colors.border,
				backgroundColor: selected ? colors.chipBg : colors.surface,
				borderRadius: 8,
				paddingVertical: 4,
				paddingHorizontal: 6,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: align === "left" ? "flex-end" : "flex-start",
				gap: 4,
			}}
		>
			{align === "right" ? dot : null}
			<Text
				numberOfLines={1}
				style={{
					color: colors.text,
					fontFamily: "monospace",
					fontSize: 11,
					flexShrink: 1,
				}}
			>
				{pin.name || `D${pin.physical}`}
				{status !== "—" ? `  ${status}` : ""}
			</Text>
			{align === "left" ? dot : null}
		</Pressable>
	);
}
