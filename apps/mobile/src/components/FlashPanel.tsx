import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
	type BoardSketch,
	type FlashStatus,
	loadFlash,
	loadFlashPorts,
	loadFlashSketches,
	signFlash,
	startFlash,
	startUsbConsole,
	stopUsbConsole,
} from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { sendEnvelope } from "../lib/ble.ts";
import { useColors } from "../lib/color-mode.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import { openPairedBoard } from "../lib/paired-ble.ts";
import { useConsoleTunnel } from "../lib/use-console-tunnel.ts";
import { useDeviceHub } from "../lib/use-device-hub.ts";
import { useOfflineBleKey } from "../lib/use-offline-ble-key.ts";
import LiveConsole from "./LiveConsole.tsx";
import { Body, ErrorText, Field, Muted, TextButton } from "./ui.tsx";

export default function FlashPanel({
	uuid,
	project,
	preselectDir,
	autoStart,
}: {
	uuid: string;
	project?: string;
	preselectDir?: string;
	autoStart?: boolean;
}) {
	const auth = useAuth();
	const t = useT();
	const token = auth.token;
	const colors = useColors();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState<FlashStatus | null>(null);
	const [fqbn, setFqbn] = useState("");
	const [dir, setDir] = useState("");
	const [port, setPort] = useState("");
	const [sketches, setSketches] = useState<BoardSketch[]>([]);
	const [legacy, setLegacy] = useState(false);
	const offline = useOfflineBleKey(uuid);
	const listed = useMemo(
		() => sketches.filter((item) => !project || item.project === project),
		[sketches, project],
	);

	useEffect(() => {
		if (!uuid || !token) {
			setSketches([]);
			setLegacy(false);
			return;
		}
		let cancelled = false;
		loadFlashSketches(token, uuid)
			.then((result) => {
				if (cancelled) {
					return;
				}
				setSketches(result.sketches);
				setLegacy(false);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setSketches([]);
				setLegacy(true);
			});
		return () => {
			cancelled = true;
		};
	}, [uuid, token]);

	useEffect(() => {
		if (legacy) {
			return;
		}
		if (!listed.some((item) => item.dir === dir)) {
			setDir(listed[0]?.dir ?? "");
		}
	}, [listed, dir, legacy]);

	useEffect(() => {
		if (legacy || !preselectDir) {
			return;
		}
		if (listed.some((item) => item.dir === preselectDir)) {
			setDir(preselectDir);
		}
	}, [listed, legacy, preselectDir]);
	const onFlash = useCallback((next: FlashStatus) => {
		setStatus(next);
	}, []);
	useDeviceHub(uuid, token, { onFlash });
	const serial = useConsoleTunnel(uuid, token, setError);
	const canFlash =
		Boolean(fqbn.trim()) && Boolean(dir.trim()) && (legacy || Boolean(project));

	function start(task: () => Promise<void>) {
		setBusy(true);
		setError("");
		void task()
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => setBusy(false));
	}

	// Auto-start flow (Flash Arduino from the Code page context menu): arm once,
	// probe USB ports for an FQBN, then fire the flash when the sketch is set.
	// Without a detected Arduino the panel stays manual (no FQBN defaulting).
	const [armed, setArmed] = useState(false);
	const firedRef = useRef(false);

	useEffect(() => {
		if (autoStart) {
			setArmed(true);
		}
	}, [autoStart]);

	useEffect(() => {
		if (!armed || !uuid || !token) {
			return;
		}
		let cancelled = false;
		setBusy(true);
		setError("");
		void loadFlashPorts(token, uuid)
			.then((listed) => {
				if (cancelled) {
					return;
				}
				const first = listed.ports[0];
				if (first?.fqbn) {
					setFqbn(first.fqbn);
				}
				if (first?.address) {
					setPort(first.address);
				}
				if (!first?.fqbn) {
					setArmed(false);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError("request failed");
					setArmed(false);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setBusy(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [armed, token, uuid]);

	useEffect(() => {
		if (!armed || firedRef.current || busy || !token || !canFlash) {
			return;
		}
		firedRef.current = true;
		setArmed(false);
		setBusy(true);
		setError("");
		void startFlash(token, {
			uuid,
			fqbn: fqbn.trim(),
			dir: dir.trim(),
			port: port.trim() || undefined,
		})
			.then(() => loadFlash(token, uuid))
			.then((next) => {
				setStatus(next);
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => setBusy(false));
	}, [armed, busy, canFlash, dir, fqbn, port, token, uuid]);

	return (
		<View style={{ gap: 8, marginTop: 8 }}>
			<Body>{t("flash.arduinoFlash")}</Body>
			<Muted>{t("flash.replacesProxy")}</Muted>
			<Muted>{t("flash.selectArduinoFirst")}</Muted>
			{uuid ? <Muted>{offline.label}</Muted> : null}
			<TextButton
				label={busy ? t("common.loading") : t("flash.loadPorts")}
				disabled={busy || !uuid || !token}
				onPress={() => {
					if (!token) {
						return;
					}
					start(async () => {
						setStatus(await loadFlash(token, uuid));
						const listed = await loadFlashPorts(token, uuid);
						const first = listed.ports[0];
						if (first?.fqbn) {
							setFqbn(first.fqbn);
						}
						if (first?.address) {
							setPort(first.address);
						}
					});
				}}
			/>
			<Field label={t("flash.fqbn")} value={fqbn} onChangeText={setFqbn} />
			{legacy ? (
				<Field
					label={t("flash.sketchDir")}
					value={dir}
					onChangeText={setDir}
					placeholder="/home/gpio/blink"
				/>
			) : !project ? (
				<Muted>{t("flash.selectProject")}</Muted>
			) : listed.length === 0 ? (
				<Muted>{t("flash.noSketches")}</Muted>
			) : (
				listed.map((item) => (
					<Pressable
						key={item.dir}
						onPress={() => setDir(item.dir)}
						style={{
							borderWidth: 1,
							borderColor: dir === item.dir ? colors.primary : colors.border,
							borderRadius: 8,
							paddingHorizontal: 10,
							paddingVertical: 8,
						}}
					>
						<Text
							style={{
								color: dir === item.dir ? colors.primary : colors.text,
							}}
						>
							{item.name}
						</Text>
					</Pressable>
				))
			)}
			<Field
				label={t("flash.portOptional")}
				value={port}
				onChangeText={setPort}
			/>
			<TextButton
				label={t("flash.openSerial")}
				disabled={busy || !token || !port.trim() || Boolean(status?.running)}
				onPress={() => {
					if (!token) {
						return;
					}
					start(async () => {
						await startUsbConsole(token, { uuid, port: port.trim() });
					});
				}}
			/>
			<TextButton
				label={t("flash.closeSerial")}
				disabled={busy || !token}
				onPress={() => {
					if (!token) {
						return;
					}
					start(async () => {
						await stopUsbConsole(token, uuid);
					});
				}}
			/>
			<TextButton
				label={t("flash.flash")}
				disabled={busy || !token || !canFlash}
				onPress={() => {
					if (!token) {
						return;
					}
					start(async () => {
						await startFlash(token, {
							uuid,
							fqbn: fqbn.trim(),
							dir: dir.trim(),
							port: port.trim() || undefined,
						});
						setStatus(await loadFlash(token, uuid));
					});
				}}
			/>
			<TextButton
				label={t("flash.overBle")}
				disabled={busy || !token || !canFlash}
				onPress={() => {
					if (!token) {
						return;
					}
					start(async () => {
						const envelope = await signFlash(token, {
							uuid,
							fqbn: fqbn.trim(),
							dir: dir.trim(),
							port: port.trim() || undefined,
							sign: true,
						});
						const paired = await openPairedBoard(uuid, { token });
						try {
							await sendEnvelope(paired.session.device, envelope, paired.loss);
						} finally {
							await paired.session.close();
						}
					});
				}}
			/>
			{error ? <ErrorText>{translateError(t, error)}</ErrorText> : null}
			<Muted>
				{status?.running
					? t("flash.flashing")
					: status?.last
						? status.last.ok
							? t("flash.lastOk", { fqbn: status.last.fqbn })
							: t("flash.lastFailed", { fqbn: status.last.fqbn })
						: t("flash.thenFlash")}
			</Muted>
			<Muted>{t("flash.serialStatus", { status: serial.status })}</Muted>
			<LiveConsole
				label={t("flash.serialUsb")}
				value={serial.snapshot.usb.log}
			/>
		</View>
	);
}
