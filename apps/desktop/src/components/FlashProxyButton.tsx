import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import { CircularProgress } from "@shpaw415/mui-lite/Progress";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ArduinoProxyStatus,
	type FlashPort,
	type FlashStatus,
	loadArduinoProxy,
	loadFlash,
	loadFlashPorts,
	startFlashProxy,
} from "../api";
import { useDeviceHub } from "../hooks/useDeviceHub";
import { useT } from "../locale";

const PROXY_BOARDS = [
	{ fqbn: "arduino:avr:uno", name: "Arduino Uno" },
	{ fqbn: "arduino:avr:nano", name: "Arduino Nano" },
	{ fqbn: "arduino:avr:mega", name: "Arduino Mega 2560" },
	{ fqbn: "arduino:samd:nano_33_iot", name: "Arduino Nano 33 IoT" },
	{ fqbn: "arduino:samd:mkrwifi1010", name: "Arduino MKR WiFi 1010" },
	{ fqbn: "arduino:samd:mkrzero", name: "Arduino MKR Zero" },
	{ fqbn: "arduino:samd:mzero", name: "Arduino Zero" },
	{ fqbn: "esp32:esp32:esp32", name: "ESP32 Dev Module" },
	{ fqbn: "esp32:esp32:esp32s3", name: "ESP32-S3" },
	{ fqbn: "esp32:esp32:esp32c3", name: "ESP32-C3" },
] as const;

function isUsbArduinoPort(address: string): boolean {
	return /^\/dev\/tty(USB|ACM)[0-9]+$/.test(address);
}

function isProxyFqbn(fqbn: string): boolean {
	const trimmed = fqbn.trim();
	const normalized = trimmed.startsWith("arduino:avr:mega")
		? "arduino:avr:mega"
		: trimmed;
	return PROXY_BOARDS.some(
		(board) =>
			board.fqbn === normalized || trimmed.startsWith(`${board.fqbn}:`),
	);
}

function lastKey(last: FlashStatus["last"]): string {
	if (!last) {
		return "";
	}
	return `${last.ok}:${last.fqbn}:${last.log.slice(-120)}`;
}

function failMessage(log: string): string {
	const lines = log
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines[lines.length - 1] || "flash failed";
}

export default function FlashProxyButton({
	uuid,
	connected,
}: {
	uuid: string;
	connected?: boolean;
}) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [ports, setPorts] = useState<FlashPort[]>([]);
	const [port, setPort] = useState("");
	const [fqbn, setFqbn] = useState("");
	const [proxy, setProxy] = useState<ArduinoProxyStatus | null>(null);
	const [status, setStatus] = useState<FlashStatus | null>(null);
	const [checked, setChecked] = useState(false);
	const waitingRef = useRef(false);
	const seenRunningRef = useRef(false);
	const beforeKeyRef = useRef("");

	const applyFlash = useCallback(
		(next: FlashStatus) => {
			setStatus(next);
			if (next.running) {
				seenRunningRef.current = true;
				waitingRef.current = true;
				setWaiting(true);
				setBusy(true);
				return;
			}
			if (!waitingRef.current) {
				return;
			}
			if (
				!seenRunningRef.current &&
				lastKey(next.last) === beforeKeyRef.current
			) {
				return;
			}
			waitingRef.current = false;
			seenRunningRef.current = false;
			setWaiting(false);
			setBusy(false);
			if (next.last && !next.last.ok) {
				setNotice("");
				setError(failMessage(next.last.log));
				return;
			}
			setError("");
			setNotice(
				next.last
					? t("flash.ok", { fqbn: next.last.fqbn })
					: t("flash.finished"),
			);
		},
		[t],
	);

	const load = useCallback(async () => {
		if (!uuid || connected === false) {
			setPorts([]);
			setProxy(null);
			setStatus(null);
			return;
		}
		const listed = await loadFlashPorts(uuid);
		const usb = listed.ports.filter((item) => isUsbArduinoPort(item.address));
		setPorts(usb);
		const first =
			usb.find((item) => item.fqbn && isProxyFqbn(item.fqbn)) ?? usb[0];
		setPort(first?.address ?? "");
		if (first?.fqbn && isProxyFqbn(first.fqbn)) {
			setFqbn(first.fqbn);
		}
		try {
			const nextProxy = await loadArduinoProxy(uuid);
			setProxy(nextProxy);
			if (
				nextProxy.connected &&
				nextProxy.fqbn &&
				isProxyFqbn(nextProxy.fqbn)
			) {
				setFqbn(nextProxy.fqbn);
			}
		} catch {
			setProxy(null);
		}
		try {
			const next = await loadFlash(uuid);
			setStatus(next);
			if (next.running) {
				waitingRef.current = true;
				seenRunningRef.current = true;
				setWaiting(true);
				setBusy(true);
			}
		} catch {
			setStatus(null);
		}
	}, [uuid, connected]);

	useEffect(() => {
		let cancelled = false;
		setChecked(false);
		void load()
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) {
					setChecked(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [load]);

	useEffect(() => {
		if (!uuid || !waiting) {
			return;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const next = await loadFlash(uuid);
				if (!cancelled) {
					applyFlash(next);
				}
			} catch {
				return;
			}
		};
		const timer = window.setInterval(() => {
			void poll();
		}, 1500);
		void poll();
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [uuid, waiting, applyFlash]);

	useEffect(() => {
		if (!waiting) {
			return;
		}
		const timer = window.setTimeout(
			() => {
				if (!waitingRef.current) {
					return;
				}
				waitingRef.current = false;
				setWaiting(false);
				setBusy(false);
				setError((prev) => prev || "flash timed out — check Project flash log");
			},
			5 * 60 * 1000,
		);
		return () => window.clearTimeout(timer);
	}, [waiting]);

	useDeviceHub(uuid, {
		onArduinoProxy: (next) => setProxy(next),
		onFlash: applyFlash,
	});

	const offline = connected === false;
	const live = Boolean(proxy?.connected);
	const flashing = waiting || Boolean(status?.running);
	const hasBoard =
		ports.length > 0 || live || flashing || Boolean(status?.last);
	const checking = !offline && !checked && !hasBoard;
	const noDevice = !hasBoard && (offline || checked);

	if (checking || noDevice) {
		return (
			<Stack spacing={1}>
				<Typography variant="subtitle2">{t("flash.proxyTitle")}</Typography>
				<Typography variant="body2" color="secondary">
					{checking ? t("common.loading") : t("flash.noDevice")}
				</Typography>
				{noDevice ? (
					<Button type="button" variant="contained" size="small" disabled>
						{t("flash.asProxy")}
					</Button>
				) : null}
			</Stack>
		);
	}

	const last = status?.last;

	return (
		<Stack spacing={1}>
			<Stack
				direction="row"
				spacing={1}
				sx={{ flexWrap: "wrap", alignItems: "center" }}
			>
				<Typography variant="subtitle2">{t("flash.proxyTitle")}</Typography>
				{flashing ? (
					<Chip
						label={t("flash.flashing")}
						color="warning"
						size="small"
						variant="outlined"
					/>
				) : live ? (
					<Chip
						label={t("flash.firmata", {
							name: proxy?.name || proxy?.fqbn || t("debug.connected"),
						})}
						color="success"
						size="small"
						variant="outlined"
					/>
				) : (
					<Chip
						label={t("flash.usbArduino")}
						size="small"
						color="secondary"
						variant="outlined"
					/>
				)}
			</Stack>
			<Typography variant="body2" color="secondary">
				{t("flash.proxyHint")}
			</Typography>
			{ports.length > 1 ? (
				<Select
					name="proxy-port"
					label={t("flash.port")}
					value={port}
					onSelect={setPort}
				>
					{ports.map((item) => (
						<option key={item.address} value={item.address}>
							{item.name || item.address}
						</option>
					))}
				</Select>
			) : null}
			<Select
				name="proxy-fqbn"
				label={t("flash.board")}
				value={fqbn}
				onSelect={setFqbn}
			>
				{PROXY_BOARDS.map((board) => (
					<option key={board.fqbn} value={board.fqbn}>
						{board.name}
					</option>
				))}
			</Select>
			{error ? (
				<Alert severity="error">{translateError(t, error)}</Alert>
			) : null}
			{notice && !flashing ? <Alert severity="success">{notice}</Alert> : null}
			<Stack
				direction="row"
				spacing={1}
				sx={{ flexWrap: "wrap", alignItems: "center" }}
			>
				<Button
					type="button"
					variant="contained"
					size="small"
					disabled={
						busy || flashing || !uuid || !fqbn.trim() || !isUsbArduinoPort(port)
					}
					onClick={() => {
						if (!isUsbArduinoPort(port)) {
							return;
						}
						beforeKeyRef.current = lastKey(status?.last ?? null);
						seenRunningRef.current = false;
						waitingRef.current = true;
						setWaiting(true);
						setBusy(true);
						setError("");
						setNotice("");
						void startFlashProxy({ uuid, fqbn, port })
							.then(() => undefined)
							.catch((caught) => {
								waitingRef.current = false;
								seenRunningRef.current = false;
								setWaiting(false);
								setBusy(false);
								setError(
									caught instanceof Error ? caught.message : "flash failed",
								);
							});
					}}
				>
					{flashing
						? t("flash.flashing")
						: live
							? t("flash.reflashProxy")
							: t("flash.asProxy")}
				</Button>
				{flashing ? <CircularProgress size="16px" /> : null}
			</Stack>
			<Typography color="secondary" variant="body2">
				{flashing
					? t("flash.takeMinute")
					: last
						? last.ok
							? t("flash.lastOk", { fqbn: last.fqbn })
							: t("flash.lastFailed", { fqbn: last.fqbn })
						: ""}
			</Typography>
		</Stack>
	);
}
