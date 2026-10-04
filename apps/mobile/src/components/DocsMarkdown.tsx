import type { RefObject } from "react";
import { Linking, Text, View } from "react-native";
import { useColors } from "../lib/color-mode.tsx";

type Block =
	| { type: "h"; level: number; text: string; id: string }
	| { type: "p"; text: string }
	| { type: "code"; text: string }
	| { type: "li"; text: string }
	| { type: "table"; rows: string[][] };

function slugify(text: string) {
	return text
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function parseBlocks(content: string): Block[] {
	const lines = content.split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (/^\s*(```|~~~)/.test(line)) {
			const fence: string[] = [];
			i += 1;
			while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i] ?? "")) {
				fence.push(lines[i] ?? "");
				i += 1;
			}
			i += 1;
			blocks.push({ type: "code", text: fence.join("\n") });
			continue;
		}
		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) {
			const text = heading[2] ?? "";
			blocks.push({
				type: "h",
				level: heading[1]?.length ?? 1,
				text,
				id: slugify(text),
			});
			i += 1;
			continue;
		}
		if (/^\s*[-*]\s+/.test(line)) {
			blocks.push({ type: "li", text: line.replace(/^\s*[-*]\s+/, "") });
			i += 1;
			continue;
		}
		if (line.includes("|") && line.trim().startsWith("|")) {
			const rows: string[][] = [];
			while (i < lines.length && (lines[i] ?? "").includes("|")) {
				const raw = (lines[i] ?? "").trim();
				if (/^\|?\s*:?-{3,}/.test(raw)) {
					i += 1;
					continue;
				}
				rows.push(
					raw
						.split("|")
						.slice(1, -1)
						.map((cell) => cell.trim()),
				);
				i += 1;
			}
			if (rows.length) {
				blocks.push({ type: "table", rows });
			}
			continue;
		}
		if (!line.trim()) {
			i += 1;
			continue;
		}
		const para: string[] = [line];
		i += 1;
		while (
			i < lines.length &&
			(lines[i] ?? "").trim() &&
			!/^(#{1,4})\s+/.test(lines[i] ?? "") &&
			!/^\s*[-*]\s+/.test(lines[i] ?? "") &&
			!/^\s*(```|~~~)/.test(lines[i] ?? "")
		) {
			para.push(lines[i] ?? "");
			i += 1;
		}
		blocks.push({ type: "p", text: para.join(" ") });
	}
	return blocks;
}

function Inline({
	text,
	onOpenDoc,
}: {
	text: string;
	onOpenDoc?: (id: string) => void;
}) {
	const colors = useColors();
	const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
	const seen = new Map<string, number>();
	const keyFor = (base: string): string => {
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return n === 0 ? base : `${base}-${n}`;
	};
	return (
		<Text style={{ color: colors.text, lineHeight: 22 }}>
			{parts.map((part) => {
				const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
				if (!link) {
					return (
						<Text key={keyFor(`t-${part}`)}>{part.replace(/[*_`]/g, "")}</Text>
					);
				}
				const label = link[1] ?? "";
				const href = link[2] ?? "";
				return (
					<Text
						key={keyFor(`l-${href}-${label}`)}
						style={{ color: colors.primary }}
						onPress={() => {
							if (href.startsWith("#doc:")) {
								onOpenDoc?.(href.slice(5));
								return;
							}
							if (/^https?:\/\//i.test(href)) {
								void Linking.openURL(href);
							}
						}}
					>
						{label}
					</Text>
				);
			})}
		</Text>
	);
}

export default function DocsMarkdown({
	content,
	onOpenDoc,
	headingRefs,
}: {
	content: string;
	onOpenDoc?: (id: string) => void;
	headingRefs?: RefObject<Record<string, View | null>>;
}) {
	const colors = useColors();
	const blocks = parseBlocks(content);
	const seen = new Map<string, number>();
	const keyFor = (base: string): string => {
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return n === 0 ? base : `${base}-${n}`;
	};
	return (
		<View style={{ gap: 10 }}>
			{blocks.map((block) => {
				if (block.type === "h") {
					const size = block.level === 1 ? 22 : block.level === 2 ? 18 : 16;
					return (
						<View
							key={keyFor(`h-${block.id}`)}
							collapsable={false}
							ref={(node) => {
								if (headingRefs) {
									headingRefs.current[block.id] = node;
								}
							}}
						>
							<Text
								nativeID={block.id}
								style={{
									color: colors.text,
									fontWeight: "700",
									fontSize: size,
									marginTop: 8,
								}}
							>
								{block.text}
							</Text>
						</View>
					);
				}
				if (block.type === "code") {
					return (
						<Text
							key={keyFor(`code-${block.text.slice(0, 40)}`)}
							style={{
								color: colors.text,
								fontFamily: "monospace",
								fontSize: 12,
								backgroundColor: colors.chipBg,
								padding: 10,
								borderRadius: 8,
							}}
						>
							{block.text}
						</Text>
					);
				}
				if (block.type === "li") {
					return (
						<View
							key={keyFor(`li-${block.text.slice(0, 40)}`)}
							style={{ flexDirection: "row", gap: 8 }}
						>
							<Text style={{ color: colors.text }}>•</Text>
							<View style={{ flex: 1 }}>
								<Inline text={block.text} onOpenDoc={onOpenDoc} />
							</View>
						</View>
					);
				}
				if (block.type === "table") {
					return (
						<View
							key={keyFor(`table-${block.rows[0]?.join() ?? ""}`)}
							style={{ gap: 4 }}
						>
							{block.rows.map((row, rowIndex) => (
								<Text
									key={keyFor(`r-${row.join()}`)}
									style={{
										color: colors.text,
										fontSize: 12,
										fontWeight: rowIndex === 0 ? "700" : "400",
									}}
								>
									{row.join("  ·  ")}
								</Text>
							))}
						</View>
					);
				}
				return (
					<Inline
						key={keyFor(`p-${block.text.slice(0, 40)}`)}
						text={block.text}
						onOpenDoc={onOpenDoc}
					/>
				);
			})}
		</View>
	);
}
