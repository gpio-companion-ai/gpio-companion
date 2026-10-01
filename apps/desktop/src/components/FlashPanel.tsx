import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type BoardSketch,
	bleFlash,
	type FlashStatus,
	loadArduinoProxy,
	loadFlash,
	loadFlashPorts,
	loadFlashSketches,
	startFlash,
	startUsbConsole,
	stopUsbConsole,
} from "../api";
import { useSavedBleId } from "../hooks/useApiCache";
import { useConsoleTunnel } from "../hooks/useConsoleTunnel";
import { useDeviceHub } from "../hooks/useDeviceHub";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey";
import { consoleStatusLabel } from "../lib/i18n-labels";
import { useT } from "../locale";
import LiveConsole from "./LiveConsole";

function pickDesktopFlashTarget(
	ports: Array<{ address: string; fqbn?: string }>,
	hint?: { connected?: boolean; port?: string; fqbn?: string } | null,
) {
	const connected = hint?.connected === true;
	const hintPort = hint?.port?.trim() ?? "";
	const hintFqbn = hint?.fqbn?.trim() ?? "";
	const matched = connected
		? (ports.find((item) => hintPort && item.address === hintPort) ??
			ports.find((item) => hintFqbn && item.fqbn === hintFqbn))
		: undefined;
	const fallback = ports.find((item) => item.fqbn?.trim()) ?? ports[0];
	if (connected) {
		return {
			port: matched?.address || hintPort || fallback?.address || "",
			fqbn: matched?.fqbn?.trim() || hintFqbn || fallback?.fqbn?.trim() || "",
		};
	}
	return {
		port: fallback?.address ?? "",
		fqbn: fallback?.fqbn?.trim() ?? "",
	};
}

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
	const [fqbn, setFqbn] = useState("");
	const [proxyName, setProxyName] = useState("");
	const [dir, setDir] = useState("");
	const [port, setPort] = useState("");
	const [sketches, setSketches] = useState<BoardSketch[]>([]);
	const [legacy, setLegacy] = useState(false);
	const offline = useOfflineBleKey(uuid);
	const bleId = useSavedBleId(uuid);
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
			setProxyName("");
			return;
		}
		let cancelled = false;
		void Promise.all([
			loadFlashPorts(uuid).catch(() => ({ ports: [] })),
			loadArduinoProxy(uuid).catch(() => null),
		]).then(([listedPorts, proxy]) => {
			if (cancelled) {
				return;
			}
			setProxyName(
				proxy?.connected ? proxy.name?.trim() || proxy.fqbn?.trim() || "" : "",
			);
			const target = pickDesktopFlashTarget(listedPorts.ports, proxy);
			if (target.fqbn) {
				setFqbn(target.fqbn);
			}
			if (target.port) {
				setPort(target.port);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [uuid]);

	const onFlash = useCallback((next: FlashStatus) => {
		setStatus(next);
	}, []);
	useDeviceHub(uuid, { onFlash });
	const serial = useConsoleTunnel(uuid, setError);
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

	return (
		<Stack spacing={1} sx={{ mt: 1 }}>
			<Typography variant="subtitle2">{t("flash.arduinoFlash")}</Typography>
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
			<Button
				variant="outlined"
				size="small"
				disabled={busy || !uuid}
				onClick={() => {
					start(async () => {
						setStatus(await loadFlash(uuid));
						const listed = await loadFlashPorts(uuid);
						const proxy = await loadArduinoProxy(uuid).catch(() => null);
						setProxyName(
							proxy?.connected
								? proxy.name?.trim() || proxy.fqbn?.trim() || ""
								: "",
						);
						const target = pickDesktopFlashTarget(listed.ports, proxy);
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
			<TextField
				label={t("flash.fqbn")}
				value={fqbn}
				onChange={(event) => setFqbn(event.target.value)}
			/>
			{legacy ? (
				<TextField
					label={t("flash.sketchDir")}
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
				value={port}
				onChange={(event) => setPort(event.target.value)}
			/>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<Button
					variant="outlined"
					size="small"
					disabled={busy || !port.trim() || Boolean(status?.running)}
					onClick={() => {
						start(async () => {
							await startUsbConsole({ uuid, port: port.trim() });
						});
					}}
				>
					{t("flash.openSerial")}
				</Button>
				<Button
					variant="outlined"
					size="small"
					disabled={busy}
					onClick={() => {
						start(async () => {
							await stopUsbConsole(uuid);
						});
					}}
				>
					{t("flash.closeSerial")}
				</Button>
			</Stack>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<Button
					variant="contained"
					size="small"
					disabled={busy || !canFlash}
					onClick={() => {
						start(async () => {
							await startFlash({
								uuid,
								fqbn: fqbn.trim(),
								dir: dir.trim(),
								port: port.trim() || undefined,
							});
							setStatus(await loadFlash(uuid));
						});
					}}
				>
					{t("flash.flash")}
				</Button>
				<Button
					variant="outlined"
					size="small"
					disabled={busy || !canFlash}
					onClick={() => {
						start(async () => {
							await bleFlash({
								uuid,
								id: bleId,
								fqbn: fqbn.trim(),
								dir: dir.trim(),
								port: port.trim() || undefined,
							});
						});
					}}
				>
					{t("flash.overBle")}
				</Button>
			</Stack>
			{error ? (
				<Alert severity="error">{translateError(t, error)}</Alert>
			) : null}
			<Typography color="secondary" variant="body2">
				{status?.running
					? t("flash.flashing")
					: status?.last
						? status.last.ok
							? t("flash.lastOk", { fqbn: status.last.fqbn })
							: t("flash.lastFailed", { fqbn: status.last.fqbn })
						: t("flash.thenFlash")}
			</Typography>
			<Typography variant="caption" color="secondary">
				{t("common.serial", { status: consoleStatusLabel(serial.status, t) })}
			</Typography>
			<LiveConsole
				label={t("flash.serialUsb")}
				value={serial.snapshot.usb.log}
			/>
		</Stack>
	);
}
