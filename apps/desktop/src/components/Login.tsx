import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useRef, useState } from "react";
import { authLogin } from "../api";
import { useT } from "../locale";
import DebugLog from "./DebugLog";
import LanguageCard from "./LanguageCard";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
	const t = useT();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const surface = useRef<HTMLDivElement>(null);
	useEffect(() => {
		surface.current?.querySelector<HTMLButtonElement>("button")?.focus();
	}, []);

	async function start() {
		setBusy(true);
		setError("");
		try {
			await authLogin();
			onSignedIn();
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : t("errors.loginFailed");
			console.error("gpio-companion-desktop login", message);
			setError(message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Stack
			ref={surface}
			spacing={3}
			sx={{ p: 3 }}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") event.stopPropagation();
				if (event.key !== "Tab") return;
				const nodes = surface.current?.querySelectorAll<HTMLElement>(
					"button:not(:disabled), select, input:not([type='hidden']), [tabindex='0']",
				);
				const first = nodes?.[0];
				const last = nodes?.[nodes.length - 1];
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}}
		>
			<div>
				<Typography variant="h5" Element="h1" align="center">
					{t("auth.signInWithGithub")}
				</Typography>
				<Typography color="secondary" align="center" sx={{ mt: 2, mb: 6 }}>
					{t("auth.helperDesktop")}
				</Typography>
				<Stack spacing={2}>
					<Button
						variant="contained"
						disabled={busy}
						onClick={() => void start()}
					>
						{busy ? t("auth.waitingGithub") : t("auth.continueWithGithub")}
					</Button>
				</Stack>
				{error ? (
					<Alert severity="error" sx={{ mt: 4 }}>
						{error}
					</Alert>
				) : null}
				{error ? <DebugLog error={error} /> : null}
			</div>
			<LanguageCard menuZIndex={1600} />
		</Stack>
	);
}
