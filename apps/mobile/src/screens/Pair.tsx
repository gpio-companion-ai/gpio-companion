import { pairClaimNotice } from "gpio-companion-pairing";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { NearbyPicker } from "../components/NearbyPicker.tsx";
import {
	Busy,
	ErrorText,
	Muted,
	PrimaryButton,
	Screen,
	TextButton,
} from "../components/ui.tsx";
import { claimDevice, signCredentials } from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import {
	createBoardLoss,
	ensureBluetoothOn,
	type NearbyRadio,
	openBoardSession,
	readInfo,
	scanNearby,
	scannedDevice,
	sendEnvelope,
} from "../lib/ble.ts";
import { looksLikeMac } from "../lib/ble-frame.ts";
import { saveLocalBleId } from "../lib/ble-ids.ts";
import { useColors } from "../lib/color-mode.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { translateError, useT } from "../lib/locale.tsx";

export default function Pair() {
	const auth = useAuth();
	const t = useT();
	const colors = useColors();
	const { setTab } = useDeviceHub();
	const { refetch: refetchBoards } = useUserBoards();
	const [boards, setBoards] = useState<NearbyRadio[]>([]);
	const [boardId, setBoardId] = useState("");
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [paired, setPaired] = useState(false);
	const [notice, setNotice] = useState("");
	const scanRef = useRef(0);

	const scan = useCallback(async () => {
		const generation = ++scanRef.current;
		setScanning(true);
		setError("");
		setPaired(false);
		setStatus(t("pair.scanningNearby"));
		try {
			await ensureBluetoothOn();
			const next = await scanNearby();
			if (scanRef.current !== generation) {
				return;
			}
			setBoards(next);
			const pick = next.find((board) => board.matched)?.id ?? next[0]?.id ?? "";
			setBoardId(pick);
			setStatus(
				next.length === 0
					? t("pair.noNearbyMoveCloser")
					: t("pair.selectDevice"),
			);
		} catch (caught) {
			if (scanRef.current !== generation) {
				return;
			}
			setError(caught instanceof Error ? caught.message : "scan failed");
			setStatus(t("pair.readyToScan"));
		} finally {
			if (scanRef.current === generation) {
				setScanning(false);
			}
		}
	}, [t]);

	useEffect(() => {
		void scan();
	}, [scan]);

	async function pair() {
		if (busy || scanning) {
			return;
		}
		if (!auth.token) {
			setError("sign in first");
			return;
		}
		if (!boardId) {
			setError(t("pair.selectNearbyFirst"));
			return;
		}
		const bleDevice = scannedDevice(boardId);
		if (!bleDevice) {
			setError(t("pair.scanAgainPick"));
			return;
		}
		setBusy(true);
		setPaired(false);
		setNotice("");
		setError("");
		try {
			const loss = createBoardLoss();
			setStatus(t("pair.connecting"));
			const session = await openBoardSession(bleDevice, (why) =>
				loss.lose(why),
			);
			try {
				setStatus(t("pair.readingBoard"));
				const info = await readInfo(session.device);
				setStatus(t("pair.signingCredentials"));
				const envelope = await signCredentials(auth.token);
				setStatus(t("pair.askingKey"));
				const raw = await sendEnvelope(session.device, envelope, loss);
				const creds = JSON.parse(raw) as {
					uuid?: string;
					key?: string;
					deviceUrl?: string;
				};
				if (!creds.uuid || !creds.key) {
					throw new Error("device did not return pairing credentials");
				}
				setStatus(t("pair.claiming"));
				const claimed = await claimDevice(auth.token, {
					uuid: creds.uuid,
					key: creds.key,
					deviceUrl: creds.deviceUrl || info.deviceUrl,
					bleMac: looksLikeMac(boardId) ? boardId : undefined,
				});
				const noticeKind = pairClaimNotice(claimed);
				if (noticeKind === "yours") {
					await saveLocalBleId(creds.uuid, boardId).catch(() => undefined);
					await refetchBoards({ force: true }).catch(() => undefined);
					setStatus("");
					setNotice(t("pair.alreadyYours"));
					return;
				}
				if (noticeKind) {
					setStatus("");
					setNotice(
						noticeKind === "other-pending"
							? t("pair.alreadyOther")
							: t("pair.alreadyOtherUnknown"),
					);
					return;
				}
				await saveLocalBleId(creds.uuid, boardId).catch(() => undefined);
				await refetchBoards({ force: true }).catch(() => undefined);
				setStatus(t("pair.paired"));
				setPaired(true);
			} finally {
				await session.close();
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "pair failed");
			setStatus(t("pair.selectDevice"));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<NearbyPicker
				boards={boards}
				selectedId={boardId}
				onSelect={setBoardId}
				scanning={scanning}
				disabled={busy}
			/>
			<Muted>{status || (notice ? "" : t("pair.readyToScan"))}</Muted>
			{notice ? <Text style={{ color: colors.warning }}>{notice}</Text> : null}
			<ErrorText>{translateError(t, error)}</ErrorText>
			<Busy show={busy || scanning} />
			{paired ? (
				<TextButton
					label={t("pair.backToDevices")}
					onPress={() => setTab("overview")}
				/>
			) : null}
			<TextButton
				label={t("pair.scanNearby")}
				disabled={scanning || busy}
				onPress={() => void scan()}
			/>
			<PrimaryButton
				label={t("pair.pairSelected")}
				disabled={busy || scanning || !boardId || paired}
				onPress={() => void pair()}
			/>
		</Screen>
	);
}
