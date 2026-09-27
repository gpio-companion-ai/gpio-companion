import { parseWifiBleStatus } from "gpio-companion-wifi";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { NearbyPicker } from "../components/NearbyPicker.tsx";
import { SavedWifiPicker } from "../components/SavedWifiPicker.tsx";
import {
	Busy,
	ErrorText,
	Field,
	Muted,
	PrimaryButton,
	Screen,
	TextButton,
} from "../components/ui.tsx";
import { deviceDisplayName, signWifi } from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import {
	ensureBluetoothOn,
	type NearbyRadio,
	scanNearby,
	sendEnvelope,
} from "../lib/ble.ts";
import { looksLikeMac } from "../lib/ble-frame.ts";
import { loadLocalBleId } from "../lib/ble-ids.ts";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import {
	HOTSPOT_SETTINGS_FAILED,
	openAndroidHotspotSettings,
} from "../lib/hotspot-settings.ts";
import { translateError, useT } from "../lib/locale.tsx";
import { openPairedBoard } from "../lib/paired-ble.ts";
import { useOfflineBleKey } from "../lib/use-offline-ble-key.ts";
import {
	MANUAL_NETWORK,
	networkValue,
	type SavedNetwork,
	ssidFromValue,
} from "../lib/wifi-networks.ts";
import {
	loadSavedNetworks,
	rememberNetwork,
} from "../lib/wifi-networks-store.ts";

export default function Wifi() {
	const auth = useAuth();
	const t = useT();
	const colors = useColors();
	const { uuid: selectedUuid, setUuid } = useBoardSelection();
	const { devices, error: loadError } = useUserBoards();
	const uuid = selectedUuid;
	const [boardId, setBoardId] = useState("");
	const [boards, setBoards] = useState<NearbyRadio[]>([]);
	const [networks, setNetworks] = useState<SavedNetwork[]>([]);
	const [networkId, setNetworkId] = useState(MANUAL_NETWORK);
	const offline = useOfflineBleKey(uuid);
	const [ssid, setSsid] = useState("");
	const [psk, setPsk] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState("");
	const [result, setResult] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [scanning, setScanning] = useState(false);
	const scanRef = useRef(0);
	const savedMac = devices.find((board) => board.uuid === uuid)?.bleMac ?? "";
	const [savedId, setSavedId] = useState("");

	useEffect(() => {
		void loadSavedNetworks().then(setNetworks);
	}, []);

	const scan = useCallback(async () => {
		const generation = ++scanRef.current;
		setScanning(true);
		setError("");
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
					: t("wifi.foundNearby", { n: next.length }),
			);
		} catch (caught) {
			if (scanRef.current !== generation) {
				return;
			}
			setError(caught instanceof Error ? caught.message : "scan failed");
			setStatus("");
		} finally {
			if (scanRef.current === generation) {
				setScanning(false);
			}
		}
	}, [t]);

	useEffect(() => {
		let cancelled = false;
		void loadLocalBleId(uuid).then((id) => {
			if (!cancelled) {
				setSavedId(id || savedMac);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [uuid, savedMac]);

	useEffect(() => {
		if (savedId) {
			setBoardId(savedId);
			setStatus(t("wifi.usingSavedLink"));
			return;
		}
		void scan();
	}, [scan, savedId, t]);

	function pickNetwork(next: string) {
		setNetworkId(next);
		if (next === MANUAL_NETWORK) {
			return;
		}
		const found = networks.find(
			(network) => network.ssid === ssidFromValue(next),
		);
		if (found) {
			setSsid(found.ssid);
			setPsk(found.psk);
		}
	}

	async function openHotspot() {
		setError("");
		if (Platform.OS === "ios") {
			Alert.alert(t("wifi.openHotspot"), t("wifi.hotspotIosHelp"));
			return;
		}
		try {
			await openAndroidHotspotSettings((action) => Linking.sendIntent(action));
		} catch {
			setError(HOTSPOT_SETTINGS_FAILED);
		}
	}

	async function send() {
		if (busy || scanning) {
			return;
		}
		if (!auth.token) {
			setError("sign in first");
			return;
		}
		if (!uuid) {
			setError(t("wifi.chooseBoard"));
			return;
		}
		if (!ssid.trim()) {
			setError(t("wifi.enterNetwork"));
			return;
		}
		if (psk.length < 8) {
			setError(t("wifi.passwordMin"));
			return;
		}
		setBusy(true);
		setError("");
		setResult("");
		try {
			setStatus(t("wifi.connecting"));
			const paired = await openPairedBoard(uuid, {
				token: auth.token,
				bleMac: savedMac || (looksLikeMac(boardId) ? boardId : ""),
			});
			try {
				setStatus(t("wifi.signing"));
				const envelope = await signWifi(auth.token, {
					uuid,
					ssid: ssid.trim(),
					psk,
				});
				setStatus(t("wifi.writing"));
				const raw = await sendEnvelope(
					paired.session.device,
					envelope,
					paired.loss,
				);
				const parsed = parseWifiBleStatus(raw);
				if (!parsed.ok) {
					setStatus("");
					setError(parsed.message);
					return;
				}
				setStatus("");
				setResult(t("wifi.connectedTo", { ssid: parsed.ssid || ssid.trim() }));
				try {
					const next = await rememberNetwork(ssid.trim(), psk);
					setNetworks(next);
					setNetworkId(networkValue(ssid.trim()));
				} catch {
					// keep local fields; remember is best-effort
				}
			} finally {
				await paired.session.close();
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "wifi failed");
			setStatus("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			{uuid ? <Muted>{offline.label}</Muted> : null}
			<Muted>{t("wifi.pairedBoard")}</Muted>
			{devices.length === 0 ? (
				<Muted>{t("wifi.noPaired")}</Muted>
			) : (
				<View style={{ gap: 8 }}>
					{devices.map((board) => {
						const selected = board.uuid === uuid;
						return (
							<Pressable
								key={board.uuid}
								onPress={() => setUuid(board.uuid)}
								style={{
									backgroundColor: colors.surface,
									borderRadius: 12,
									padding: 12,
									borderWidth: 1,
									borderColor: selected ? colors.primary : colors.border,
								}}
							>
								<Text
									style={{
										color: selected ? colors.primary : colors.text,
										fontWeight: selected ? "600" : "400",
									}}
								>
									{deviceDisplayName(board)}
								</Text>
							</Pressable>
						);
					})}
				</View>
			)}
			<NearbyPicker
				boards={
					savedId && !boards.some((board) => board.id === savedId)
						? [
								{
									id: savedId,
									name: "gpio-companion",
									rssi: null,
									matched: true,
								},
								...boards,
							]
						: boards
				}
				selectedId={boardId}
				onSelect={setBoardId}
				scanning={scanning}
				disabled={busy}
			/>
			<TextButton
				label={t("pair.scanNearby")}
				disabled={scanning || busy}
				onPress={() => void scan()}
			/>
			<Muted>{t("wifi.hotspotHint")}</Muted>
			<TextButton
				label={t("wifi.openHotspot")}
				disabled={busy}
				onPress={() => void openHotspot()}
			/>
			<SavedWifiPicker
				networks={networks}
				selectedId={networkId}
				onSelect={pickNetwork}
				disabled={busy}
			/>
			<Field
				label={t("wifi.networkName")}
				value={ssid}
				onChangeText={setSsid}
				placeholder={t("wifi.ssid")}
			/>
			<Field
				label={t("wifi.password")}
				value={psk}
				onChangeText={setPsk}
				placeholder={t("wifi.passwordPlaceholder")}
				secure={!showPassword}
			/>
			<TextButton
				label={showPassword ? t("wifi.hidePassword") : t("wifi.showPassword")}
				onPress={() => setShowPassword((current) => !current)}
			/>
			{status ? <Muted>{status}</Muted> : null}
			{result ? <Text style={{ color: colors.success }}>{result}</Text> : null}
			<ErrorText>{translateError(t, error || loadError || "")}</ErrorText>
			<Busy show={busy || scanning} />
			<PrimaryButton
				label={t("wifi.send")}
				disabled={busy || scanning || !uuid || !boardId}
				onPress={() => void send()}
			/>
		</Screen>
	);
}
