import { GET as loadArduinoProxy } from "@api/arduino-proxy";
import { POST as startUsbConsole } from "@api/console";
import { POST as signFlash } from "@api/device/flash";
import { GET as loadFlash, POST as startFlash } from "@api/flash";
import { GET as loadFlashPorts } from "@api/flash/ports";
import { GET as loadFlashSketches } from "@api/flash/sketches";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	BLE_CMD_UUID,
	BLE_DEVICE_NAME,
	type BoardSketch,
	CONSOLE_BAUDS,
	CONSOLE_DEFAULT_BAUD,
	envelopeToPasteText,
	FLASH_PATH,
	FLASH_PORTS_PATH,
	type FlashPort,
	type FlashStatus,
	parseFlashPut,
	pickFlashTarget,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConsoleTunnel } from "../hooks/useConsoleTunnel.ts";
import { useDeviceHub } from "../hooks/useDeviceHub.ts";
import { useT } from "../hooks/useLocale.tsx";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey.ts";
import { useArmedAction, useWorkbench } from "../hooks/useWorkbench.tsx";
import { unwrapAction } from "../lib/action.ts";
import { withOfflineSign } from "../lib/offline-ble.ts";
import {
	bluetoothChooserCancelled,
	bluetoothSupported,
	connectGpioCompanionBle,
} from "../lib/web-bluetooth.ts";
import CopyBlock from "./CopyBlock.tsx";
import LiveConsole from "./LiveConsole.tsx";

export default function FlashPanel({
	uuid,
	project,
	preselectDir,
}: {
	uuid: string;
	project?: string;
	preselectDir?: string;
}) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState<FlashStatus | null>(null);
	const [ports, setPorts] = useState<FlashPort[]>([]);
	const [fqbn, setFqbn] = useState("");
	const [dir, setDir] = useState("");
	const [port, setPort] = useState("");
	const [baud, setBaud] = useState(String(CONSOLE_DEFAULT_BAUD));
	const [proxyName, setProxyName] = useState("");
	const [sketches, setSketches] = useState<BoardSketch[]>([]);
	const [legacy, setLegacy] = useState(false);
	const [pasteText, setPasteText] = useState("");
	const supported = bluetoothSupported();
	const offline = useOfflineBleKey(uuid);
	const listed = useMemo(
		() => sketches.filter((item) => !project || item.project === project),
		[sketches, project],
	);

	useEffect(() => {
		if (!uuid) {
			setSketches([]);
			setLegacy(false);
			return;
		}
		let cancelled = false;
		loadFlashSketches(uuid)
			.then((result) => {
				if (cancelled) {
					return;
				}
				setSketches(unwrapAction(result).sketches);
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
	}, [uuid]);

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

	useEffect(() => {
		if (!uuid) {
			setPorts([]);
			setProxyName("");
			return;
		}
		let cancelled = false;
		void Promise.all([
			loadFlashPorts(uuid)
				.then((result) => unwrapAction(result).ports)
				.catch(() => [] as FlashPort[]),
			loadArduinoProxy(uuid)
				.then((result) => unwrapAction(result))
				.catch(() => null),
		]).then(([listedPorts, proxy]) => {
			if (cancelled) {
				return;
			}
			setPorts(listedPorts);
			setProxyName(
				proxy?.connected ? proxy.name?.trim() || proxy.fqbn?.trim() || "" : "",
			);
			const target = pickFlashTarget(listedPorts, proxy);
			if (target.fqbn) {
				setFqbn(target.fqbn);
			}
			if (target.port) {
				setPort(target.port);
			}
			if (
				target.baud &&
				(CONSOLE_BAUDS as readonly number[]).includes(target.baud)
			) {
				setBaud(String(target.baud));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [uuid]);

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

	const onFlash = useCallback((next: FlashStatus) => {
		setStatus(next);
	}, []);
	useDeviceHub(uuid, { onFlash });
	const serial = useConsoleTunnel(uuid, setError);

	const last = status?.last;
	const canFlash =
		Boolean(fqbn.trim()) && Boolean(dir.trim()) && (legacy || Boolean(project));
	const { setConsoleStatus } = useWorkbench();

	useEffect(() => {
		setConsoleStatus(serial.status);
		return () => setConsoleStatus("idle");
	}, [serial.status, setConsoleStatus]);

	useArmedAction("flash", Boolean(uuid) && canFlash && !busy, () => {
		start(async () => {
			unwrapAction(
				await startFlash({
					uuid,
					fqbn: fqbn.trim(),
					dir: dir.trim(),
					port: port.trim() || undefined,
				}),
			);
			setStatus(unwrapAction(await loadFlash(uuid)));
		});
	});

	return (
		<Stack spacing={1}>
			<Typography variant="subtitle1">{t("flash.arduinoFlash")}</Typography>
			<Typography variant="body2" color="secondary">
				{t("flash.replacesProxy")}
			</Typography>
			{proxyName ? (
				<Alert severity="success">
					{t("flash.firmata", { name: proxyName })}
				</Alert>
			) : (
				<Alert severity="info">{t("flash.selectArduinoFirst")}</Alert>
			)}
			{uuid ? (
				<Typography variant="body2" color="secondary">
					{offline.label}
				</Typography>
			) : null}
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid}
					onClick={() => {
						start(async () => {
							setStatus(unwrapAction(await loadFlash(uuid)));
							const listed = unwrapAction(await loadFlashPorts(uuid));
							setPorts(listed.ports);
							const proxy = await loadArduinoProxy(uuid)
								.then((result) => unwrapAction(result))
								.catch(() => null);
							setProxyName(
								proxy?.connected
									? proxy.name?.trim() || proxy.fqbn?.trim() || ""
									: "",
							);
							const target = pickFlashTarget(listed.ports, proxy);
							if (target.fqbn) {
								setFqbn(target.fqbn);
							}
							if (target.port) {
								setPort(target.port);
							}
						});
					}}
				>
					{busy ? t("common.loading") : t("flash.loadPorts")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid}
					onClick={() => {
						start(async () => {
							const raw = await runFlashEnvelope(
								uuid,
								await withOfflineSign(
									uuid,
									async () =>
										unwrapAction(await signFlash({ uuid, ports: true })),
									{ method: "GET", path: FLASH_PORTS_PATH },
								),
								supported,
								(text) => setPasteText(text),
							);
							if (
								!raw ||
								typeof raw !== "object" ||
								!("ports" in raw) ||
								!Array.isArray((raw as { ports: unknown }).ports)
							) {
								return;
							}
							setPorts((raw as { ports: FlashPort[] }).ports);
						});
					}}
				>
					{supported ? t("flash.portsOverBle") : t("flash.signPorts")}
				</Button>
			</Stack>
			<TextField
				label={t("flash.fqbn")}
				value={fqbn}
				onChange={(event) => setFqbn(event.target.value)}
			/>
			{legacy ? (
				<TextField
					label={t("flash.sketchDir")}
					placeholder="/home/gpio/blink"
					value={dir}
					onChange={(event) => setDir(event.target.value)}
				/>
			) : !project ? (
				<Typography color="secondary" variant="body2">
					{t("flash.selectProject")}
				</Typography>
			) : listed.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("flash.noSketches")}
				</Typography>
			) : (
				<Select
					name="firmware-sketch"
					label={t("flash.sketch")}
					value={dir}
					onSelect={setDir}
					className="w-full"
				>
					{listed.map((item) => (
						<option key={item.dir} value={item.dir}>
							{item.name}
						</option>
					))}
				</Select>
			)}
			<TextField
				label={t("flash.portOptional")}
				placeholder="/dev/ttyUSB0"
				value={port}
				onChange={(event) => setPort(event.target.value)}
			/>
			<Select
				name="usb-baud"
				label={t("flash.serialBaud")}
				value={baud}
				onSelect={setBaud}
				className="w-full"
			>
				{CONSOLE_BAUDS.map((item) => (
					<option key={item} value={String(item)}>
						{item}
					</option>
				))}
			</Select>
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid || !port.trim() || Boolean(status?.running)}
					onClick={() => {
						start(async () => {
							unwrapAction(
								await startUsbConsole({
									uuid,
									port: port.trim(),
									baud: Number(baud),
								}),
							);
						});
					}}
				>
					{t("flash.openSerial")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid}
					onClick={() => {
						start(async () => {
							unwrapAction(await startUsbConsole({ uuid, stop: true }));
						});
					}}
				>
					{t("flash.closeSerial")}
				</Button>
			</Stack>
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="contained"
					size="small"
					disabled={busy || !uuid || !canFlash}
					onClick={() => {
						start(async () => {
							unwrapAction(
								await startFlash({
									uuid,
									fqbn: fqbn.trim(),
									dir: dir.trim(),
									port: port.trim() || undefined,
								}),
							);
							setStatus(unwrapAction(await loadFlash(uuid)));
						});
					}}
				>
					{t("flash.flash")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !uuid || !canFlash}
					onClick={() => {
						start(async () => {
							await runFlashEnvelope(
								uuid,
								await withOfflineSign(
									uuid,
									async () =>
										unwrapAction(
											await signFlash({
												uuid,
												fqbn: fqbn.trim(),
												dir: dir.trim(),
												port: port.trim() || undefined,
											}),
										),
									{
										method: "POST",
										path: FLASH_PATH,
										body: JSON.stringify(
											parseFlashPut({
												fqbn: fqbn.trim(),
												dir: dir.trim(),
												port: port.trim() || undefined,
											}),
										),
									},
								),
								supported,
								(text) => setPasteText(text),
							);
							setStatus({ running: true, last: status?.last ?? null });
						});
					}}
				>
					{supported ? t("flash.overBle") : t("flash.signFlash")}
				</Button>
			</Stack>
			{error ? <Alert severity="error">{error}</Alert> : null}
			{supported ? null : pasteText ? (
				<>
					<CopyBlock label={t("ble.bluetoothName")} value={BLE_DEVICE_NAME} />
					<CopyBlock
						label={t("ble.writeCharacteristic")}
						value={BLE_CMD_UUID}
					/>
					<CopyBlock label={t("ble.signedCommand")} value={pasteText} />
				</>
			) : null}
			<Typography color="secondary" variant="body2">
				{status?.running
					? t("flash.flashing")
					: last
						? last.ok
							? t("flash.lastOk", { fqbn: last.fqbn })
							: t("flash.lastFailed", { fqbn: last.fqbn })
						: ports.length
							? t("flash.nPorts", { n: ports.length })
							: t("flash.thenFlash")}
			</Typography>
			{last?.log ? (
				<CopyBlock label={t("flash.cliLog")} value={last.log} />
			) : null}
			<LiveConsole
				label={t("flash.serialUsb")}
				value={serial.snapshot.usb.log}
				status={serial.status}
			/>
		</Stack>
	);
}

async function runFlashEnvelope(
	uuid: string,
	envelope: unknown,
	supported: boolean,
	onPaste: (text: string) => void,
): Promise<unknown> {
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
		return parseFlashPayload(await ble.sendEnvelope(envelope as never));
	} finally {
		ble.disconnect();
	}
}

function parseFlashPayload(raw: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("board did not return flash");
	}
	if (
		parsed &&
		typeof parsed === "object" &&
		"error" in parsed &&
		typeof (parsed as { error?: unknown }).error === "string"
	) {
		throw new Error((parsed as { error: string }).error);
	}
	return parsed;
}
