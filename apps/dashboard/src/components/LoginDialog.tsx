import Dialog from "@shpaw415/mui-lite/Dialog";
import Stack from "@shpaw415/mui-lite/Stack";
import { useEffect, useRef } from "react";
import { useT } from "../hooks/useLocale.tsx";
import LanguageCard from "./LanguageCard.tsx";
import LoginPanel from "./LoginPanel.tsx";

// Blocking sign-in surface: no onClose, so backdrop click and Escape do
// nothing. Rendered above every route when the session is missing or the
// refresh token can no longer recover it.
export default function LoginDialog({ open }: { open: boolean }) {
	const surface = useRef<HTMLDivElement>(null);
	const t = useT();
	useEffect(() => {
		if (open)
			surface.current?.querySelector<HTMLButtonElement>("button")?.focus();
	}, [open]);
	return (
		<Dialog
			open={open}
			onBackdropClick={() =>
				surface.current?.querySelector<HTMLButtonElement>("button")?.focus()
			}
			fullWidth
			sx={{ zIndex: 1500 }}
			slotProps={{
				paper: {
					"aria-label": t("auth.signIn"),
					sx: {
						width: "calc(100% - 32px)",
						maxWidth: 448,
						maxHeight: "calc(100dvh - 32px)",
						overflowY: "auto",
					},
				},
			}}
		>
			<Stack
				ref={surface}
				spacing={3}
				className="p-6 min-[900px]:p-8"
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Escape") {
						event.stopPropagation();
						return;
					}
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
				<LoginPanel />
				<LanguageCard menuZIndex={1600} />
			</Stack>
		</Dialog>
	);
}
