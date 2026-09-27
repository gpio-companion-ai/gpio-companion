import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { parseWifiBleStatus } from "gpio-companion-wifi";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	bleScan,
	bleWifi,
	type KnownNetwork,
	knownNetworkLabel,
	type NearbyBoard,
	nearbyBoardLabel,
	onBleStatus,
	rememberBleMac,
	savedBleId,
	wifiKnownNetworks,
	wifiNetworkPsk,
	wifiRememberNetwork,
} from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey";
import { useT } from "../locale";
import DebugLog from "./DebugLog";
import { SelectSkeleton } from "./skeletons";

const MANUAL = "manual";

function networkValue(ssid: string) {
	return `ssid:${ssid}`;
}

export default function Wifi({ onBack }: { onBack: () => void }) {
	const t = useT();
	const {
		devices,
		loading: devicesLoading,
		error: devicesError,
	} = useUserBoards();
	const { uuid: selectedBoard, setUuid: selectBoard } = useBoardSelection();
	const [boards, setBoards] = useState<NearbyBoard[]>([]);
	const uuid = selectedBoard;
	const [boardId, setBoardId] = useState("auto");
	const offline = useOfflineBleKey(uuid);
	const [networks, setNetworks] = useState<KnownNetwork[]>([]);
	const [networkId, setNetworkId] = useState(MANUAL);
	const [ssid, setSsid] = useState("");
	const [psk, setPsk] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState("");
	const [result, setResult] = useState("");
	const [error, setError] = useState("");
	const [scanning, setScanning] = useState(false);
	const [busy, setBusy] = useState(false);
	const scanRef = useRef(0);
	const holdStatus = useRef(false);
	const shown = translateError(t, error || devicesError);

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

	const applyNetwork = useCallback(async (network: KnownNetwork) => {
		setSsid(network.ssid);
		if (network.psk) {
			setPsk(network.psk);
			return;
		}
		try {
			const secret = await wifiNetworkPsk(network.ssid);
			setPsk(secret);
		} catch {
			setPsk("");
		}
	}, []);

	const loadNetworks = useCallback(async () => {
		try {
			const next = await wifiKnownNetworks();
			setNetworks(next);
			const current = next.find((network) => network.current && network.psk);
			if (current) {
				setNetworkId(networkValue(current.ssid));
				await applyNetwork(current);
			}
		} catch {
			setNetworks([]);
		}
	}, [applyNetwork]);

	useEffect(() => {
		void loadNetworks();
	}, [loadNetworks]);

	const scan = useCallback(async () => {
		const generation = ++scanRef.current;
		setScanning(true);
		setError("");
		try {
			const next = await bleScan();
			if (scanRef.current !== generation) {
				return;
			}
			setBoards(next);
			const pick =
				next.find((board) => board.matched)?.id ?? next[0]?.id ?? "auto";
			setBoardId(pick);
		} catch (caught) {
			if (scanRef.current !== generation) {
				return;
			}
			const message = caught instanceof Error ? caught.message : "scan failed";
			console.error("gpio-companion-desktop wifi scan", message);
			setError(message);
		} finally {
			if (scanRef.current === generation) {
				setScanning(false);
			}
		}
	}, []);

	const savedId = savedBleId(devices.find((device) => device.uuid === uuid));

	useEffect(() => {
		if (savedId) {
			setBoardId(savedId);
			setStatus(t("wifi.usingSavedLink"));
			return;
		}
		void scan();
	}, [scan, savedId, t]);

	async function pickNetwork(next: string) {
		setNetworkId(next);
		if (next === MANUAL) {
			return;
		}
		const ssidValue = next.startsWith("ssid:") ? next.slice(5) : next;
		const found = networks.find((network) => network.ssid === ssidValue);
		if (found) {
			await applyNetwork(found);
		}
	}

	async function send() {
		const trimmedSsid = ssid.trim();
		if (!trimmedSsid) {
			setError("Enter a WiFi network name (SSID)");
			return;
		}
		if (psk.length < 8) {
			setError("WiFi password must be at least 8 characters");
			return;
		}
		setBusy(true);
		setError("");
		setResult("");
		holdStatus.current = false;
		try {
			const raw = await bleWifi({
				uuid,
				ssid: trimmedSsid,
				psk,
				id: boardId === "auto" ? savedId : boardId,
			});
			holdStatus.current = true;
			setStatus("");
			const parsed = parseWifiBleStatus(raw);
			if (!parsed.ok) {
				setError(parsed.message);
				return;
			}
			if (boardId !== "auto") {
				void rememberBleMac(uuid, boardId);
			}
			setResult(t("wifi.connectedTo", { ssid: parsed.ssid || trimmedSsid }));
			try {
				await wifiRememberNetwork(trimmedSsid, psk);
				const next = await wifiKnownNetworks();
				setNetworks(next);
				setNetworkId(networkValue(trimmedSsid));
			} catch {
				// keep local fields; remember is best-effort
			}
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "wifi failed";
			console.error("gpio-companion-desktop wifi", message);
			setError(message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Stack spacing={1.5}>
			{uuid ? (
				<Typography variant="body2" color="secondary">
					{offline.label}
				</Typography>
			) : null}
			{devicesLoading ? (
				<SelectSkeleton height={56} width="100%" />
			) : (
				<Select
					name="uuid"
					label={t("devices.pairedDevice")}
					value={uuid}
					onSelect={selectBoard}
					sx={{ width: "100%" }}
					disabled={devices.length === 0}
				>
					{devices.map((device) => (
						<option key={device.uuid} value={device.uuid}>
							{device.label?.trim()
								? `${device.label.trim()} — ${device.uuid}`
								: device.uuid}
						</option>
					))}
				</Select>
			)}
			<Select
				name="board"
				label={t("ble.nearbyDevice")}
				value={boardId}
				onSelect={(next) => setBoardId(next)}
				sx={{ width: "100%" }}
				disabled={scanning || busy}
			>
				{[
					<option key="auto" value="auto">
						{scanning
							? t("ble.scanning")
							: boards.length === 0 && !savedId
								? t("ble.noNearby")
								: t("ble.autoDetect")}
					</option>,
					...(savedId && !boards.some((board) => board.id === savedId)
						? [
								<option key={savedId} value={savedId}>
									{t("ble.savedCompanion")}
								</option>,
							]
						: []),
					...boards.map((board) => (
						<option key={board.id} value={board.id}>
							{nearbyBoardLabel(board, t)}
						</option>
					)),
				]}
			</Select>
			<Select
				name="network"
				label={t("wifi.savedNetwork")}
				value={networkId}
				onSelect={(next) => void pickNetwork(next)}
				sx={{ width: "100%" }}
				disabled={busy}
			>
				{[
					<option key={MANUAL} value={MANUAL}>
						{t("wifi.enterManually")}
					</option>,
					...networks.map((network) => (
						<option key={network.ssid} value={networkValue(network.ssid)}>
							{knownNetworkLabel(network, t)}
						</option>
					)),
				]}
			</Select>
			<TextField
				label={t("wifi.ssid")}
				value={ssid}
				onChange={(event) => setSsid(event.target.value)}
			/>
			<TextField
				label={t("wifi.password")}
				type={showPassword ? "text" : "password"}
				value={psk}
				onChange={(event) => setPsk(event.target.value)}
			/>
			<Button
				variant="text"
				onClick={() => setShowPassword((current) => !current)}
			>
				{showPassword ? t("wifi.hidePassword") : t("wifi.showPassword")}
			</Button>
			{status ? <Typography>{status}</Typography> : null}
			{result ? <Alert severity="success">{result}</Alert> : null}
			{shown ? <Alert severity="error">{shown}</Alert> : null}
			{shown ? <DebugLog error={shown} /> : null}
			<Button
				variant="contained"
				disabled={busy || scanning || !uuid}
				onClick={() => void send()}
			>
				{t("wifi.send")}
			</Button>
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
