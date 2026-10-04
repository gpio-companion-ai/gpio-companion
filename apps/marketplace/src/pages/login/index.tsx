import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Typography from "@shpaw415/mui-lite/Typography";
import { useState } from "react";
import { useT } from "../../hooks/useLocale.tsx";
import { authConfigured, createClient } from "../../lib/auth.ts";

export default function LoginPage() {
	const t = useT();
	const [error, setError] = useState("");
	const configured = authConfigured();

	async function start() {
		setError("");
		try {
			await createClient().login({ autoNavigate: true, provider: "github" });
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("auth.unavailable"),
			);
		}
	}

	return (
		<Paper className="market-auth-card" variant="outlined">
			<Typography variant="h5" component="h1">
				{t("auth.signIn")}
			</Typography>
			<Typography color="textSecondary">{t("auth.helper")}</Typography>
			{configured ? (
				<Button variant="contained" onClick={() => void start()}>
					{t("auth.github")}
				</Button>
			) : (
				<Alert severity="warning">{t("auth.unavailable")}</Alert>
			)}
			{error ? <Alert severity="error">{error}</Alert> : null}
		</Paper>
	);
}
