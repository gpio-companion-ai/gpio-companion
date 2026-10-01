import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import { useEffect, useState } from "react";
import {
	DASHBOARD_URL,
	getCredits,
	listDeviceStatus,
	openExternal,
	type Session,
	submitBugReport,
} from "../api";
import { CACHE_KEYS, useCachedQuery } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useT } from "../locale";
import AddressForm from "./AddressForm";
import DebugLog from "./DebugLog";
import Keys from "./Keys";
import LanguageCard from "./LanguageCard";
import { consumeProfileJump } from "./PartsSearchPanel";
import { LinesSkeleton } from "./skeletons";
import VoiceCard from "./VoiceCard";

export default function Profile({
	session,
	onSignOut,
}: {
	session: Session | null;
	onSignOut: () => void;
}) {
	const creditsQuery = useCachedQuery(CACHE_KEYS.credits, getCredits);
	const credits = creditsQuery.data ?? null;
	const t = useT();
	const [error, setError] = useState("");
	const loading = creditsQuery.loading;

	useEffect(() => {
		const jump = consumeProfileJump();
		if (!jump) {
			return;
		}
		document.getElementById(`profile-${jump}`)?.scrollIntoView({
			block: "start",
		});
	}, []);

	return (
		<Stack spacing={1.5}>
			{error || creditsQuery.error ? (
				<Alert severity="error">
					{translateError(t, error || creditsQuery.error)}
				</Alert>
			) : null}
			{error || creditsQuery.error ? (
				<DebugLog error={translateError(t, error || creditsQuery.error)} />
			) : null}
			<div id="profile-language">
				<LanguageCard />
			</div>
			<div id="profile-voice">
				<VoiceCard />
			</div>
			<Paper id="profile-account" sx={{ p: 1.5 }} elevation={1}>
				<Stack spacing={0.5}>
					<Typography variant="subtitle1">{t("profile.account")}</Typography>
					<Typography>{session?.name || t("auth.signedIn")}</Typography>
					<Typography color="secondary">{session?.email}</Typography>
					<Typography color="secondary">
						{t("profile.role", {
							role: session?.role || t("profile.roleUser"),
						})}
					</Typography>
					<Button
						variant="text"
						color="secondary"
						size="small"
						onClick={onSignOut}
					>
						{t("auth.signOut")}
					</Button>
				</Stack>
			</Paper>
			<div id="profile-keys">
				<Keys />
			</div>
			<Paper id="profile-credits" sx={{ p: 1.5 }} elevation={1}>
				<Stack
					direction="row"
					spacing={1}
					sx={{
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
					}}
				>
					<Stack spacing={0.25}>
						<Typography variant="subtitle1">{t("credits.title")}</Typography>
						{loading ? (
							<LinesSkeleton lines={1} />
						) : (
							<Typography color="secondary">
								{credits
									? t("credits.balance", {
											usd: credits.usd.toFixed(2),
											micros: credits.micros,
										})
									: t("credits.noCredits")}
							</Typography>
						)}
					</Stack>
					<Button
						variant="contained"
						size="small"
						onClick={() => {
							setError("");
							void openExternal(`${DASHBOARD_URL}/profile/credits`).catch(
								(caught) => {
									setError(
										caught instanceof Error
											? caught.message
											: t("errors.couldNotOpenCredits"),
									);
								},
							);
						}}
					>
						{t("credits.add")}
					</Button>
				</Stack>
			</Paper>
			<AddressForm />
			<BugReportForm />
		</Stack>
	);
}

function BugReportForm() {
	const t = useT();
	const { uuid } = useBoardSelection();
	const boardsQuery = useCachedQuery(CACHE_KEYS.userBoards, listDeviceStatus);
	const board = boardsQuery.data?.devices.find(
		(item) => item.device.uuid === uuid,
	);
	const boardLabel = [board?.device.label, board?.status?.model]
		.filter(Boolean)
		.join(" · ");
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState("");

	async function submit() {
		setBusy(true);
		setSent(false);
		setError("");
		try {
			const result = await submitBugReport({
				text,
				surface: "desktop",
				boardUuid: uuid,
				boardModel: board?.status?.model ?? "",
			});
			if (result?.sent !== true) {
				setError(t("errors.supportEmailMissing"));
				return;
			}
			setText("");
			setSent(true);
		} catch (caught) {
			setSent(false);
			setError(
				caught instanceof Error
					? caught.message
					: t("errors.supportEmailMissing"),
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Paper sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("profile.bugTitle")}</Typography>
				<Typography color="secondary">{t("profile.bugHint")}</Typography>
				{boardLabel ? (
					<Typography color="secondary">
						{t("profile.bugBoard", { board: boardLabel })}
					</Typography>
				) : null}
				{sent ? <Alert severity="success">{t("profile.bugSent")}</Alert> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				<TextField
					label={t("profile.bugLabel")}
					placeholder={t("profile.bugPlaceholder")}
					value={text}
					multiline
					disabled={busy}
					onChange={(event) => setText(event.target.value)}
				/>
				<Button
					variant="contained"
					size="small"
					disabled={busy || !text.trim()}
					onClick={() => void submit()}
				>
					{busy ? t("profile.bugSending") : t("profile.bugSend")}
				</Button>
			</Stack>
		</Paper>
	);
}
