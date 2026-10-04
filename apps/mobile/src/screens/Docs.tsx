import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findNodeHandle, type ScrollView, type View } from "react-native";
import DocsMarkdown from "../components/DocsMarkdown.tsx";
import {
	Chip,
	Field,
	Muted,
	Paper,
	Row,
	Screen,
	TextButton,
	Title,
} from "../components/ui.tsx";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useDeckNav } from "../lib/deck-nav.tsx";
import {
	DOC_HARDWARE_LABELS,
	type DocHardware,
	docSections,
	docsForLocale,
	findDoc,
	hardwareFromStatus,
	searchDocs,
} from "../lib/docs.ts";
import { useLocale, useT } from "../lib/locale.tsx";

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
		return docs.filter((entry) => {
			if (entry.group !== "hardware") {
				return true;
			}
			if (family === "all") {
				return true;
			}
			return entry.hardware === family;
		});
	}, [docs, family]);

	const hits = useMemo(() => searchDocs(query, catalog), [query, catalog]);
	const doc = findDoc(docId, docs);
	const { setDocsItems } = useDeckNav();
	const scrollRef = useRef<ScrollView>(null);
	const headingRefs = useRef<Record<string, View | null>>({});
	const sections = useMemo(
		() =>
			doc
				? docSections(doc.content).filter(
						(section) => section.level >= 2 && section.level <= 3,
					)
				: [],
		[doc],
	);

	const scrollToSection = useCallback((id: string) => {
		const node = headingRefs.current[id];
		const scroll = scrollRef.current;
		const handle = scroll ? findNodeHandle(scroll) : null;
		if (!node || !scroll || !handle) {
			return;
		}
		node.measureLayout(
			handle,
			(_x, y) => {
				scroll.scrollTo({ y: Math.max(0, y - 8), animated: true });
			},
			() => undefined,
		);
	}, []);

	useEffect(() => {
		setDocsItems(
			sections.map((section) => ({
				id: section.id,
				label: section.title,
				onSelect: () => scrollToSection(section.id),
			})),
		);
		return () => setDocsItems([]);
	}, [sections, setDocsItems, scrollToSection]);

	return (
		<Screen scrollRef={scrollRef}>
			<Row>
				<Chip
					label={t("docs.all")}
					filled={family === "all"}
					tone={family === "all" ? "primary" : "muted"}
					onPress={() => setFamily("all")}
				/>
				{(Object.keys(DOC_HARDWARE_LABELS) as DocHardware[]).map((key) => (
					<Chip
						key={key}
						label={DOC_HARDWARE_LABELS[key]}
						filled={family === key}
						tone={inferred === key || family === key ? "primary" : "muted"}
						onPress={() => setFamily(key)}
					/>
				))}
			</Row>
			<Field
				label={t("docs.search")}
				value={query}
				onChangeText={setQuery}
				placeholder={t("docs.search")}
			/>
			{doc ? (
				<Paper>
					<TextButton
						label={t("docs.backToCatalog")}
						onPress={() => setDocId("")}
					/>
					<Title>{t(doc.titleKey)}</Title>
					{docSections(doc.content)
						.filter((section) => section.level > 0 && section.level <= 3)
						.map((section) => (
							<Muted key={section.id}>{section.title}</Muted>
						))}
					<DocsMarkdown
						content={doc.content}
						onOpenDoc={setDocId}
						headingRefs={headingRefs}
					/>
				</Paper>
			) : hits.length > 0 ? (
				hits.map((hit) => {
					const hitDoc = findDoc(hit.docId, docs);
					return (
						<Paper
							key={`${hit.docId}-${hit.sectionTitle}`}
							onPress={() => setDocId(hit.docId)}
						>
							<TextButton
								label={hitDoc ? t(hitDoc.titleKey) : hit.docTitle}
								onPress={() => setDocId(hit.docId)}
							/>
							<Muted>{hit.snippet}</Muted>
						</Paper>
					);
				})
			) : (
				catalog.map((entry) => (
					<Paper key={entry.id} onPress={() => setDocId(entry.id)}>
						<TextButton
							label={t(entry.titleKey)}
							onPress={() => setDocId(entry.id)}
						/>
						<Muted>{t(entry.descriptionKey)}</Muted>
					</Paper>
				))
			)}
		</Screen>
	);
}
