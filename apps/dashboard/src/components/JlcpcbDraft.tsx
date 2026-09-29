import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { type JlcpcbOrderBundle, parseJlcpcbDraft } from "gpio-companion";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { LinesSkeleton } from "./skeletons.tsx";

export default function JlcpcbDraft() {
	const t = useT();
	const [draft, setDraft] = useState<JlcpcbOrderBundle | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const response = await fetch("/api/jlcpcb/draft", {
					headers: { accept: "application/json" },
				});
				const payload = (await response.json().catch(() => null)) as {
					ok?: boolean;
					data?: { draft?: unknown };
				} | null;
				if (cancelled) return;
				setDraft(payload?.ok ? parseJlcpcbDraft(payload.data?.draft) : null);
			} catch {
				if (!cancelled) setDraft(null);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	if (loading) return <LinesSkeleton lines={3} />;
	if (!draft) {
		return <Typography color="secondary">{t("jlcpcb.draftEmpty")}</Typography>;
	}
	return (
		<Stack spacing={1}>
			<Typography>
				{t("jlcpcb.draftRepo")}: {draft.repo}
			</Typography>
			<Typography>{t("jlcpcb.draftParts")}</Typography>
			{draft.parts.length === 0 ? (
				<Typography color="secondary">{t("parts.empty")}</Typography>
			) : (
				draft.parts.map((part) => (
					<Typography key={part.componentCode} color="secondary">
						{part.componentCode} · {t("jlcpcb.draftQty")} {part.qty}
						{part.name ? ` · ${part.name}` : ""}
					</Typography>
				))
			)}
			<Typography>{t("jlcpcb.draftPcb")}</Typography>
			<Typography color="secondary">
				{draft.pcb?.file || draft.pcb?.fileKey || t("parts.empty")}
			</Typography>
			<Typography>{t("jlcpcb.draftPrints")}</Typography>
			{draft.prints.length === 0 ? (
				<Typography color="secondary">{t("parts.empty")}</Typography>
			) : (
				draft.prints.map((print) => (
					<Typography key={print.file} color="secondary">
						{print.name} · {print.file}
					</Typography>
				))
			)}
			<Typography>{t("jlcpcb.draftAssembly")}</Typography>
			<Typography color="secondary">{t("jlcpcb.draftAssemblyNote")}</Typography>
			{draft.assembly.lines.map((line) => (
				<Typography
					key={`${line.componentCode}-${line.ref ?? ""}`}
					color="secondary"
				>
					{line.componentCode} · {t("jlcpcb.draftQty")} {line.qty}
					{line.ref ? ` · ${line.ref}` : ""}
				</Typography>
			))}
		</Stack>
	);
}
