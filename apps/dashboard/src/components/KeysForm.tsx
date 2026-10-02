import { GET as getGithubApp, POST as saveGithubApp } from "@api/github-app";
import { GET as getPairing } from "@api/pair";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useActionError } from "../hooks/useActionError.tsx";
import { useAuthSession } from "../hooks/useAuth.ts";
import { useT } from "../hooks/useLocale.tsx";
import { unwrapAction } from "../lib/action.ts";
import { openLoginDialog } from "../lib/auth/refresh.ts";
import {
	peekGithubAppCallback,
	stashGithubAppCallbackFromLocation,
	takeGithubAppCallback,
} from "../lib/github-app-callback.ts";
import type { StoredPairing } from "../lib/pairing-store.ts";

export default function KeysForm() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const [login, setLogin] = useState("");
	const [installUrl, setInstallUrl] = useState("");
	const [checking, setChecking] = useState(true);
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [devicesLoading, setDevicesLoading] = useState(true);
	const [error, setError] = useState("");
	const [checkNonce, setCheckNonce] = useState(0);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: checkNonce retriggers a manual re-check
	useEffect(() => {
		stashGithubAppCallbackFromLocation();
		const pending = peekGithubAppCallback();
		if (!session.data?.id) {
			// Keep a pending GitHub callback in sessionStorage so it can be
			// completed after sign-in instead of stalling on a spinner.
			setChecking(false);
			return;
		}
		setChecking(true);
		void (async () => {
			try {
				if (pending) {
					const saved = unwrapAction(
						await saveGithubApp({
							code: pending.code,
							state: pending.state,
							installationId: pending.installationId,
							redirectUri: pending.redirectUri,
						}),
					);
					takeGithubAppCallback();
					setLogin(saved.login);
					setInstallUrl("");
					setError("");
					window.history.replaceState({}, "", "/profile/github");
					return;
				}
				const current = unwrapAction(await getGithubApp());
				setLogin(current.login);
				setInstallUrl(current.installUrl);
				setError("");
			} catch (caught) {
				const message =
					caught instanceof Error ? caught.message : "github app failed";
				// A stale callback (expired state, install completed in another
				// tab, reinstall) would otherwise retry forever: drop it and
				// fetch a fresh status with a fresh install URL instead of
				// sticking on the same dead error.
				if (
					message === "github app state is invalid" ||
					message === "installation id is required"
				) {
					takeGithubAppCallback();
					try {
						const current = unwrapAction(await getGithubApp());
						setLogin(current.login);
						setInstallUrl(current.installUrl);
						setError("");
						window.history.replaceState({}, "", "/profile/github");
						return;
					} catch {
						// Fall through to showing the original error.
					}
				}
				setError(translateError(t, message));
			} finally {
				setChecking(false);
			}
		})();
	}, [session.data?.id, t, checkNonce]);

	if (!session.data?.id && !session.data?.email) {
		return (
			<Typography color="secondary">
				<Button onClick={openLoginDialog} variant="text">
					{t("auth.signIn")}
				</Button>{" "}
				{t("auth.toGithub")}
			</Typography>
		);
	}

	return (
		<Paper className="w-full max-w-xl p-4 min-[900px]:p-6" elevation={1}>
			<Stack spacing={2}>
				<Typography variant="body2" color="secondary">
					{t("github.formHint")}
				</Typography>
				{checking ? (
					<Skeleton variant="rounded" height={40} width="60%" />
				) : login && !installUrl ? (
					<Alert severity="success">{t("github.connectedAs", { login })}</Alert>
				) : installUrl ? (
					<Stack spacing={1}>
						{login ? (
							<Alert severity="info">
								{t("github.authorizeAgain", { login })}
							</Alert>
						) : null}
						<Button href={installUrl} variant="contained">
							{login ? t("project.authorizeRepos") : t("project.connectGithub")}
						</Button>
					</Stack>
				) : (
					<Typography color="secondary">{t("github.notConnected")}</Typography>
				)}
				{devicesLoading ? (
					<Skeleton variant="rounded" height={24} width="75%" />
				) : devices.length === 0 ? (
					<Alert severity="info">
						<Button href="/devices" variant="text">
							{t("github.pairSoPush")}
						</Button>
					</Alert>
				) : (
					<Typography color="secondary">
						{t("github.nBoardsPush", { n: devices.length })}
					</Typography>
				)}
				{error ? (
					<Alert severity="error">
						<Stack spacing={1}>
							<Typography>{error}</Typography>
							<Button
								variant="outlined"
								size="small"
								disabled={checking}
								onClick={() => setCheckNonce((n) => n + 1)}
							>
								{t("project.reload")}
							</Button>
						</Stack>
					</Alert>
				) : null}
			</Stack>
		</Paper>
	);
}
