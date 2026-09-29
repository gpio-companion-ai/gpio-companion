import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { useState } from "react";
import {
	type BoardView,
	deviceDisplayName,
	openExternal,
	patchDeviceLabel,
	startCliLogin,
} from "../api";
import { formatNetworkLabel } from "../device-info";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { useT } from "../locale";
import CompanionInfo from "./CompanionInfo";
import FlashProxyButton from "./FlashProxyButton";
import GpioPanel from "./GpioPanel";

function MemoryIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="currentColor"
				d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"
			/>
		</svg>
	);
}

function ExpandMoreIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="currentColor"
				d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"
			/>
		</svg>
	);
}

export default function BoardCard({
	board,
	selected,
	onSelect,
	onUnpair,
	onLabelSaved,
}: {
	board: BoardView;
	selected?: boolean;
	onSelect?: (uuid: string) => void;
	onUnpair?: (uuid: string) => void;
	onLabelSaved?: (uuid: string, label: string) => void;
}) {
	const t = useT();
	const { isEasy } = useDashboardMode();
	const { openCode } = useBoardSelection();
	const { device, status } = board;
	const online = Boolean(status);
	const networkLabel = formatNetworkLabel(status?.network, t);
	const [label, setLabel] = useState(device.label ?? "");
	const [saving, setSaving] = useState(false);
	const [open, setOpen] = useState(false);
	const [confirmUnpair, setConfirmUnpair] = useState(false);
	const expanded = open;

	async function saveLabel() {
		setSaving(true);
		try {
			await patchDeviceLabel(device.uuid, label);
			onLabelSaved?.(device.uuid, label);
		} finally {
			setSaving(false);
		}
	}

	function toggle() {
		const next = !open;
		setOpen(next);
		if (next && onSelect) {
			onSelect(device.uuid);
		}
	}

	return (
		<Paper
			className={`device-board-row ${expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""}`}
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
							{status?.model || status?.hardware || device.uuid.slice(0, 8)}
						</Typography>
					</span>
					<span
						className={`device-status-dot ${online ? "is-online" : ""}`}
						aria-hidden="true"
					/>
					<Typography color="secondary" variant="caption">
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
									<Typography color="secondary" sx={{ wordBreak: "break-all" }}>
										{device.uuid}
									</Typography>
									{device.deviceUrl ? (
										<Typography
											color="secondary"
											sx={{ wordBreak: "break-all" }}
										>
											{device.deviceUrl}
										</Typography>
									) : null}
								</>
							)}
							<Stack
								direction="row"
								spacing={1}
								sx={{ alignItems: "flex-end", flexWrap: "wrap" }}
							>
								<TextField
									label={t("devices.label")}
									placeholder={t("devices.optionalName")}
									value={label}
									onChange={(event) => setLabel(event.target.value)}
									sx={{ flex: 1, minWidth: 180 }}
								/>
								<Button
									variant="outlined"
									size="small"
									disabled={saving}
									onClick={() => void saveLabel()}
								>
									{t("devices.save")}
								</Button>
							</Stack>
							<Stack
								direction="row"
								spacing={1}
								sx={{ flexWrap: "wrap", gap: 1 }}
							>
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
									<>
										<Chip
											label={
												status.secrets?.githubReady
													? t("devices.githubReady")
													: t("devices.githubKeysPending")
											}
											color={
												status.secrets?.githubReady ? "success" : "warning"
											}
											variant="outlined"
											size="small"
										/>
									</>
								) : null}
							</Stack>
							{isEasy ? null : (
								<CompanionInfo key={device.uuid} uuid={device.uuid} />
							)}
							{selected ? (
								<FlashProxyButton uuid={device.uuid} connected={online} />
							) : null}
							{isEasy || !selected ? null : (
								<GpioPanel
									key={`${device.uuid}-gpio`}
									uuid={device.uuid}
									connected={Boolean(status)}
								/>
							)}
							<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
								<Button
									variant="contained"
									size="small"
									onClick={() => {
										onSelect?.(device.uuid);
										openCode();
									}}
								>
									{t("project.openCode")}
								</Button>
								<CliAuthButton uuid={device.uuid} />
								{!isEasy && onUnpair ? (
									<Button
										color="error"
										variant="text"
										size="small"
										onClick={() => setConfirmUnpair(true)}
									>
										{t("devices.unpair")}
									</Button>
								) : null}
							</Stack>
						</Stack>
					</div>
				) : null}
			</Stack>
			<Dialog open={confirmUnpair} onClose={() => setConfirmUnpair(false)}>
				<DialogTitle>{t("devices.unpairTitle")}</DialogTitle>
				<DialogContent>
					<Typography>{t("devices.unpairConfirm")}</Typography>
					<Typography color="secondary">{t("devices.unpairDetail")}</Typography>
				</DialogContent>
				<DialogActions>
					<Button variant="text" onClick={() => setConfirmUnpair(false)}>
						{t("devices.close")}
					</Button>
					<Button
						color="error"
						variant="contained"
						onClick={() => {
							setConfirmUnpair(false);
							onUnpair?.(device.uuid);
						}}
					>
						{t("devices.unpair")}
					</Button>
				</DialogActions>
			</Dialog>
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
			const started = await startCliLogin(uuid);
			await openExternal(started.authorizeUrl);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "cli login failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<Button
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
