import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
	type GpioPinState,
	type GpioSnapshot,
	type GpioTarget,
	loadGpio,
	putGpio,
	signGpio,
} from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { sendEnvelope } from "../lib/ble.ts";
import { useColors } from "../lib/color-mode.tsx";
import { gpioLiveValues } from "../lib/hub.ts";
import {
	type Messages,
	type Translate,
	translateError,
	useT,
} from "../lib/locale.tsx";
import { openPairedBoard } from "../lib/paired-ble.ts";
import { useGpioTunnel } from "../lib/use-gpio-tunnel.ts";
import { useOfflineBleKey } from "../lib/use-offline-ble-key.ts";
import ArduinoProxyPins from "./ArduinoProxyPins.tsx";
import GpioHeader from "./GpioHeader.tsx";
import { Body, Chip, ErrorText, Muted, TextButton, Warn } from "./ui.tsx";

function canDriveGpio(pin: GpioPinState): boolean {
	return pin.type === "gpio" && !pin.reserved && !pin.unresolved;
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

export default function GpioPanel({
	uuid,
	connected,
	poll = false,
	onLivePins,
}: {
	uuid: string;
	connected?: boolean;
	poll?: boolean;
	onLivePins?: (pins: Record<number, 0 | 1>, target?: GpioTarget) => void;
}) {
	const auth = useAuth();
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [snapshot, setSnapshot] = useState<GpioSnapshot | null>(null);
	const [selected, setSelected] = useState<number | undefined>();
	const [target, setTarget] = useState<GpioTarget>("header");
	const snapshotRef = useRef<GpioSnapshot | null>(null);
	const livePinsRef = useRef("");
	const token = auth.token;
	const offline = useOfflineBleKey(uuid);
	const pins = snapshot?.pins ?? [];
	const selectedPin = pins.find((pin) => pin.physical === selected);
	const sketchReadOnly = target === "header" && (snapshot?.sketch ?? false);
	const available = Boolean(uuid) && connected !== false;
	const applyLive = useCallback(
		(next: GpioSnapshot | null) => {
			const live = gpioLiveValues(next);
			const key = `${next?.target ?? "header"}:${JSON.stringify(live)}`;
			if (key !== livePinsRef.current) {
				livePinsRef.current = key;
				onLivePins?.(live, next?.target ?? "header");
			}
		},
		[onLivePins],
	);
	const onGpio = useCallback(
		(next: GpioSnapshot) => {
			snapshotRef.current = next;
			setSnapshot(next);
			applyLive(next);
		},
		[applyLive],
	);
	const tunnel = useGpioTunnel(
		poll && available ? uuid : "",
		token,
		onGpio,
		setError,
	);

	function applySnapshot(next: GpioSnapshot | null) {
		snapshotRef.current = next;
		setSnapshot(next);
		applyLive(next);
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
		if (!token) {
			return;
		}
		start(() => putGpio(token, { uuid, ...next }));
	}

	if (!available) {
		return (
			<View style={{ gap: 8, marginTop: 8 }}>
				<Body>{t("gpio.title")}</Body>
				<Muted>{t("gpio.notConnected")}</Muted>
			</View>
		);
	}

	return (
		<View style={{ gap: 8, marginTop: 8 }}>
			<View
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<Body>{poll ? t("gpio.live") : t("gpio.title")}</Body>
				{poll ? (
					<LiveChip status={tunnel.status} ready={Boolean(snapshot)} />
				) : null}
			</View>
			{uuid ? <Muted>{offline.label}</Muted> : null}
			{poll ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
					<TargetChip
						label={t("gpio.companion")}
						active={target === "header"}
						onPress={() => {
							setTarget("header");
							setSelected(undefined);
							tunnel.refresh("header");
						}}
					/>
					<TargetChip
						label={t("gpio.arduino")}
						active={target === "arduino-proxy"}
						onPress={() => {
							setTarget("arduino-proxy");
							setSelected(undefined);
							tunnel.refresh("arduino-proxy");
						}}
					/>
				</View>
			) : null}
			{poll ? (
				<Muted>
					{snapshot
						? target === "arduino-proxy"
							? t("gpio.proxyHint")
							: t("gpio.tapHint")
						: t("gpio.waiting")}
				</Muted>
			) : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				<TextButton
					label={
						busy
							? t("common.loading")
							: snapshot || poll
								? t("gpio.refresh")
								: t("gpio.load")
					}
					disabled={busy || !uuid || !token}
					onPress={() => {
						if (poll) {
							setError("");
							if (!tunnel.refresh(target)) {
								setError("live gpio websocket is not connected");
							}
							return;
						}
						if (!token) {
							return;
						}
						start(() => loadGpio(token, uuid));
					}}
				/>
				{poll ? null : (
					<TextButton
						label={t("gpio.loadOverBle")}
						disabled={busy || !uuid || !token}
						onPress={() => {
							if (!token) {
								return;
							}
							start(async () => {
								const envelope = await signGpio(token, { uuid });
								const paired = await openPairedBoard(uuid, { token });
								try {
									return parseGpioPayload(
										await sendEnvelope(
											paired.session.device,
											envelope,
											paired.loss,
										),
									);
								} finally {
									await paired.session.close();
								}
							});
						}}
					/>
				)}
			</View>
			{error ? <ErrorText>{translateError(t, error)}</ErrorText> : null}
			{sketchReadOnly ? <Warn>{t("gpio.sketchReadOnly")}</Warn> : null}
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
				<Muted>{t("gpio.loadToSee")}</Muted>
			)}
			{snapshot ? (
				<GpioPinActions
					pin={selectedPin}
					busy={busy}
					disabled={!token || sketchReadOnly}
					onDrive={drive}
				/>
			) : null}
		</View>
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
		return <Chip label={t("gpio.reconnecting")} tone="warning" />;
	}
	if (status === "connecting" || !ready) {
		return (
			<Chip
				label={
					status === "connecting" ? t("gpio.connecting") : t("gpio.waitingChip")
				}
				tone="muted"
			/>
		);
	}
	return <Chip label={t("gpio.liveChip")} tone="success" />;
}

function TargetChip({
	label,
	active,
	onPress,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
}) {
	const colors = useColors();
	return (
		<Pressable
			onPress={onPress}
			style={{
				borderWidth: active ? 2 : 1,
				borderColor: active ? colors.primary : colors.border,
				backgroundColor: active ? colors.chipBg : colors.surface,
				paddingHorizontal: 12,
				paddingVertical: 6,
				borderRadius: 999,
			}}
		>
			<Text
				style={{
					color: active ? colors.primary : colors.text,
					fontWeight: "600",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

function GpioPinActions({
	pin,
	busy,
	disabled,
	onDrive,
}: {
	pin: GpioPinState | undefined;
	busy: boolean;
	disabled: boolean;
	onDrive: (command: GpioCommand) => void;
}) {
	const t = useT();
	if (!pin) {
		return <Muted>{t("gpio.tapToDrive")}</Muted>;
	}
	const locked = !canDriveGpio(pin) || disabled;
	const analog = typeof pin.analog === "number" ? pin.analog : 128;
	return (
		<View style={{ gap: 8 }}>
			<View>
				<Body>{t("gpio.pin", { n: pin.physical, name: pin.name })}</Body>
				<Muted>{pinStatus(pin, t)}</Muted>
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				<TextButton
					label={t("gpio.in")}
					disabled={busy || locked}
					onPress={() => onDrive({ physical: pin.physical, dir: "in" })}
				/>
				<TextButton
					label={t("gpio.off")}
					disabled={busy || locked}
					onPress={() => onDrive({ physical: pin.physical, dir: "off" })}
				/>
				<TextButton
					label={t("gpio.setHigh")}
					disabled={busy || locked}
					onPress={() =>
						onDrive({ physical: pin.physical, dir: "out", value: 1 })
					}
				/>
				<TextButton
					label={t("gpio.setLow")}
					disabled={busy || locked}
					onPress={() =>
						onDrive({ physical: pin.physical, dir: "out", value: 0 })
					}
				/>
				<TextButton
					label={t("gpio.pwm")}
					disabled={busy || locked}
					onPress={() =>
						onDrive({ physical: pin.physical, dir: "pwm", analog })
					}
				/>
				<TextButton
					label={
						typeof pin.hz === "number" ? t("gpio.stopTone") : t("gpio.tone")
					}
					disabled={busy || locked}
					onPress={() =>
						onDrive(
							typeof pin.hz === "number"
								? { physical: pin.physical, op: "notone" }
								: { physical: pin.physical, op: "tone", hz: 440 },
						)
					}
				/>
			</View>
		</View>
	);
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
