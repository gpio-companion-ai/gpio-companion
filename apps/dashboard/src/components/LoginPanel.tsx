import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useState } from "react";
import { useAuth } from "../hooks/useAuth.ts";
import { useT } from "../hooks/useLocale.tsx";

export default function LoginPanel() {
	const auth = useAuth();
	const t = useT();
	const [error, setError] = useState("");

	async function start() {
		if (!auth) {
			setError(t("errors.authUnavailable"));
			return;
		}
		setError("");
		try {
			await auth.login({
				autoNavigate: true,
				provider: "github",
			});
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : t("errors.loginFailed"),
			);
		}
	}

	return (
		<>
			<Typography variant="h5" Element="h1" align="center">
				{t("auth.signIn")}
			</Typography>
			<Typography color="secondary" align="center" className="mt-2 mb-6">
				{t("auth.helperDashboard")}
			</Typography>
			<Stack spacing={2}>
				<Button variant="contained" onClick={() => void start()}>
					{t("auth.continueWithGithub")}
				</Button>
			</Stack>
			{error ? (
				<Alert severity="error" className="mt-4">
					{error}
				</Alert>
			) : null}
		</>
	);
}
