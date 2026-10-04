import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	type ArduinoLayoutSeat,
	arduinoProxyHeaderLayout,
	canDriveGpio,
	type GpioPinState,
	gpioPinTone,
	pinByPhysical,
} from "gpio-companion";
import { useT } from "../hooks/useLocale.tsx";
import { gpioStatusText } from "./GpioHeader.tsx";

const TONE_BG: Record<string, string> = {
	reserved: "bg-surface",
	pwm: "bg-info",
	tone: "bg-info",
	high: "bg-success",
	low: "bg-secondary",
	idle: "bg-surface",
};

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
		<Stack spacing={0.5} className="w-full min-w-0 max-w-full font-mono">
			<Typography
				variant="caption"
				color="secondary"
				className="w-full text-center"
			>
				USB
			</Typography>
			{rows.map((row) => (
				<Stack
					key={`${seatKey(row.left)}/${seatKey(row.right)}`}
					direction="row"
					spacing={0.5}
					className="min-w-0 items-stretch"
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
						className="w-3 shrink-0 self-stretch bg-surface"
						sx={{ borderRadius: 0.5 }}
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
				<Stack spacing={0.5} className="pt-2">
					<Typography variant="caption" color="secondary">
						{t("gpio.morePins")}
					</Typography>
					<Box className="grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1">
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
		return <Box className="min-w-0" sx={{ flex: 1, minWidth: 0 }} />;
	}
	if (seat.kind === "label") {
		return (
			<Typography
				variant="caption"
				color="secondary"
				noWrap
				className={
					align === "left"
						? "min-w-0 px-1 py-0.5 text-right"
						: "min-w-0 px-1 py-0.5 text-left"
				}
				sx={{ flex: 1, minWidth: 0 }}
			>
				{seat.name}
			</Typography>
		);
	}
	const pin = pinByPhysical(pins, seat.physical);
	if (!pin) {
		return <Box className="min-w-0" sx={{ flex: 1, minWidth: 0 }} />;
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
	const status = gpioStatusText(t, pin);
	const content = (
		<Stack
			direction="row"
			spacing={0.5}
			alignItems="center"
			justifyContent={align === "left" ? "flex-end" : "flex-start"}
			sx={{ width: "100%", minWidth: 0 }}
		>
			{align === "right" ? (
				<Box
					aria-hidden
					className={`size-2.5 shrink-0 rounded-full ${TONE_BG[tone] ?? "bg-surface"}`}
					sx={{ border: "1px solid rgba(var(--text-main), 0.24)" }}
				/>
			) : null}
			<Typography variant="caption" noWrap className="min-w-0">
				{pin.name || `D${pin.physical}`}
				{status !== "—" ? `  ${status}` : ""}
			</Typography>
			{align === "left" ? (
				<Box
					aria-hidden
					className={`size-2.5 shrink-0 rounded-full ${TONE_BG[tone] ?? "bg-surface"}`}
					sx={{ border: "1px solid rgba(var(--text-main), 0.24)" }}
				/>
			) : null}
		</Stack>
	);
	if (!selectable) {
		return (
			<Box
				className="min-w-0 px-1 py-0.5"
				sx={{
					flex: 1,
					minWidth: 0,
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
				label: pin.name || `D${pin.physical}`,
				tone,
			})}
			aria-pressed={selected}
			onClick={() => onSelect?.(pin)}
			className="min-w-0"
			sx={{
				flex: 1,
				minWidth: 0,
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
