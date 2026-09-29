import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../../../hooks/useLocale.tsx";

export default function CliCallbackPage() {
	const t = useT();
	const [status, setStatus] = useState<"working" | "done" | "error">("working");
	const [error, setError] = useState("");

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code") ?? "";
		const state = params.get("state") ?? "";
		window.history.replaceState({}, "", "/auth/cli/callback");
		if (!code || !state) {
			setStatus("error");
			setError("cli login expired");
			return;
		}
		let cancelled = false;
		void fetch("/api/jlcpcb/cli/callback", {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({ code, state }),
		})
			.then(async (response) => {
				const payload = (await response.json().catch(() => null)) as {
					ok?: boolean;
					error?: string;
				} | null;
				if (cancelled) return;
				if (!response.ok || payload?.ok === false) {
					setStatus("error");
					setError(payload?.error || "cli login failed");
					return;
				}
				setStatus("done");
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				setStatus("error");
				setError(caught instanceof Error ? caught.message : "cli login failed");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Paper className="mx-auto mt-8 max-w-md p-4">
			<Stack spacing={1}>
				<Typography variant="h6">{t("cli.callbackTitle")}</Typography>
				{status === "working" ? (
					<Typography color="secondary">{t("cli.callbackWorking")}</Typography>
				) : null}
				{status === "done" ? (
					<Typography>{t("cli.callbackDone")}</Typography>
				) : null}
				{status === "error" ? (
					<Typography color="error">{translateError(t, error)}</Typography>
				) : null}
				<Button href="/devices" variant="outlined" size="small">
					{t("cli.backToDevices")}
				</Button>
			</Stack>
		</Paper>
	);
}
