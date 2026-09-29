import {
	type JlcpcbOrderBundle,
	parseJlcpcbDraft,
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { loadJlcpcbDraft } from "../lib/api.ts";
import { useT } from "../lib/locale.tsx";
import { Body, Muted, Skeleton } from "./ui.tsx";

export default function JlcpcbDraft({ token }: { token: string }) {
	const t = useT();
	const [draft, setDraft] = useState<JlcpcbOrderBundle | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		loadJlcpcbDraft(token)
			.then((data) => {
				if (!cancelled) setDraft(parseJlcpcbDraft(data.draft));
			})
			.catch(() => {
				if (!cancelled) setDraft(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [token]);

	if (loading) return <Skeleton height={72} />;
	if (!draft) return <Muted>{t("jlcpcb.draftEmpty")}</Muted>;
	return (
		<View style={{ gap: 6 }}>
			<Body>
				{t("jlcpcb.draftRepo")}: {draft.repo}
			</Body>
			<Body>{t("jlcpcb.draftParts")}</Body>
			{draft.parts.length === 0 ? (
				<Muted>{t("parts.empty")}</Muted>
			) : (
				draft.parts.map((part) => (
					<Muted key={part.componentCode}>
						{part.componentCode} · {t("jlcpcb.draftQty")} {part.qty}
						{part.name ? ` · ${part.name}` : ""}
					</Muted>
				))
			)}
			<Body>{t("jlcpcb.draftPcb")}</Body>
			<Muted>{draft.pcb?.file || draft.pcb?.fileKey || t("parts.empty")}</Muted>
			<Body>{t("jlcpcb.draftPrints")}</Body>
			{draft.prints.length === 0 ? (
				<Muted>{t("parts.empty")}</Muted>
			) : (
				draft.prints.map((print) => (
					<Muted key={print.file}>
						{print.name} · {print.file}
					</Muted>
				))
			)}
			<Body>{t("jlcpcb.draftAssembly")}</Body>
			<Muted>{t("jlcpcb.draftAssemblyNote")}</Muted>
			{draft.assembly.lines.map((line) => (
				<Muted key={`${line.componentCode}-${line.ref ?? ""}`}>
					{line.componentCode} · {t("jlcpcb.draftQty")} {line.qty}
					{line.ref ? ` · ${line.ref}` : ""}
				</Muted>
			))}
		</View>
	);
}
