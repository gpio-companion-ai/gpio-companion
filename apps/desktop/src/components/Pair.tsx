import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { pairClaimNotice } from "gpio-companion-pairing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	blePair,
	bleScan,
	type NearbyBoard,
	nearbyBoardLabel,
	onBleStatus,
	rememberBleMac,
} from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useT } from "../locale";
import DebugLog from "./DebugLog";

export default function Pair({ onBack }: { onBack: () => void }) {
	const t = useT();
	const [boards, setBoards] = useState<NearbyBoard[]>([]);
	const [selected, setSelected] = useState("");
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");
	const [scanning, setScanning] = useState(false);
	const [busy, setBusy] = useState(false);
	const [paired, setPaired] = useState(false);
	const [notice, setNotice] = useState("");
	const scanRef = useRef(0);
	const holdStatus = useRef(false);
	const { refetch: refetchBoards } = useUserBoards();
	const shown = translateError(t, error);

	useEffect(() => {
		setStatus(t("pair.readyToScan"));
	}, [t]);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		void onBleStatus((message) => {
			if (holdStatus.current) {
				return;
			}
			setStatus(message);
		}).then((fn) => {
			unlisten = fn;
		});
		return () => unlisten?.();
	}, []);

	const scan = useCallback(async () => {
		const generation = ++scanRef.current;
		setScanning(true);
		setError("");
		setNotice("");
		holdStatus.current = false;
		try {
			const next = await bleScan();
			if (scanRef.current !== generation) {
				return;
			}
			setBoards(next);
			const pick = next.find((board) => board.matched)?.id ?? next[0]?.id ?? "";
			setSelected(pick);
		} catch (caught) {
			if (scanRef.current !== generation) {
				return;
			}
			const message = caught instanceof Error ? caught.message : "scan failed";
			console.error("gpio-companion-desktop scan", message);
			setError(message);
		} finally {
			if (scanRef.current === generation) {
				setScanning(false);
			}
		}
	}, []);

	useEffect(() => {
		void scan();
	}, [scan]);

	async function pair() {
		if (!selected) {
			setError("Select a device to pair with");
			return;
		}
		setBusy(true);
		setError("");
		setNotice("");
		holdStatus.current = false;
		try {
			const claimed = await blePair(selected);
			holdStatus.current = true;
			const noticeKind = pairClaimNotice(claimed);
			const pairedUuid =
				claimed &&
				typeof claimed === "object" &&
				"uuid" in claimed &&
				typeof claimed.uuid === "string"
					? claimed.uuid
					: "";
			if (noticeKind === "yours") {
				if (pairedUuid) {
					void rememberBleMac(pairedUuid, selected);
				}
				setPaired(false);
				setStatus("");
				setNotice(t("pair.alreadyYours"));
				void refetchBoards({ force: true }).catch(() => undefined);
				return;
			}
			if (noticeKind) {
				setPaired(false);
				setStatus("");
				setNotice(
					noticeKind === "other-pending"
						? t("pair.alreadyOther")
						: t("pair.alreadyOtherUnknown"),
				);
				return;
			}
			if (pairedUuid) {
				void rememberBleMac(pairedUuid, selected);
			}
			setPaired(true);
			setStatus(t("pair.paired"));
			void refetchBoards({ force: true }).catch(() => undefined);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "pair failed";
			console.error("gpio-companion-desktop pair", message);
			setError(message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Stack spacing={1.5}>
			<Select
				name="board"
				label={t("pair.selectDevice")}
				value={selected}
				onSelect={(next) => setSelected(next)}
				sx={{ width: "100%" }}
				disabled={boards.length === 0 || scanning || busy}
			>
				{boards.map((board) => (
					<option key={board.id} value={board.id}>
						{nearbyBoardLabel(board, t)}
					</option>
				))}
			</Select>
			<Typography>{status || (notice ? "" : t("pair.readyToScan"))}</Typography>
			{notice ? <Alert severity="info">{notice}</Alert> : null}
			{shown ? <Alert severity="error">{shown}</Alert> : null}
			{shown ? <DebugLog error={shown} /> : null}
			<Button
				variant="contained"
				disabled={busy || scanning || !selected || paired}
				onClick={() => void pair()}
			>
				{t("pair.pairSelected")}
			</Button>
			{paired ? (
				<Button variant="contained" color="secondary" onClick={onBack}>
					{t("pair.backToDevices")}
				</Button>
			) : null}
			<Button
				variant="text"
				disabled={busy || scanning}
				onClick={() => void scan()}
			>
				{t("pair.scanNearby")}
			</Button>
			<Button variant="text" onClick={onBack}>
				{t("pair.back")}
			</Button>
		</Stack>
	);
}
