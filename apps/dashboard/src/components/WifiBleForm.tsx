import { GET as getPairing } from "@api/pair";
import { POST as signWifi } from "@api/wifi";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	BLE_CMD_UUID,
	BLE_DEVICE_NAME,
	envelopeToPasteText,
	parseWifiBleStatus,
	WIFI_PATH,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { type FormEvent, useEffect, useState } from "react";
import { useActionError } from "../hooks/useActionError.tsx";
import { useAuthSession } from "../hooks/useAuth.ts";
import { useBoardSelection } from "../hooks/useBoardSelection.tsx";
import { useT } from "../hooks/useLocale.tsx";
import { useOfflineBleKey } from "../hooks/useOfflineBleKey.ts";
import { unwrapAction } from "../lib/action.ts";
import { withOfflineSign } from "../lib/offline-ble.ts";
import type { StoredPairing } from "../lib/pairing-store.ts";
import {
	bluetoothSupported,
	connectGpioCompanionBle,
} from "../lib/web-bluetooth.ts";
import CopyBlock from "./CopyBlock.tsx";
import DeviceSelect from "./DeviceSelect.tsx";
import { SelectSkeleton } from "./skeletons.tsx";

type Status = "idle" | "connecting" | "sending" | "success" | "error";

export default function WifiBleForm() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const { uuid: selectedUuid, setUuid: selectBoard } = useBoardSelection();
	const supported = bluetoothSupported();
	const [ssid, setSsid] = useState("");
	const [psk, setPsk] = useState("");
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [devicesLoading, setDevicesLoading] = useState(true);
	const [status, setStatus] = useState<Status>("idle");
	const [message, setMessage] = useState("");
	const [pasteText, setPasteText] = useState("");
	const uuid = selectedUuid;
	const offline = useOfflineBleKey(uuid);

	useEffect(() => {
		if (!session.data?.id) {
			setDevices([]);
			setDevicesLoading(false);
			return;
		}
		setDevicesLoading(true);
		void run(getPairing())
			.then((result) => {
				setDevices(result?.devices ?? []);
			})
			.finally(() => {
				setDevicesLoading(false);
			});
	}, [session.data?.id, run]);

	if (!session.data?.id && !session.data?.email) {
		return (
			<Typography color="secondary">
				<Button href="/login" variant="text">
					{t("auth.signIn")}
				</Button>{" "}
				{t("auth.toWifi")}
			</Typography>
		);
	}

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		setMessage("");
		if (!uuid) {
			setStatus("error");
			setMessage(t("wifi.pairBefore"));
			return;
		}
		if (!supported) {
			setStatus("sending");
			try {
				const envelope = await withOfflineSign(
					uuid,
					async () => unwrapAction(await signWifi({ uuid, ssid, psk })),
					{
						method: "PUT",
						path: WIFI_PATH,
						body: JSON.stringify({
							ssid: ssid.trim(),
							psk,
							uuid,
						}),
					},
				);
				const text = envelopeToPasteText(envelope);
				setPasteText(text);
				await navigator.clipboard.writeText(text).catch(() => undefined);
				setStatus("success");
				setMessage(t("wifi.copiedPaste"));
				setPsk("");
			} catch (error) {
				setStatus("error");
				setMessage(
					translateError(
						t,
						error instanceof Error ? error.message : "sign failed",
					),
				);
			}
			return;
		}
		setStatus("connecting");
		try {
			const ble = await connectGpioCompanionBle(uuid);
			if (ble.info.uuid && ble.info.uuid !== uuid) {
				ble.disconnect();
				throw new Error("this board is not the selected paired device");
			}
			setStatus("sending");
			const envelope = await withOfflineSign(
				uuid,
				async () =>
					unwrapAction(
						await signWifi({
							uuid,
							ssid,
							psk,
						}),
					),
				{
					method: "PUT",
					path: WIFI_PATH,
					body: JSON.stringify({
						ssid: ssid.trim(),
						psk,
						uuid,
					}),
				},
			);
			const raw = await ble.sendEnvelope(envelope);
			ble.disconnect();
			const parsed = parseWifiBleStatus(raw);
			if (parsed.ok) {
				setMessage(t("wifi.connectedTo", { ssid: parsed.ssid || ssid }));
				setStatus("success");
			} else {
				setMessage(translateError(t, parsed.message));
				setStatus("error");
			}
			setPsk("");
		} catch (error) {
			setStatus("error");
			setMessage(
				translateError(
					t,
					error instanceof Error ? error.message : "wifi failed",
				),
			);
		}
	}

	const busy = status === "connecting" || status === "sending";
	const canSubmit = Boolean(uuid && ssid && psk) && !busy;

	return (
		<Paper className="w-full max-w-xl p-4 min-[900px]:p-6" elevation={1}>
			<form onSubmit={onSubmit}>
				<Stack spacing={2}>
					<Typography variant="body2" color="secondary">
						{t("wifi.keepNearby")}
					</Typography>
					{supported ? null : (
						<Alert severity="error">{t("wifi.safariAlert")}</Alert>
					)}
					{devicesLoading ? (
						<SelectSkeleton />
					) : devices.length === 0 ? (
						<Alert severity="info">
							<Button href="/devices/pair" variant="text">
								{t("wifi.pairBefore")}
							</Button>
						</Alert>
					) : (
						<DeviceSelect
							devices={devices}
							value={uuid}
							onChange={selectBoard}
							disabled={busy}
						/>
					)}
					<TextField
						label={t("wifi.networkName")}
						value={ssid}
						onChange={(event) => setSsid(event.target.value)}
						className="w-full"
					/>
					<TextField
						label={t("wifi.password")}
						type="password"
						autoComplete="off"
						value={psk}
						onChange={(event) => setPsk(event.target.value)}
						className="w-full"
					/>
					{uuid ? (
						<Typography variant="body2" color="secondary">
							{offline.label}
						</Typography>
					) : null}
					<Button type="submit" variant="contained" disabled={!canSubmit}>
						{status === "connecting"
							? t("wifi.connecting")
							: status === "sending"
								? t("wifi.signing")
								: supported
									? t("wifi.connectBoard")
									: t("wifi.signAndCopy")}
					</Button>
					{supported ? null : (
						<>
							<Typography variant="body2" color="secondary">
								{t("wifi.iosStep1")}
							</Typography>
							<Typography variant="body2" color="secondary">
								{t("wifi.iosStep2")}
							</Typography>
							<CopyBlock
								label={t("ble.bluetoothName")}
								value={BLE_DEVICE_NAME}
							/>
							<CopyBlock
								label={t("ble.writeCharacteristic")}
								value={BLE_CMD_UUID}
							/>
						</>
					)}
					{pasteText ? (
						<CopyBlock label={t("ble.signedCommand")} value={pasteText} />
					) : null}
					{message ? (
						<Alert severity={status === "error" ? "error" : "success"}>
							{message}
						</Alert>
					) : null}
				</Stack>
			</form>
		</Paper>
	);
}
