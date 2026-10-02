import { POST as signGpio } from "@api/device/gpio";
import { GET as loadGpio, PUT as putGpio } from "@api/gpio";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	applyGpioApply,
	BLE_CMD_UUID,
	BLE_DEVICE_NAME,
	canDriveGpio,
	envelopeToPasteText,
	GPIO_PATH,
	type GpioApply,
	type GpioPinState,
	type GpioSnapshot,
	type GpioTarget,
	gpioLiveValues,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useCallback, useRef, useState } from "react";
import { useGpioTunnel } from "../hooks/useGpioTunnel.ts";
import { useT } from "../hooks/useLocale.tsx";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey.ts";
import { unwrapAction } from "../lib/action.ts";
import { withOfflineSign } from "../lib/offline-ble.ts";
import {
	bluetoothChooserCancelled,
	bluetoothSupported,
	connectGpioCompanionBle,
} from "../lib/web-bluetooth.ts";
import ArduinoProxyPins from "./ArduinoProxyPins.tsx";
import CopyBlock from "./CopyBlock.tsx";
import GpioHeader, { gpioStatusText } from "./GpioHeader.tsx";

export default function GpioPanel({
	uuid,
	poll = false,
	connected,
	onSnapshot,
	onLivePins,
	onRetry,
}: {
	uuid: string;
	poll?: boolean;
	connected?: boolean;
	onSnapshot?: (snapshot: GpioSnapshot | null) => void;
	onLivePins?: (pins: Record<number, 0 | 1>, target?: GpioTarget) => void;
	onRetry?: () => void;
}) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [snapshot, setSnapshot] = useState<GpioSnapshot | null>(null);
	const [selected, setSelected] = useState<number | undefined>();
	const [target, setTarget] = useState<GpioTarget>("header");
	const [pasteText, setPasteText] = useState("");
	const livePinsRef = useRef("");
	const snapshotRef = useRef<GpioSnapshot | null>(null);
	const pwmTimer = useRef(0);
	const supported = bluetoothSupported();
	const offline = useOfflineBleKey(uuid);
	const available = Boolean(uuid) && connected !== false;

	const applySnapshot = useCallback(
		(next: GpioSnapshot | null) => {
			snapshotRef.current = next;
			setSnapshot(next);
			onSnapshot?.(next);
			const live = gpioLiveValues(next);
			const key = `${next?.target ?? "header"}:${JSON.stringify(live)}`;
			if (key !== livePinsRef.current) {
				livePinsRef.current = key;
				onLivePins?.(live, next?.target ?? "header");
			}
		},
		[onSnapshot, onLivePins],
	);

	function start(task: () => Promise<void>) {
		setBusy(true);
		setError("");
		setPasteText("");
		void task()
			.catch((caught) => {
				if (bluetoothChooserCancelled(caught)) {
					return;
				}
				setError(
					translateError(
						t,
						caught instanceof Error ? caught.message : "request failed",
					),
				);
			})
			.finally(() => setBusy(false));
	}

	const tunnel = useGpioTunnel(
		poll && available ? uuid : "",
		applySnapshot,
		setError,
	);

	const pins = snapshot?.pins ?? [];
	const selectedPin = pins.find((pin) => pin.physical === selected);
	const sketchReadOnly = target === "header" && (snapshot?.sketch ?? false);

	function drive(command: GpioApply) {
		const next = target === "arduino-proxy" ? { ...command, target } : command;
		if (sketchReadOnly) {
			setError(t("gpio.sketchReadOnly"));
			return;
		}
		const current = snapshotRef.current;
		if (current) {
			applySnapshot(applyGpioApply(current, next));
		}
		if (poll) {
			setError("");
			if (!tunnel.drive(next)) {
				setError(t("gpio.wsNotConnected"));
			}
			return;
		}
		start(async () => {
			applySnapshot(unwrapAction(await putGpio({ uuid, ...next })));
		});
	}

	if (!available) {
		return (
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("gpio.title")}</Typography>
				<Alert severity="info">{t("gpio.notConnected")}</Alert>
				{poll && uuid && onRetry ? (
					<Stack direction="row" spacing={1} className="flex-wrap">
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
		<Stack spacing={1} className="min-w-0">
			<Stack
				direction="row"
				spacing={1}
				className="flex-wrap items-center justify-between"
			>
				<Typography variant="subtitle1">
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
				<Stack direction="row" spacing={1} className="flex-wrap">
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
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid}
					onClick={() => {
						if (poll) {
							setError("");
							if (!tunnel.refresh(target)) {
								setError(t("gpio.wsNotConnected"));
							}
							return;
						}
						start(async () => {
							applySnapshot(unwrapAction(await loadGpio(uuid)));
						});
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
						type="button"
						variant="outlined"
						size="small"
						disabled={busy || !uuid}
						onClick={() => {
							start(async () => {
								applySnapshot(
									await runGpioEnvelope(
										uuid,
										await withOfflineSign(
											uuid,
											async () => unwrapAction(await signGpio({ uuid })),
											{ method: "GET", path: GPIO_PATH },
										),
										supported,
										(text) => setPasteText(text),
									),
								);
							});
						}}
					>
						{supported ? t("gpio.loadOverBle") : t("gpio.signGpio")}
					</Button>
				)}
			</Stack>
			{error ? <Alert severity="error">{error}</Alert> : null}
			{sketchReadOnly ? (
				<Alert severity="warning">{t("gpio.sketchReadOnly")}</Alert>
			) : null}
			{supported || poll ? null : pasteText ? (
				<>
					<CopyBlock label={t("ble.bluetoothName")} value={BLE_DEVICE_NAME} />
					<CopyBlock
						label={t("ble.writeCharacteristic")}
						value={BLE_CMD_UUID}
					/>
					<CopyBlock label={t("ble.signedCommand")} value={pasteText} />
				</>
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
					disabled={!uuid}
					readOnly={sketchReadOnly}
					onDrive={drive}
					onPwm={(physical, analog) => {
						if (sketchReadOnly) {
							setError(t("gpio.sketchReadOnly"));
							return;
						}
						const command: GpioApply = {
							physical,
							dir: "pwm",
							analog,
							...(target === "arduino-proxy" ? { target } : {}),
						};
						const current = snapshotRef.current;
						if (current) {
							applySnapshot(applyGpioApply(current, command));
						}
						window.clearTimeout(pwmTimer.current);
						pwmTimer.current = window.setTimeout(() => {
							if (poll) {
								setError("");
								if (!tunnel.drive(command)) {
									setError(t("gpio.wsNotConnected"));
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
	disabled,
	readOnly,
	onDrive,
	onPwm,
}: {
	pin: GpioPinState | undefined;
	busy: boolean;
	disabled: boolean;
	readOnly?: boolean;
	onDrive: (command: GpioApply) => void;
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
			<Stack direction="row" spacing={1} className="flex-wrap items-center">
				<Typography variant="body2">
					{t("gpio.pin", { n: pin.physical, name: pin.name })}
				</Typography>
				<PinStatusChip pin={pin} />
			</Stack>
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
					onClick={() => onDrive({ physical: pin.physical, dir: "in" })}
				>
					{t("gpio.in")}
				</Button>
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
					onClick={() => onDrive({ physical: pin.physical, dir: "off" })}
				>
					{t("gpio.off")}
				</Button>
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
					onClick={() =>
						onDrive({
							physical: pin.physical,
							dir: "out",
							value: 1,
						})
					}
				>
					{t("gpio.setHigh")}
				</Button>
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
					onClick={() =>
						onDrive({
							physical: pin.physical,
							dir: "out",
							value: 0,
						})
					}
				>
					{t("gpio.setLow")}
				</Button>
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
					onClick={() =>
						onDrive({
							physical: pin.physical,
							dir: "pwm",
							analog,
						})
					}
				>
					{t("gpio.pwm")}
				</Button>
				<Button
					type="button"
					size="small"
					variant="outlined"
					disabled={busy || disabled || locked}
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
					disabled={busy || disabled || locked}
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
		<Stack direction="row" spacing={1} className="flex-wrap items-center">
			<input
				type="number"
				min={0}
				max={255}
				step={1}
				inputMode="numeric"
				value={draft ?? analog}
				disabled={disabled}
				aria-label={t("gpio.pinPwmAria", { n: physical })}
				className="w-20"
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
	const label = gpioStatusText(t, pin);
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

async function runGpioEnvelope(
	uuid: string,
	envelope: unknown,
	supported: boolean,
	onPaste: (text: string) => void,
): Promise<GpioSnapshot | null> {
	if (!supported) {
		const text = envelopeToPasteText(
			envelope as Parameters<typeof envelopeToPasteText>[0],
		);
		onPaste(text);
		await navigator.clipboard.writeText(text).catch(() => undefined);
		return null;
	}
	const ble = await connectGpioCompanionBle(uuid);
	try {
		if (ble.info.uuid && ble.info.uuid !== uuid) {
			throw new Error("this board is not the selected paired device");
		}
		return parseGpioPayload(await ble.sendEnvelope(envelope as never));
	} finally {
		ble.disconnect();
	}
}

function parseGpioPayload(raw: string): GpioSnapshot {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("board did not return gpio");
	}
	if (
		parsed &&
		typeof parsed === "object" &&
		"error" in parsed &&
		typeof (parsed as { error?: unknown }).error === "string"
	) {
		throw new Error((parsed as { error: string }).error);
	}
	const snap = parsed as GpioSnapshot;
	if (!snap || !Array.isArray(snap.pins)) {
		throw new Error("board did not return gpio");
	}
	return snap;
}
