import {
	htmlAttrValue,
	type OpencodeHtmlAttr,
	type OpencodeInline,
	type OpencodeMarkdown,
	parseOpencodeMarkdown,
} from "gpio-companion-opencode";
import { Fragment, type ReactNode } from "react";
import { Image, Linking, ScrollView, Text, View } from "react-native";
import { useColors } from "../lib/color-mode.tsx";

const TAG_ACCENTS: Record<string, { border: string; bg: string }> = {
	"board-note": {
		border: "rgba(127,127,127,0.4)",
		bg: "rgba(127,127,127,0.08)",
	},
	"wiring-check": {
		border: "rgba(250,179,63,0.5)",
		bg: "rgba(250,179,63,0.1)",
	},
	"step-guide": { border: "rgba(99,161,244,0.5)", bg: "rgba(99,161,244,0.1)" },
};

export function MarkdownView({ text, color }: { text: string; color: string }) {
	return <Blocks text={text} color={color} />;
}

function at<T>(
	items: readonly T[],
	render: (item: T, index: number) => ReactNode,
) {
	return items.map((item, index) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: markdown nodes stay in source order
		<Fragment key={index}>{render(item, index)}</Fragment>
	));
}

export function Blocks({ text, color }: { text: string; color: string }) {
	const colors = useColors();
	const blocks = parseOpencodeMarkdown(text);
	if (blocks.length === 0 && text) {
		return <Text style={{ color }}>{text}</Text>;
	}
	return (
		<View style={{ gap: 8 }}>
			{at(blocks, (block) => (
				<MdBlock block={block} color={color} colors={colors} />
			))}
		</View>
	);
}

function Inlines({
	inlines,
	color,
	link,
}: {
	inlines: OpencodeInline[];
	color: string;
	link: string;
}) {
	return at(inlines, (node) => (
		<Inline node={node} color={color} link={link} />
	));
}

function Inline({
	node,
	color,
	link,
}: {
	node: OpencodeInline;
	color: string;
	link: string;
}) {
	if (node.type === "text") {
		return node.text;
	}
	if (node.type === "break") {
		return "\n";
	}
	if (node.type === "code") {
		return (
			<Text
				style={{
					color,
					fontFamily: "monospace",
					backgroundColor: "rgba(127,127,127,0.12)",
				}}
			>
				{node.text}
			</Text>
		);
	}
	if (node.type === "strong") {
		return (
			<Text style={{ fontWeight: "700" }}>
				<Inlines inlines={node.inlines} color={color} link={link} />
			</Text>
		);
	}
	if (node.type === "em") {
		return (
			<Text style={{ fontStyle: "italic" }}>
				<Inlines inlines={node.inlines} color={color} link={link} />
			</Text>
		);
	}
	if (node.type === "strike") {
		return (
			<Text style={{ textDecorationLine: "line-through" }}>
				<Inlines inlines={node.inlines} color={color} link={link} />
			</Text>
		);
	}
	if (node.type === "image") {
		return (
			<Image
				source={{ uri: node.href }}
				style={{ width: 14, height: 14, borderRadius: 3, resizeMode: "cover" }}
			/>
		);
	}
	if (node.type === "html") {
		return (
			<Text>
				<Inlines inlines={node.inlines} color={color} link={link} />
			</Text>
		);
	}
	return (
		<Text
			style={{ color: link, textDecorationLine: "underline" }}
			onPress={() => {
				if (/^https?:\/\//i.test(node.href)) {
					void Linking.openURL(node.href);
				}
			}}
		>
			<Inlines inlines={node.inlines} color={link} link={link} />
		</Text>
	);
}

function MdBlock({
	block,
	color,
	colors,
}: {
	block: OpencodeMarkdown;
	color: string;
	colors: ReturnType<typeof useColors>;
}) {
	if (block.type === "heading") {
		const size = block.level === 1 ? 20 : block.level === 2 ? 17 : 15;
		return (
			<Text style={{ color, fontWeight: "700", fontSize: size }}>
				<Inlines inlines={block.inlines} color={color} link={colors.primary} />
			</Text>
		);
	}
	if (block.type === "code") {
		return (
			<ScrollView horizontal nestedScrollEnabled>
				<Text
					style={{
						color,
						fontFamily: "monospace",
						fontSize: 12,
						backgroundColor: colors.chipBg,
						padding: 8,
						borderRadius: 8,
					}}
				>
					{block.lang ? `${block.lang}\n` : ""}
					{block.text}
				</Text>
			</ScrollView>
		);
	}
	if (block.type === "list") {
		return (
			<View style={{ gap: 4 }}>
				{at(block.items, (item, index) => (
					<View style={{ flexDirection: "row", gap: 6 }}>
						<Text style={{ color }}>
							{block.ordered ? `${block.start + index}.` : "•"}
						</Text>
						<View style={{ flex: 1, gap: 4 }}>
							<Text style={{ color }}>
								<Inlines
									inlines={item.inlines}
									color={color}
									link={colors.primary}
								/>
							</Text>
							{at(item.blocks, (child) => (
								<MdBlock block={child} color={color} colors={colors} />
							))}
						</View>
					</View>
				))}
			</View>
		);
	}
	if (block.type === "quote") {
		return (
			<View
				style={{
					borderLeftWidth: 2,
					borderLeftColor: colors.border,
					paddingLeft: 10,
					gap: 4,
				}}
			>
				{at(block.blocks, (child) => (
					<MdBlock block={child} color={colors.muted} colors={colors} />
				))}
			</View>
		);
	}
	if (block.type === "table") {
		return (
			<ScrollView horizontal nestedScrollEnabled>
				<View>
					<View style={{ flexDirection: "row" }}>
						{at(block.header, (cell) => (
							<Text
								style={{
									color,
									fontWeight: "700",
									minWidth: 72,
									padding: 6,
									borderWidth: 1,
									borderColor: colors.border,
								}}
							>
								<Inlines inlines={cell} color={color} link={colors.primary} />
							</Text>
						))}
					</View>
					{at(block.rows, (row) => (
						<View style={{ flexDirection: "row" }}>
							{at(row, (cell) => (
								<Text
									style={{
										color,
										minWidth: 72,
										padding: 6,
										borderWidth: 1,
										borderColor: colors.border,
									}}
								>
									<Inlines inlines={cell} color={color} link={colors.primary} />
								</Text>
							))}
						</View>
					))}
				</View>
			</ScrollView>
		);
	}
	if (block.type === "hr") {
		return (
			<View
				style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }}
			/>
		);
	}
	if (block.type === "html") {
		if (block.tag === "img") {
			const width = numberAttr(block.attrs, "width");
			const height = numberAttr(block.attrs, "height");
			return (
				<Image
					source={{ uri: htmlAttrValue(block.attrs, "src") ?? "" }}
					style={{
						width: width ?? ("100%" as const),
						height: height ?? 180,
						borderRadius: 8,
						resizeMode: "cover",
					}}
				/>
			);
		}
		if (block.tag === "hr") {
			return (
				<View
					style={{
						height: 1,
						backgroundColor: colors.border,
						marginVertical: 4,
					}}
				/>
			);
		}
		const accent = TAG_ACCENTS[block.tag] ?? {
			border: colors.border,
			bg: "rgba(127,127,127,0.05)",
		};
		return (
			<View
				style={{
					borderWidth: 1,
					borderColor: accent.border,
					backgroundColor: accent.bg,
					borderRadius: 8,
					padding: 10,
					gap: 4,
				}}
			>
				{at(block.blocks, (child) => (
					<MdBlock block={child} color={color} colors={colors} />
				))}
			</View>
		);
	}
	if (block.inlines.length === 1 && block.inlines[0]?.type === "image") {
		const image = block.inlines[0];
		return (
			<Image
				source={{ uri: image.href }}
				style={{
					width: "100%",
					height: 180,
					borderRadius: 8,
					resizeMode: "cover",
				}}
			/>
		);
	}
	return (
		<Text style={{ color }}>
			<Inlines inlines={block.inlines} color={color} link={colors.primary} />
		</Text>
	);
}

function numberAttr(attrs: OpencodeHtmlAttr[], name: string): number | null {
	const raw = htmlAttrValue(attrs, name);
	if (!raw || !/^\d+$/.test(raw)) {
		return null;
	}
	return Number(raw);
}
