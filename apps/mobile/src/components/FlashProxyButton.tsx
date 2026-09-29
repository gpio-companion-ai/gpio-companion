import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
	type ArduinoProxyStatus,
	type FlashPort,
	type FlashStatus,
	loadArduinoProxy,
	loadFlash,
	loadFlashPorts,
	startFlashProxy,
} from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import { useDeviceHub } from "../lib/use-device-hub.ts";
import { Body, Busy, Chip, ErrorText, Muted, TextButton } from "./ui.tsx";

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
	const auth = useAuth();
	const t = useT();
	const token = auth.token;
	const colors = useColors();
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
		if (!uuid || !token || connected === false) {
			setPorts([]);
			setProxy(null);
			setStatus(null);
			return;
		}
		const listed = await loadFlashPorts(token, uuid);
		setPorts(listed.ports);
		const first = listed.ports.find((item) =>
			item.fqbn ? isProxyFqbn(item.fqbn) : true,
		);
		if (first?.address) {
			setPort(first.address);
		}
		if (first?.fqbn && isProxyFqbn(first.fqbn)) {
			setFqbn(first.fqbn);
		}
		try {
			const nextProxy = await loadArduinoProxy(token, uuid);
			setProxy(nextProxy);
			if (nextProxy.connected && nextProxy.fqbn && isProxyFqbn(nextProxy.fqbn)) {
				setFqbn(nextProxy.fqbn);
			}
		} catch {
			setProxy(null);
		}
		try {
			const next = await loadFlash(token, uuid);
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
	}, [uuid, token, connected]);

	useEffect(() => {
		void load().catch(() => undefined);
	}, [load]);

	useEffect(() => {
		if (!uuid || !token || !waiting) {
			return;
		}
		let cancelled = false;
		const poll = async () => {
			try {
				const next = await loadFlash(token, uuid);
				if (!cancelled) {
					applyFlash(next);
				}
			} catch {
				return;
			}
		};
		const timer = setInterval(() => {
			void poll();
		}, 1500);
		void poll();
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [uuid, token, waiting, applyFlash]);

	useEffect(() => {
		if (!waiting) {
			return;
		}
		const timer = setTimeout(
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
		return () => clearTimeout(timer);
	}, [waiting, t]);

	useDeviceHub(uuid, token, {
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
		<View style={{ gap: 8 }}>
			<Body>{t("flash.proxyTitle")}</Body>
			<Chip
				label={
					flashing
						? t("flash.flashing")
						: live
							? t("flash.firmata", {
									name: proxy?.name || proxy?.fqbn || t("debug.connected"),
								})
							: t("flash.usbArduino")
				}
				tone={flashing ? "warning" : live ? "success" : "muted"}
			/>
			<Muted>{t("flash.proxyHint")}</Muted>
			{ports.length > 1
				? ports.map((item) => (
						<Pressable
							key={item.address}
							onPress={() => {
								if (!flashing) {
									setPort(item.address);
								}
							}}
							style={{
								borderWidth: 1,
								borderColor:
									port === item.address ? colors.primary : colors.border,
								borderRadius: 8,
								paddingHorizontal: 10,
								paddingVertical: 8,
							}}
						>
							<Text
								style={{
									color: port === item.address ? colors.primary : colors.text,
								}}
							>
								{item.name || item.address}
							</Text>
						</Pressable>
					))
				: null}
			{PROXY_BOARDS.map((board) => (
				<Pressable
					key={board.fqbn}
					onPress={() => {
						if (!flashing) {
							setFqbn(board.fqbn);
						}
					}}
					style={{
						borderWidth: 1,
						borderColor: fqbn === board.fqbn ? colors.primary : colors.border,
						borderRadius: 8,
						paddingHorizontal: 10,
						paddingVertical: 8,
					}}
				>
					<Text
						style={{
							color: fqbn === board.fqbn ? colors.primary : colors.text,
						}}
					>
						{board.name}
					</Text>
				</Pressable>
			))}
			{error ? <ErrorText>{translateError(t, error)}</ErrorText> : null}
			{notice && !flashing ? <Muted>{notice}</Muted> : null}
			<Busy show={flashing} />
			<TextButton
				label={
					flashing
						? t("flash.flashing")
						: live
							? t("flash.reflashProxy")
							: t("flash.asProxy")
				}
				disabled={busy || flashing || !uuid || !token || !fqbn.trim()}
				onPress={() => {
					if (!token) {
						return;
					}
					beforeKeyRef.current = lastKey(status?.last ?? null);
					seenRunningRef.current = false;
					waitingRef.current = true;
					setWaiting(true);
					setBusy(true);
					setError("");
					setNotice("");
					void startFlashProxy(token, {
						uuid,
						fqbn,
						port: port || undefined,
					})
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
			/>
			<Muted>
				{flashing
					? t("flash.takeMinute")
					: last
						? last.ok
							? t("flash.lastOk", { fqbn: last.fqbn })
							: t("flash.lastFailed", { fqbn: last.fqbn })
						: ""}
			</Muted>
		</View>
	);
}
