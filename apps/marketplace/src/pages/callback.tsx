import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import { CircularProgress } from "@shpaw415/mui-lite/Progress";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { createClient } from "../lib/auth.ts";

export default function CallbackPage() {
	const t = useT();
	const [error, setError] = useState("");

	useEffect(() => {
		const auth = createClient();
		auth
			.callback()
			.then(() => {
				if (auth.getToken()) auth.setTokenToCookie();
				window.location.assign("/orders");
			})
			.catch((caught: unknown) => {
				setError(
					caught instanceof Error ? caught.message : t("auth.unavailable"),
				);
			});
	}, [t]);

	if (error) {
		return (
			<Alert severity="error" title={t("auth.signIn")}>
				<p>{error}</p>
				<Button href="/login" variant="contained">
					{t("auth.back")}
				</Button>
			</Alert>
		);
	}
	return (
		<div className="market-auth-card">
			<CircularProgress />
			<Typography>{t("auth.signingIn")}</Typography>
		</div>
	);
}
