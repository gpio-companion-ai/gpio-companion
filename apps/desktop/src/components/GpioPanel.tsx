import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { useCallback, useRef, useState } from "react";
import {
	bleGpio,
	type GpioPinState,
	type GpioSnapshot,
	type GpioTarget,
	loadGpio,
	putGpio,
} from "../api";
import { useSavedBleId } from "../hooks/useApiCache";
import { useGpioTunnel } from "../hooks/useGpioTunnel";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey";
import { gpioPinStatusLabel } from "../lib/i18n-labels";
import { useT } from "../locale";
import ArduinoProxyPins from "./ArduinoProxyPins";
import GpioHeader from "./GpioHeader";

function canDriveGpio(pin: GpioPinState): boolean {
	return pin.type === "gpio" && !pin.reserved && !pin.unresolved;
}

function liveValues(snapshot: GpioSnapshot | null): Record<number, 0 | 1> {
	const pins: Record<number, 0 | 1> = {};
	for (const pin of snapshot?.pins ?? []) {
		if (pin.type === "gpio" && (pin.value === 0 || pin.value === 1)) {
			pins[pin.physical] = pin.value;
		}
	}
	return pins;
}

type GpioCommand = {
	physical: number;
	dir?: "in" | "out" | "pwm" | "off";
	value?: 0 | 1;
	analog?: number;
	op?: "tone" | "notone";
	hz?: number;
	target?: GpioTarget;
};

function applyCommand(
	snapshot: GpioSnapshot,
	command: GpioCommand,
): GpioSnapshot {
	return {
		...snapshot,
		pins: snapshot.pins.map((pin) => {
			if (pin.physical !== command.physical) {
				return pin;
			}
			if (command.op === "notone") {
				const next = { ...pin, dir: "in" as const };
				delete next.hz;
				delete next.analog;
				delete next.pwm;
				return next;
			}
			if (command.op === "tone") {
				const next = { ...pin, dir: "out" as const, hz: command.hz };
				delete next.analog;
				delete next.pwm;
				return next;
			}
			if (command.dir === "pwm") {
				const analog = command.analog ?? 0;
				const next = {
					...pin,
					dir: "pwm" as const,
					analog,
					pwm: Math.round((analog / 255) * 1000) / 10,
					value: analog >= 128 ? (1 as const) : (0 as const),
				};
				delete next.hz;
				return next;
			}
			if (command.dir === "off") {
				const next = { ...pin, dir: "off" as const };
				delete next.value;
				delete next.analog;
				delete next.pwm;
				delete next.hz;
				if (typeof next.adc === "number") {
					next.adc = 0;
				}
				return next;
			}
			if (command.dir === "in") {
				const next = { ...pin, dir: "in" as const };
				delete next.analog;
				delete next.pwm;
				delete next.hz;
				return next;
			}
			const next = {
				...pin,
				dir: "out" as const,
				value: command.value ?? 0,
			};
			delete next.analog;
			delete next.pwm;
			delete next.hz;
			return next;
		}),
	};
}

export default function GpioPanel({
	uuid,
	connected,
	poll = false,
	onLivePins,
	onRetry,
}: {
	uuid: string;
	connected?: boolean;
	poll?: boolean;
	onLivePins?: (pins: Record<number, 0 | 1>, target?: GpioTarget) => void;
	onRetry?: () => void;
}) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [snapshot, setSnapshot] = useState<GpioSnapshot | null>(null);
	const [selected, setSelected] = useState<number | undefined>();
	const [target, setTarget] = useState<GpioTarget>("header");
	const snapshotRef = useRef<GpioSnapshot | null>(null);
	const pwmTimer = useRef(0);
	const offline = useOfflineBleKey(uuid);
	const bleId = useSavedBleId(uuid);
	const available = Boolean(uuid) && connected !== false;
	const pins = snapshot?.pins ?? [];
	const selectedPin = pins.find((pin) => pin.physical === selected);
	const sketchReadOnly = target === "header" && (snapshot?.sketch ?? false);
	const livePinsRef = useRef("");
	const onGpio = useCallback(
		(next: GpioSnapshot) => {
			snapshotRef.current = next;
			setSnapshot(next);
			const live = liveValues(next);
			const key = `${next?.target ?? "header"}:${JSON.stringify(live)}`;
			if (key !== livePinsRef.current) {
				livePinsRef.current = key;
				onLivePins?.(live, next?.target ?? "header");
			}
		},
		[onLivePins],
	);
	const tunnel = useGpioTunnel(poll && available ? uuid : "", onGpio, setError);

	function applySnapshot(next: GpioSnapshot | null) {
		snapshotRef.current = next;
		setSnapshot(next);
		const live = liveValues(next);
		const key = `${next?.target ?? "header"}:${JSON.stringify(live)}`;
		if (key !== livePinsRef.current) {
			livePinsRef.current = key;
			onLivePins?.(live, next?.target ?? "header");
		}
	}

	function start(task: () => Promise<GpioSnapshot>) {
		setBusy(true);
		setError("");
		void task()
			.then(applySnapshot)
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => setBusy(false));
	}

	function drive(command: GpioCommand) {
		const next = target === "arduino-proxy" ? { ...command, target } : command;
		if (sketchReadOnly) {
			setError(t("gpio.sketchReadOnly"));
			return;
		}
		const current = snapshotRef.current;
		if (current) {
			applySnapshot(applyCommand(current, next));
		}
		if (poll) {
			setError("");
			if (!tunnel.drive(next)) {
				setError("live gpio websocket is not connected");
			}
			return;
		}
		start(() => putGpio({ uuid, ...next }));
	}

	if (!available) {
		return (
			<Stack spacing={1} sx={{ mt: 1 }}>
				<Typography variant="subtitle2">{t("gpio.title")}</Typography>
				<Alert severity="info">{t("gpio.notConnected")}</Alert>
				{poll && uuid && onRetry ? (
					<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
						<Button
							type="button"
							variant="outlined"
							size="small"
							onClick={onRetry}
						>
							{t("gpio.refresh")}
						</Button>
					</Stack>
				) : null}
			</Stack>
		);
	}

	return (
		<Stack spacing={1} sx={{ mt: 1, minWidth: 0 }}>
			<Stack
				direction="row"
				spacing={1}
				sx={{
					flexWrap: "wrap",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Typography variant="subtitle2">
					{poll ? t("gpio.live") : t("gpio.title")}
				</Typography>
				{poll ? (
					<LiveChip status={tunnel.status} ready={Boolean(snapshot)} />
				) : null}
			</Stack>
			{uuid ? (
				<Typography variant="body2" color="secondary">
					{offline.label}
				</Typography>
			) : null}
			{poll ? (
				<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
					<Button
						type="button"
						size="small"
						variant={target === "header" ? "contained" : "outlined"}
						onClick={() => {
							setTarget("header");
							setSelected(undefined);
							tunnel.refresh("header");
						}}
					>
						{t("gpio.companion")}
					</Button>
					<Button
						type="button"
						size="small"
						variant={target === "arduino-proxy" ? "contained" : "outlined"}
						onClick={() => {
							setTarget("arduino-proxy");
							setSelected(undefined);
							tunnel.refresh("arduino-proxy");
						}}
					>
						{t("gpio.arduino")}
					</Button>
				</Stack>
			) : null}
			{poll ? (
				<Typography variant="body2" color="secondary">
					{snapshot
						? target === "arduino-proxy"
							? t("gpio.proxyHint")
							: t("gpio.tapHint")
						: t("gpio.waiting")}
				</Typography>
			) : null}
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<Button
					variant="outlined"
					size="small"
					disabled={busy || !uuid}
					onClick={() => {
						if (poll) {
							setError("");
							if (!tunnel.refresh(target)) {
								setError("live gpio websocket is not connected");
							}
							return;
						}
						start(() => loadGpio(uuid));
					}}
				>
					{busy
						? t("common.loading")
						: snapshot || poll
							? t("gpio.refresh")
							: t("gpio.load")}
				</Button>
				{poll ? null : (
					<Button
						variant="outlined"
						size="small"
						disabled={busy || !uuid}
						onClick={() => {
							start(() => bleGpio({ uuid, id: bleId }));
						}}
					>
						{t("gpio.loadOverBle")}
					</Button>
				)}
			</Stack>
			{error ? (
				<Alert severity="error">{translateError(t, error)}</Alert>
			) : null}
			{sketchReadOnly ? (
				<Alert severity="warning">{t("gpio.sketchReadOnly")}</Alert>
			) : null}
			{poll || snapshot ? (
				target === "arduino-proxy" ? (
					<ArduinoProxyPins
						pins={pins}
						busy={busy}
						selected={selected}
						fqbn={snapshot?.proxy?.fqbn}
						onSelect={(pin) => setSelected(pin.physical)}
					/>
				) : (
					<GpioHeader
						pins={pins}
						busy={busy}
						interactive={Boolean(snapshot)}
						selected={selected}
						onSelect={(pin) => setSelected(pin.physical)}
					/>
				)
			) : (
				<Typography color="secondary" variant="body2">
					{t("gpio.loadToSee")}
				</Typography>
			)}
			{snapshot ? (
				<GpioPinActions
					pin={selectedPin}
					busy={busy}
					readOnly={sketchReadOnly}
					onDrive={drive}
					onPwm={(physical, analog) => {
						if (sketchReadOnly) {
							setError(t("gpio.sketchReadOnly"));
							return;
						}
						const command: GpioCommand = {
							physical,
							dir: "pwm",
							analog,
							...(target === "arduino-proxy" ? { target } : {}),
						};
						const current = snapshotRef.current;
						if (current) {
							applySnapshot(applyCommand(current, command));
						}
						window.clearTimeout(pwmTimer.current);
						pwmTimer.current = window.setTimeout(() => {
							if (poll) {
								setError("");
								if (!tunnel.drive(command)) {
									setError("live gpio websocket is not connected");
								}
								return;
							}
							drive(command);
						}, 150);
					}}
				/>
			) : null}
		</Stack>
	);
}

function LiveChip({
	status,
	ready,
}: {
	status: "idle" | "connecting" | "live" | "reconnecting";
	ready: boolean;
}) {
	const t = useT();
	if (status === "reconnecting") {
		return (
			<Chip
				label={t("gpio.reconnecting")}
				size="small"
				color="warning"
				variant="outlined"
			/>
		);
	}
	if (status === "connecting" || !ready) {
		return (
			<Chip
				label={
					status === "connecting" ? t("gpio.connecting") : t("gpio.waitingChip")
				}
				size="small"
				color="secondary"
				variant="outlined"
			/>
		);
	}
	return (
		<Chip
			label={t("gpio.liveChip")}
			size="small"
			color="success"
			variant="outlined"
		/>
	);
}

function GpioPinActions({
	pin,
	busy,
	readOnly,
	onDrive,
	onPwm,
}: {
	pin: GpioPinState | undefined;
	busy: boolean;
	readOnly?: boolean;
	onDrive: (command: GpioCommand) => void;
	onPwm: (physical: number, analog: number) => void;
}) {
	const t = useT();
	if (!pin) {
		return (
			<Typography color="secondary" variant="body2">
				{t("gpio.tapToDrive")}
			</Typography>
		);
	}
	const locked = readOnly || !canDriveGpio(pin);
	const analog = typeof pin.analog === "number" ? pin.analog : 128;
	return (
		<Stack spacing={1}>
			<Stack
				direction="row"
				spacing={1}
				sx={{ flexWrap: "wrap", alignItems: "center" }}
			>
				<Typography variant="body2">
					{t("gpio.pin", { n: pin.physical, name: pin.name })}
				</Typography>
				<PinStatusChip pin={pin} />
			</Stack>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() => onDrive({ physical: pin.physical, dir: "in" })}
				>
					{t("gpio.in")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() => onDrive({ physical: pin.physical, dir: "off" })}
				>
					{t("gpio.off")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() =>
						onDrive({ physical: pin.physical, dir: "out", value: 1 })
					}
				>
					{t("gpio.setHigh")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() =>
						onDrive({ physical: pin.physical, dir: "out", value: 0 })
					}
				>
					{t("gpio.setLow")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() =>
						onDrive({ physical: pin.physical, dir: "pwm", analog })
					}
				>
					{t("gpio.pwm")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={busy || locked}
					onClick={() =>
						onDrive(
							typeof pin.hz === "number"
								? { physical: pin.physical, op: "notone" }
								: { physical: pin.physical, op: "tone", hz: 440 },
						)
					}
				>
					{typeof pin.hz === "number" ? t("gpio.stopTone") : t("gpio.tone")}
				</Button>
			</Stack>
			{typeof pin.analog === "number" ? (
				<PwmDutyControl
					key={pin.physical}
					physical={pin.physical}
					analog={pin.analog}
					disabled={busy || locked}
					onPwm={onPwm}
				/>
			) : null}
		</Stack>
	);
}

function PwmDutyControl({
	physical,
	analog,
	disabled,
	onPwm,
}: {
	physical: number;
	analog: number;
	disabled: boolean;
	onPwm: (physical: number, analog: number) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<Stack
			direction="row"
			spacing={1}
			sx={{ flexWrap: "wrap", alignItems: "center" }}
		>
			<input
				type="range"
				min={0}
				max={255}
				value={analog}
				disabled={disabled}
				aria-label={t("gpio.pinPwmAria", { n: physical })}
				style={{ flex: 1, minWidth: 0 }}
				onChange={(event) => {
					const next = parsePwmAnalog(event.target.value);
					if (next === undefined) {
						return;
					}
					setDraft(null);
					onPwm(physical, next);
				}}
			/>
			<input
				type="number"
				min={0}
				max={255}
				step={1}
				inputMode="numeric"
				value={draft ?? analog}
				disabled={disabled}
				aria-label={t("gpio.pinPwmValueAria", { n: physical })}
				style={{ width: "4rem" }}
				onChange={(event) => {
					const raw = event.target.value;
					setDraft(raw);
					const next = parsePwmAnalog(raw);
					if (next === undefined) {
						return;
					}
					onPwm(physical, next);
				}}
				onBlur={() => setDraft(null)}
			/>
		</Stack>
	);
}

function parsePwmAnalog(raw: string): number | undefined {
	if (!/^\d+$/.test(raw)) {
		return undefined;
	}
	const next = Number(raw);
	if (next < 0 || next > 255) {
		return undefined;
	}
	return next;
}

function PinStatusChip({ pin }: { pin: GpioPinState }) {
	const t = useT();
	const label = gpioPinStatusLabel(pin, t);
	if (pin.reserved || pin.unresolved || label === "—") {
		return <Chip label={label} size="small" variant="outlined" />;
	}
	if (
		typeof pin.hz === "number" ||
		typeof pin.analog === "number" ||
		(pin.dir === "in" && typeof pin.adc === "number")
	) {
		return (
			<Chip label={label} size="small" color="primary" variant="outlined" />
		);
	}
	if (pin.value === 1) {
		return (
			<Chip label={label} size="small" color="success" variant="outlined" />
		);
	}
	return (
		<Chip label={label} size="small" color="secondary" variant="outlined" />
	);
}
