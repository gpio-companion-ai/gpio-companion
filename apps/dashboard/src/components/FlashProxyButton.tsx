import { GET as loadArduinoProxy } from "@api/arduino-proxy";
import { GET as loadFlash } from "@api/flash";
import { GET as loadFlashPorts } from "@api/flash/ports";
import { POST as startFlashProxy } from "@api/flash/proxy";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import { CircularProgress } from "@shpaw415/mui-lite/Progress";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	ARDUINO_PROXY_FQBNS,
	type ArduinoProxyStatus,
	arduinoProxyBoard,
	type FlashPort,
	type FlashStatus,
	isArduinoProxyFqbn,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeviceHub } from "../hooks/useDeviceHub.ts";
import { useT } from "../hooks/useLocale.tsx";
import { unwrapAction } from "../lib/action.ts";

function lastKey(last: FlashStatus["last"]): string {
	if (!last) {
		return "";
	}
	return `${last.ok}:${last.fqbn}:${last.startedAt}:${last.log.slice(-120)}`;
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
		const listed = unwrapAction(await loadFlashPorts(uuid));
		setPorts(listed.ports);
		const first = listed.ports.find((item) =>
			item.fqbn ? isArduinoProxyFqbn(item.fqbn) : true,
		);
		if (first?.address) {
			setPort(first.address);
		}
		if (first?.fqbn && isArduinoProxyFqbn(first.fqbn)) {
			setFqbn(first.fqbn);
		}
		try {
			const nextProxy = unwrapAction(await loadArduinoProxy(uuid));
			setProxy(nextProxy);
			if (
				nextProxy.connected &&
				nextProxy.fqbn &&
				isArduinoProxyFqbn(nextProxy.fqbn)
			) {
				setFqbn(nextProxy.fqbn);
			}
		} catch {
			setProxy(null);
		}
		try {
			const next = unwrapAction(await loadFlash(uuid));
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
		void load().catch(() => undefined);
	}, [load]);

	useEffect(() => {
		if (!uuid || !waiting) {
			return;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const next = unwrapAction(await loadFlash(uuid));
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
				setError((prev) => prev || t("flash.timedOut"));
			},
			5 * 60 * 1000,
		);
		return () => window.clearTimeout(timer);
	}, [waiting, t]);

	useDeviceHub(uuid, {
		onArduinoProxy: (next) => setProxy(next),
		onFlash: applyFlash,
	});

	if (connected === false) {
		return null;
	}

	const live = Boolean(proxy?.connected);
	const flashing = waiting || Boolean(status?.running);
	const hasBoard =
		ports.length > 0 || live || flashing || Boolean(status?.last);

	if (!hasBoard) {
		return null;
	}

	const last = status?.last;

	return (
		<Stack spacing={1}>
			<Stack direction="row" spacing={1} className="flex-wrap items-center">
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
					className="w-full"
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
				className="w-full"
			>
				{ARDUINO_PROXY_FQBNS.map((id) => (
					<option key={id} value={id}>
						{arduinoProxyBoard(id)?.name || id}
					</option>
				))}
			</Select>
			{error ? <Alert severity="error">{error}</Alert> : null}
			{notice && !flashing ? <Alert severity="success">{notice}</Alert> : null}
			<Stack direction="row" spacing={1} className="flex-wrap items-center">
				<Button
					type="button"
					variant="contained"
					size="small"
					disabled={busy || flashing || !uuid || !fqbn.trim()}
					onClick={() => {
						beforeKeyRef.current = lastKey(status?.last ?? null);
						seenRunningRef.current = false;
						waitingRef.current = true;
						setWaiting(true);
						setBusy(true);
						setError("");
						setNotice("");
						void startFlashProxy({ uuid, fqbn, port: port || undefined })
							.then((result) => {
								unwrapAction(result);
							})
							.catch((caught) => {
								waitingRef.current = false;
								seenRunningRef.current = false;
								setWaiting(false);
								setBusy(false);
								setError(
									translateError(
										t,
										caught instanceof Error ? caught.message : "flash failed",
									),
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
