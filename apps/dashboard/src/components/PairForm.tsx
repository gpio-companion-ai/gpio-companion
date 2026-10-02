import {
	POST as claimPairing,
	GET as getPairing,
	PUT as signCredentials,
	DELETE as unpairDevice,
} from "@api/pair";
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
	pairClaimNotice,
	publicDeviceUrl,
	tunnelHostnames,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useActionError } from "../hooks/useActionError.tsx";
import { useAuthSession } from "../hooks/useAuth.ts";
import { useT } from "../hooks/useLocale.tsx";
import { unwrapAction } from "../lib/action.ts";
import { openLoginDialog } from "../lib/auth/refresh.ts";
import type { StoredPairing } from "../lib/pairing-store.ts";
import {
	bluetoothAvailable,
	bluetoothChooserCancelled,
	connectGpioCompanionBle,
} from "../lib/web-bluetooth.ts";
import CopyBlock from "./CopyBlock.tsx";
import DeviceSelect from "./DeviceSelect.tsx";

const LIGHTBLUE = "https://apps.apple.com/app/lightblue/id557428110";
const NRF_CONNECT =
	"https://apps.apple.com/app/nrf-connect-for-mobile/id1054366564";

export default function PairForm({
	onComplete,
	variant = "page",
}: {
	onComplete?: (info: { deviceUrl: string; uuid: string }) => void;
	variant?: "page" | "dialog";
}) {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const [bleReady, setBleReady] = useState(false);
	const [deviceUrl, setDeviceUrl] = useState("");
	const [uuid, setUuid] = useState("");
	const [key, setKey] = useState("");
	const [status, setStatus] = useState("");
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	const [paired, setPaired] = useState("");
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [unpairUuid, setUnpairUuid] = useState("");
	const [pasteText, setPasteText] = useState("");
	const [manualOpen, setManualOpen] = useState(false);

	const applyDevices = useCallback((next: StoredPairing[]) => {
		setDevices(next);
		const last = next.at(-1);
		setPaired(last?.login ?? "");
		setUnpairUuid((current) => {
			if (current && next.some((device) => device.uuid === current)) {
				return current;
			}
			return last?.uuid ?? "";
		});
	}, []);

	useEffect(() => {
		void bluetoothAvailable().then(setBleReady);
	}, []);

	useEffect(() => {
		if (!session.data?.id) {
			return;
		}
		void run(getPairing()).then((result) => {
			applyDevices(result?.devices ?? []);
		});
	}, [session.data?.id, run, applyDevices]);

	async function applyCredentials(raw: string, infoDeviceUrl?: string) {
		const body = JSON.parse(raw) as {
			uuid?: string;
			key?: string;
			deviceUrl?: string;
		};
		if (!body.uuid || !body.key) {
			throw new Error("board did not return pairing credentials");
		}
		setUuid(body.uuid);
		setKey(body.key);
		setDeviceUrl(
			body.deviceUrl ||
				infoDeviceUrl ||
				publicDeviceUrl(tunnelHostnames(body.uuid).apiHostname),
		);
		setStatus(t("pair.statusCredentialsLoaded"));
	}

	async function copySignedCommand(
		envelope: Parameters<typeof envelopeToPasteText>[0],
		message = t("pair.statusCopiedPaste"),
	) {
		const text = envelopeToPasteText(envelope);
		setPasteText(text);
		await navigator.clipboard.writeText(text).catch(() => undefined);
		setStatus(message);
	}

	async function retrieveCredentials() {
		setError("");
		setStatus(t("pair.statusCheckingBle"));
		try {
			const canBle = await bluetoothAvailable();
			setBleReady(canBle);
			if (canBle) {
				setStatus(t("pair.statusSelectDevice"));
				try {
					const ble = await connectGpioCompanionBle(uuid);
					setStatus(t("pair.statusReading"));
					const envelope = unwrapAction(await signCredentials());
					const raw = await ble.sendEnvelope(envelope);
					ble.disconnect();
					await applyCredentials(raw, ble.info.deviceUrl);
					return;
				} catch (caught) {
					if (bluetoothChooserCancelled(caught)) {
						setStatus("");
						return;
					}
				}
			}
			const envelope = unwrapAction(await signCredentials());
			await copySignedCommand(envelope);
		} catch (caught) {
			setStatus("");
			setError(
				translateError(
					t,
					caught instanceof Error ? caught.message : "retrieve failed",
				),
			);
		}
	}

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!session.data?.id) {
			setError(t("common.signInFirst"));
			return;
		}
		setError("");
		setNotice("");
		setStatus(t("pair.statusPairing"));
		try {
			const body = unwrapAction(
				await claimPairing({
					deviceUrl,
					uuid,
					key,
				}),
			);
			const noticeKind = pairClaimNotice(body);
			if (noticeKind) {
				setStatus("");
				setKey("");
				setNotice(
					noticeKind === "yours"
						? t("pair.alreadyYours")
						: noticeKind === "other-pending"
							? t("pair.alreadyOther")
							: t("pair.alreadyOtherUnknown"),
				);
				if (noticeKind === "yours") {
					const listing = await run(getPairing());
					applyDevices(listing?.devices ?? []);
				}
				return;
			}
			if ("needsBle" in body && body.needsBle && "envelope" in body) {
				const canBle = await bluetoothAvailable();
				setBleReady(canBle);
				if (canBle) {
					try {
						const ble = await connectGpioCompanionBle(uuid);
						await ble.sendEnvelope(body.envelope);
						ble.disconnect();
					} catch (caught) {
						if (bluetoothChooserCancelled(caught)) {
							setStatus("");
							return;
						}
						await copySignedCommand(body.envelope, t("pair.statusClaimCopied"));
						return;
					}
				} else {
					await copySignedCommand(body.envelope, t("pair.statusClaimCopied"));
					return;
				}
			}
			if ("login" in body && typeof body.login === "string") {
				setPaired(body.login);
			}
			const nextUrl =
				"deviceUrl" in body && typeof body.deviceUrl === "string"
					? body.deviceUrl
					: deviceUrl;
			if (nextUrl) {
				setDeviceUrl(nextUrl);
			}
			const boardUuid =
				"uuid" in body && typeof body.uuid === "string" ? body.uuid : uuid;
			setStatus(t("pair.statusPaired"));
			setKey("");
			const listing = await run(getPairing());
			applyDevices(listing?.devices ?? []);
			onComplete?.({ deviceUrl: nextUrl, uuid: boardUuid });
		} catch (caught) {
			setStatus("");
			setError(
				translateError(
					t,
					caught instanceof Error ? caught.message : "pair failed",
				),
			);
		}
	}

	if (!session.data?.id && !session.data?.email) {
		return (
			<Typography color="secondary">
				<Button onClick={openLoginDialog} variant="text">
					{t("auth.signIn")}
				</Button>{" "}
				{t("auth.toPair")}
			</Typography>
		);
	}

	const hideManagedList = variant === "dialog";
	const form = (
		<form onSubmit={onSubmit}>
			<Stack spacing={2}>
				{!hideManagedList && devices.length > 0 ? (
					<Alert severity="success">
						{devices.length === 1
							? t("pair.pairedAs", { login: paired || devices[0]?.login || "" })
							: t("pair.nBoardsPaired", { n: devices.length })}
					</Alert>
				) : null}
				<Button
					type="button"
					variant="contained"
					onClick={() => void retrieveCredentials()}
				>
					{bleReady ? t("pair.connectBle") : t("pair.signBleCommand")}
				</Button>
				<Typography variant="body2" color="secondary">
					{bleReady ? t("pair.bleReadyHint") : t("pair.bleUnavailableHint")}{" "}
					<Button href={LIGHTBLUE} variant="text">
						LightBlue
					</Button>{" "}
					or{" "}
					<Button href={NRF_CONNECT} variant="text">
						nRF Connect
					</Button>
					.
				</Typography>
				{bleReady ? null : (
					<>
						<CopyBlock label={t("ble.bluetoothName")} value={BLE_DEVICE_NAME} />
						<CopyBlock
							label={t("ble.writeCharacteristic")}
							value={BLE_CMD_UUID}
						/>
					</>
				)}
				<Button
					type="button"
					variant="text"
					onClick={() => setManualOpen((open) => !open)}
				>
					{t("pair.manualSetup")}
				</Button>
				{manualOpen ? (
					<>
						<Typography variant="body2" color="secondary">
							{t("pair.manualSetupHint")}
						</Typography>
						<TextField
							label={t("pair.deviceUrl")}
							placeholder={t("pair.deviceUrlPlaceholder")}
							value={deviceUrl}
							onChange={(event) => setDeviceUrl(event.target.value)}
							className="w-full"
						/>
						<TextField
							label={t("pair.pairingUuid")}
							value={uuid}
							onChange={(event) => setUuid(event.target.value)}
							className="w-full"
						/>
						<TextField
							label={t("pair.pairingKey")}
							type="password"
							value={key}
							onChange={(event) => setKey(event.target.value)}
							className="w-full"
						/>
					</>
				) : null}
				<Button type="submit" variant="contained" disabled={!uuid || !key}>
					{t("pair.submit")}
				</Button>
				{!hideManagedList && devices.length > 0 ? (
					<>
						{devices.length > 1 ? (
							<DeviceSelect
								devices={devices}
								value={unpairUuid}
								onChange={setUnpairUuid}
								label={t("pair.unpairDevice")}
							/>
						) : null}
						<Button
							type="button"
							variant="outlined"
							onClick={() => {
								const target = unpairUuid || devices[0]?.uuid;
								if (!target) {
									return;
								}
								void run(unpairDevice(target)).then((result) => {
									if (!result) {
										return;
									}
									void run(getPairing()).then((listing) => {
										applyDevices(listing?.devices ?? []);
									});
									setStatus(t("pair.statusUnpaired"));
								});
							}}
						>
							{t("devices.unpairRevokes")}
						</Button>
					</>
				) : null}
				{pasteText ? (
					<CopyBlock label={t("ble.signedCommand")} value={pasteText} />
				) : null}
				{notice ? <Alert severity="info">{notice}</Alert> : null}
				{status ? <Typography color="secondary">{status}</Typography> : null}
				{error ? <Alert severity="error">{error}</Alert> : null}
			</Stack>
		</form>
	);

	if (variant === "dialog") {
		return form;
	}

	return (
		<Paper className="w-full max-w-xl p-4 min-[900px]:p-6" elevation={1}>
			{form}
		</Paper>
	);
}
