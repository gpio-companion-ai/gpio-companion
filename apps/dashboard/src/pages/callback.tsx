import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import { CircularProgress } from "@shpaw415/mui-lite/Progress";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth.ts";
import { useT } from "../hooks/useLocale.tsx";

export default function AuthCallbackPage() {
	const auth = useAuth();
	const t = useT();
	const [error, setError] = useState("");

	useEffect(() => {
		if (!auth) {
			return;
		}
		let cancelled = false;
		auth
			.callback()
			.then(() => {
				if (cancelled) {
					return;
				}
				if (auth.getToken()) {
					auth.setTokenToCookie();
				}
				window.location.assign("/project");
			})
			.catch((caught: unknown) => {
				if (!cancelled) {
					setError(
						translateError(
							t,
							caught instanceof Error ? caught.message : "callback failed",
						),
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [auth, t]);

	if (error) {
		return (
			<Paper
				className="mx-auto w-full max-w-md p-6 min-[900px]:p-8"
				elevation={1}
			>
				<Typography color="error" className="mb-4">
					{error}
				</Typography>
				<Button href="/project" variant="contained">
					{t("auth.backToLogin")}
				</Button>
			</Paper>
		);
	}

	return (
		<Paper className="mx-auto max-w-md p-8" elevation={1}>
			<Stack spacing={2} alignItems="center">
				<CircularProgress />
				<Typography color="secondary">{t("auth.signingIn")}</Typography>
			</Stack>
		</Paper>
	);
}
