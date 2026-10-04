import { GET as loadCompanionRelease } from "@api/companion-release";
import { POST as startUpdate } from "@api/update";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { isNewerVersion, type NetworkStatus } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useRef, useState } from "react";
import { useBoardSelection } from "../hooks/useBoardSelection.tsx";
import { useDashboardMode } from "../hooks/useDashboardMode.tsx";
import { useT } from "../hooks/useLocale.tsx";
import { type ActionResult, unwrapAction } from "../lib/action.ts";
import { deviceDisplayName, type StoredPairing } from "../lib/pairing-store.ts";
import DeviceCompanionInfo from "./DeviceCompanionInfo.tsx";
import DeviceLabelField from "./DeviceLabelField.tsx";
import GpioPanel from "./GpioPanel.tsx";

export type DeviceStatus = {
	version?: string;
	hardware?: string;
	model?: string;
	tunnel?: { configured?: boolean; apiHostname?: string };
	secrets?: { githubReady?: boolean; gpioAiKey?: boolean };
	network?: NetworkStatus | null;
};

export type BoardView = {
	device: StoredPairing;
	status: DeviceStatus | null;
};

export default function DeviceBoardCard({
	device,
	status,
	onLabelSaved,
	onUnpair,
	unpairing,
	selected,
	onSelect,
	loadInfo,
}: {
	device: StoredPairing;
	status: DeviceStatus | null;
	onLabelSaved?: (label: string) => void;
	onUnpair?: (uuid: string) => void;
	unpairing?: boolean;
	selected?: boolean;
	onSelect?: (uuid: string) => void;
	loadInfo?: (uuid: string) => Promise<ActionResult<{ info: unknown }>>;
}) {
	const { isEasy } = useDashboardMode();
	const { uuid: selectedUuid } = useBoardSelection();
	const live = Boolean(selected) || device.uuid === selectedUuid;
	const t = useT();
	const [open, setOpen] = useState(false);
	const expanded = open;
	const online = Boolean(status);
	const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
	const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
	const [updateBusy, setUpdateBusy] = useState(false);
	const [updateNote, setUpdateNote] = useState("");
	const [updateError, setUpdateError] = useState("");
	const updateLockRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onboardVersion = status?.version?.trim() || "";
	const updateAvailable = Boolean(
		releaseVersion && isNewerVersion(releaseVersion, onboardVersion || "0.0.0"),
	);
	useEffect(() => {
		if (!expanded || !online || releaseVersion) {
			return;
		}
		let cancelled = false;
		void loadCompanionRelease()
			.then((result) => {
				if (cancelled) {
					return;
				}
				const release = unwrapAction(result);
				setReleaseVersion(release.version ?? null);
				setReleaseUrl(release.url ?? null);
			})
			.catch(() => {
				if (!cancelled) {
					setReleaseVersion(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [expanded, online, releaseVersion]);
	useEffect(
		() => () => {
			if (updateLockRef.current) {
				clearTimeout(updateLockRef.current);
			}
		},
		[],
	);

	async function runUpdate() {
		if (!online || updateBusy) {
			return;
		}
		if (updateLockRef.current) {
			clearTimeout(updateLockRef.current);
			updateLockRef.current = null;
		}
		setUpdateBusy(true);
		setUpdateNote("");
		setUpdateError("");
		try {
			unwrapAction(await startUpdate(device.uuid));
			setUpdateNote(t("debug.updateStarted"));
			updateLockRef.current = setTimeout(() => {
				setUpdateBusy(false);
				updateLockRef.current = null;
			}, 120_000);
		} catch (caught) {
			setUpdateError(
				translateError(
					t,
					caught instanceof Error ? caught.message : "update failed",
				),
			);
			setUpdateBusy(false);
		}
	}
	const networkLabel =
		status?.network?.type === "ethernet"
			? t("devices.ethernet")
			: status?.network?.type === "wifi"
				? status.network.ssid.trim()
					? t("devices.wifiSsid", { ssid: status.network.ssid.trim() })
					: t("nav.wifi")
				: "";
	const isSelected = Boolean(selected) || device.uuid === selectedUuid;
	const summaryMeta = [
		status?.model || status?.hardware || device.uuid.slice(0, 8),
		networkLabel || "",
		isSelected ? t("devices.selected") : "",
	]
		.filter(Boolean)
		.join(" • ");
	function toggle() {
		const next = !open;
		setOpen(next);
		if (next && onSelect) {
			onSelect(device.uuid);
		}
	}

	return (
		<Paper
			className={`device-board-row w-full ${expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""}`}
			elevation={0}
		>
			<Stack spacing={expanded ? 1.5 : 0}>
				<button
					type="button"
					className="device-board-summary"
					onClick={toggle}
					aria-expanded={expanded}
				>
					<span className="device-board-icon" aria-hidden="true">
						<MemoryIcon />
					</span>
					<span className="device-board-copy">
						<Typography variant="subtitle1" noWrap>
							{deviceDisplayName(device)}
						</Typography>
						<Typography color="secondary" variant="caption" noWrap>
							{summaryMeta}
						</Typography>
					</span>
					<span
						className={`device-status-dot ${online ? "is-online" : ""}`}
						aria-hidden="true"
					/>
					<Typography
						color="secondary"
						variant="caption"
						className="device-board-status-label"
					>
						{online ? t("devices.online") : t("devices.offline")}
					</Typography>
					<span
						aria-hidden="true"
						className={`device-board-chevron ${expanded ? "is-expanded" : ""}`}
					>
						<ExpandMoreIcon />
					</span>
				</button>
				{expanded ? (
					<div className="device-board-details">
						<Stack spacing={1.5}>
							{isEasy ? null : (
								<>
									<Typography color="secondary" className="break-all">
										{device.uuid}
									</Typography>
									{device.deviceUrl ? (
										<Typography color="secondary" className="break-all">
											{device.deviceUrl}
										</Typography>
									) : null}
								</>
							)}
							<DeviceLabelField
								key={device.uuid}
								uuid={device.uuid}
								label={device.label}
								onSaved={onLabelSaved}
							/>
							<Stack direction="row" spacing={1} className="flex-wrap">
								<Chip
									label={
										onboardVersion
											? t("devices.companionVersion", {
													version: onboardVersion,
												})
											: t("devices.versionUnknown")
									}
									variant="outlined"
									size="small"
								/>
								{updateAvailable ? (
									<Chip
										label={t("devices.updateAvailable")}
										color="warning"
										variant="outlined"
										size="small"
									/>
								) : null}
								{status?.model || status?.hardware ? (
									<Chip
										label={status?.model || status?.hardware}
										variant="outlined"
										size="small"
									/>
								) : null}
								{networkLabel ? (
									<Chip label={networkLabel} variant="outlined" size="small" />
								) : null}
								{status && !isEasy ? (
									<Chip
										label={
											status.tunnel?.configured
												? t("devices.tunnelReady")
												: t("devices.tunnelPending")
										}
										color={status.tunnel?.configured ? "success" : "secondary"}
										variant="outlined"
										size="small"
									/>
								) : null}
								{status ? (
									<Chip
										label={
											status.secrets?.githubReady
												? t("devices.projectsConnected")
												: t("devices.connectGithubChip")
										}
										color={status.secrets?.githubReady ? "success" : "warning"}
										variant="outlined"
										size="small"
									/>
								) : null}
							</Stack>
							{!isEasy && loadInfo && live ? (
								<DeviceCompanionInfo
									key={device.uuid}
									uuid={selectedUuid || device.uuid}
									loadInfo={loadInfo}
								/>
							) : null}
							{isEasy || !live ? null : (
								<GpioPanel
									uuid={selectedUuid || device.uuid}
									connected={online}
								/>
							)}
							<Stack direction="row" spacing={1} className="flex-wrap">
								<Button href="/devices/code" variant="contained" size="small">
									{t("project.openCode")}
								</Button>
								<CliAuthButton uuid={device.uuid} />
								<Button
									type="button"
									variant="outlined"
									size="small"
									color={updateAvailable ? "primary" : "secondary"}
									disabled={!online || updateBusy}
									onClick={() => void runUpdate()}
								>
									{updateBusy
										? t("devices.updatingCompanion")
										: t("devices.updateCompanion")}
								</Button>
								{!isEasy && onUnpair ? (
									<Button
										type="button"
										variant="outlined"
										size="small"
										disabled={unpairing}
										onClick={() => onUnpair(device.uuid)}
									>
										{t("devices.unpairRevokes")}
									</Button>
								) : null}
							</Stack>
							{updateNote ? (
								<Typography color="secondary">{updateNote}</Typography>
							) : null}
							{updateError ? (
								<Typography color="secondary">
									{translateError(t, updateError)}
								</Typography>
							) : null}
							{releaseUrl && updateAvailable ? (
								<Typography color="secondary">
									<a href={releaseUrl} target="_blank" rel="noreferrer">
										{releaseVersion}
									</a>
								</Typography>
							) : null}
						</Stack>
					</div>
				) : null}
			</Stack>
		</Paper>
	);
}

function CliAuthButton({ uuid }: { uuid: string }) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function start() {
		setBusy(true);
		setError("");
		try {
			const response = await fetch("/api/jlcpcb/cli/start", {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify({ uuid }),
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
				data?: { authorizeUrl?: string };
			} | null;
			const url = payload?.data?.authorizeUrl;
			if (!response.ok || !payload?.ok || !url) {
				throw new Error(payload?.error || "cli login failed");
			}
			window.open(url, "_blank", "noopener,noreferrer");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "cli login failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<Button
				type="button"
				variant="outlined"
				size="small"
				disabled={busy}
				onClick={() => void start()}
			>
				{busy ? t("devices.authenticatingCli") : t("devices.authenticateCli")}
			</Button>
			{error ? (
				<Typography color="secondary">{translateError(t, error)}</Typography>
			) : null}
		</>
	);
}

import ExpandMoreIcon from "@material-design-icons/svg/filled/expand_more.svg";
import MemoryIcon from "@material-design-icons/svg/filled/memory.svg";
