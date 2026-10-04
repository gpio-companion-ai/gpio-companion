import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import type { GpioPinState } from "../api";
import {
	type ArduinoLayoutSeat,
	arduinoProxyHeaderLayout,
	pinByPhysical,
} from "../arduino-layout";
import { gpioPinStatusLabel } from "../lib/i18n-labels";
import { useT } from "../locale";

const TONE_BG: Record<string, string> = {
	reserved: "bg-surface",
	pwm: "bg-info",
	tone: "bg-info",
	high: "bg-success",
	low: "bg-secondary",
	idle: "bg-surface",
};

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
	const t = useT();
	if (pins.length === 0) {
		return (
			<Typography color="secondary" variant="body2">
				{t("gpio.waitingProxy")}
			</Typography>
		);
	}
	const layout = arduinoProxyHeaderLayout(pins, fqbn);
	const rows = layout.left.map((left, index) => ({
		left,
		right: layout.right[index] ?? { kind: "gap" as const },
	}));
	return (
		<Stack spacing={0.5} sx={{ width: "100%", minWidth: 0, maxWidth: "100%" }}>
			<Typography
				variant="caption"
				color="secondary"
				sx={{ width: "100%", textAlign: "center" }}
			>
				{t("gpio.usb")}
			</Typography>
			{rows.map((row) => (
				<Stack
					key={`${seatKey(row.left)}/${seatKey(row.right)}`}
					direction="row"
					spacing={0.5}
					sx={{ minWidth: 0, alignItems: "stretch" }}
				>
					<LayoutSeat
						seat={row.left}
						pins={pins}
						align="left"
						busy={busy}
						selected={selected}
						onSelect={onSelect}
					/>
					<Box
						aria-hidden
						sx={{
							width: 12,
							flexShrink: 0,
							alignSelf: "stretch",
							bgcolor: "bg-surface",
							borderRadius: 0.5,
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
				</Stack>
			))}
			{layout.extra.length > 0 ? (
				<Stack spacing={0.5} sx={{ pt: 1 }}>
					<Typography variant="caption" color="secondary">
						{t("gpio.morePins")}
					</Typography>
					<Box
						sx={{
							display: "grid",
							width: "100%",
							minWidth: 0,
							gridTemplateColumns: "repeat(auto-fill, minmax(4.25rem, 1fr))",
							gap: 1,
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
					</Box>
				</Stack>
			) : null}
		</Stack>
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
	if (seat.kind === "gap") {
		return <Box sx={{ minWidth: 0, flex: 1 }} />;
	}
	if (seat.kind === "label") {
		return (
			<Typography
				variant="caption"
				color="secondary"
				noWrap
				sx={{
					minWidth: 0,
					flex: 1,
					px: 1,
					py: 0.5,
					textAlign: align === "left" ? "right" : "left",
				}}
			>
				{seat.name}
			</Typography>
		);
	}
	const pin = pinByPhysical(pins, seat.physical);
	if (!pin) {
		return <Box sx={{ minWidth: 0, flex: 1 }} />;
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
	const t = useT();
	const selectable = canDriveGpio(pin);
	const tone = gpioPinTone(pin);
	const status = gpioPinStatusLabel(pin, t);
	const content = (
		<Stack
			direction="row"
			spacing={0.5}
			sx={{
				width: "100%",
				minWidth: 0,
				alignItems: "center",
				justifyContent: align === "left" ? "flex-end" : "flex-start",
			}}
		>
			{align === "right" ? (
				<Box
					aria-hidden
					className={TONE_BG[tone] ?? "bg-surface"}
					sx={{
						width: 10,
						height: 10,
						flexShrink: 0,
						borderRadius: "50%",
						border: "1px solid rgba(var(--text-main), 0.24)",
					}}
				/>
			) : null}
			<Typography
				noWrap
				variant="caption"
				sx={{
					minWidth: 0,
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				}}
			>
				{pin.name || `D${pin.physical}`}
				{status !== "—" ? `  ${status}` : ""}
			</Typography>
			{align === "left" ? (
				<Box
					aria-hidden
					className={TONE_BG[tone] ?? "bg-surface"}
					sx={{
						width: 10,
						height: 10,
						flexShrink: 0,
						borderRadius: "50%",
						border: "1px solid rgba(var(--text-main), 0.24)",
					}}
				/>
			) : null}
		</Stack>
	);
	if (!selectable) {
		return (
			<Box
				sx={{
					minWidth: 0,
					flex: 1,
					px: 1,
					py: 0.5,
					opacity: 0.85,
					borderRadius: 1,
					outline: selected
						? "2px solid rgb(var(--text-primary))"
						: "2px solid transparent",
				}}
			>
				{content}
			</Box>
		);
	}
	return (
		<Button
			type="button"
			variant="text"
			size="small"
			disabled={busy}
			aria-label={t("gpio.pinAria", {
				physical: pin.physical,
				label: pin.name || status,
				tone,
			})}
			aria-pressed={selected}
			onClick={() => onSelect?.(pin)}
			sx={{
				minWidth: 0,
				flex: 1,
				textTransform: "none",
				justifyContent: align === "left" ? "flex-end" : "flex-start",
				outline: selected
					? "2px solid rgb(var(--text-primary))"
					: "2px solid transparent",
			}}
		>
			{content}
		</Button>
	);
}
