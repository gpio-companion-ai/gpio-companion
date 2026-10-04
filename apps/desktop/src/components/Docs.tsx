import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { useMemo, useState } from "react";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import {
	DOC_HARDWARE_LABELS,
	type DocHardware,
	docSections,
	docsForLocale,
	findDoc,
	hardwareFromStatus,
	searchDocs,
} from "../lib/docs";
import { useLocale, useT } from "../locale";
import DocsMarkdown from "./DocsMarkdown";

export default function Docs() {
	const t = useT();
	const { locale } = useLocale();
	const docs = useMemo(() => docsForLocale(locale), [locale]);
	const { uuid } = useBoardSelection();
	const [query, setQuery] = useState("");
	const [family, setFamily] = useState<DocHardware | "all">("all");
	const [docId, setDocId] = useState("");
	const { boards } = useUserBoards();

	const selected = boards.find((board) => board.device.uuid === uuid);
	const inferred = hardwareFromStatus(
		selected?.status?.model,
		selected?.status?.hardware,
	);

	const catalog = useMemo(() => {
		return docs
			.filter((entry) => {
				if (entry.group !== "hardware") {
					return true;
				}
				if (family === "all") {
					return true;
				}
				return entry.hardware === family;
			})
			.map((entry) => ({
				...entry,
				title: t(entry.titleKey),
				description: t(entry.descriptionKey),
			}));
	}, [docs, family, t]);

	const hits = useMemo(() => searchDocs(query, catalog), [query, catalog]);
	const doc = findDoc(docId, docs);
	const docTitle = doc ? t(doc.titleKey) : "";

	return (
		<Stack spacing={1.5}>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
				<Chip
					label={t("docs.all")}
					variant={family === "all" ? "filled" : "outlined"}
					onClick={() => setFamily("all")}
				/>
				{(Object.keys(DOC_HARDWARE_LABELS) as DocHardware[]).map((key) => (
					<Chip
						key={key}
						label={DOC_HARDWARE_LABELS[key]}
						color={inferred === key ? "primary" : "secondary"}
						variant={family === key ? "filled" : "outlined"}
						onClick={() => setFamily(key)}
					/>
				))}
			</Stack>
			<TextField
				label={t("docs.search")}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			{doc ? (
				<Paper sx={{ p: 1.5 }} elevation={1}>
					<Button variant="text" onClick={() => setDocId("")}>
						{t("docs.backToCatalog")}
					</Button>
					<Typography variant="h6" sx={{ mt: 1 }}>
						{docTitle}
					</Typography>
					<Stack spacing={0.5} sx={{ mt: 2, mb: 3 }}>
						{docSections(doc.content)
							.filter((section) => section.level > 0 && section.level <= 3)
							.map((section) => (
								<Button
									key={section.id}
									variant="text"
									size="small"
									sx={{
										justifyContent: "flex-start",
										pl: Math.max(0, section.level - 1) * 2,
									}}
									onClick={() =>
										document.getElementById(section.id)?.scrollIntoView({
											behavior: "smooth",
											block: "start",
										})
									}
								>
									{section.title}
								</Button>
							))}
					</Stack>
					<DocsMarkdown content={doc.content} onOpenDoc={setDocId} />
				</Paper>
			) : hits.length > 0 ? (
				hits.map((hit) => (
					<Paper
						key={`${hit.docId}-${hit.sectionTitle}`}
						sx={{ p: 2 }}
						elevation={1}
					>
						<Button variant="text" onClick={() => setDocId(hit.docId)}>
							{hit.docTitle}
						</Button>
						<Typography color="secondary">{hit.snippet}</Typography>
					</Paper>
				))
			) : (
				catalog.map((entry) => (
					<Paper key={entry.id} sx={{ p: 2 }} elevation={1}>
						<Button variant="text" onClick={() => setDocId(entry.id)}>
							{entry.title}
						</Button>
						<Typography color="secondary">{entry.description}</Typography>
					</Paper>
				))
			)}
		</Stack>
	);
}
