import {
	htmlAttrValue,
	type OpencodeHtmlAttr,
	type OpencodeInline,
	type OpencodeMarkdown,
	parseOpencodeMarkdown,
} from "gpio-companion";
import { createElement, Fragment, type ReactNode } from "react";

export function MarkdownView({ text }: { text: string }) {
	return <Blocks text={text} />;
}

export function Blocks({ text }: { text: string }) {
	const blocks = parseOpencodeMarkdown(text);
	if (blocks.length === 0 && text) {
		return <p>{text}</p>;
	}
	return at(blocks, (block) => <MdBlock block={block} />);
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

function Inlines({ inlines }: { inlines: OpencodeInline[] }) {
	return at(inlines, (node) => <Inline node={node} />);
}

function Inline({ node }: { node: OpencodeInline }) {
	if (node.type === "text") {
		return node.text;
	}
	if (node.type === "break") {
		return <br />;
	}
	if (node.type === "code") {
		return <code>{node.text}</code>;
	}
	if (node.type === "strong") {
		return (
			<strong>
				<Inlines inlines={node.inlines} />
			</strong>
		);
	}
	if (node.type === "em") {
		return (
			<em>
				<Inlines inlines={node.inlines} />
			</em>
		);
	}
	if (node.type === "strike") {
		return (
			<s>
				<Inlines inlines={node.inlines} />
			</s>
		);
	}
	if (node.type === "image") {
		return <img className="oc-img" src={node.href} alt={node.alt} />;
	}
	if (node.type === "html") {
		return createElement(
			node.tag,
			{
				...htmlProps(node.attrs),
				...linkProps(htmlAttrValue(node.attrs, "href")),
			},
			<Inlines inlines={node.inlines} />,
		);
	}
	return (
		<a href={node.href} target="_blank" rel="noopener noreferrer">
			<Inlines inlines={node.inlines} />
		</a>
	);
}

function htmlProps(attrs: OpencodeHtmlAttr[]): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const { name, value } of attrs) {
		if (name === "class") {
			props.className = value;
		} else if (name === "style") {
			const style = styleObject(value);
			if (style) {
				props.style = style;
			}
		} else if (name !== "href" && name !== "src") {
			props[name] = value;
		}
	}
	return props;
}

function linkProps(href: string | null): Record<string, unknown> {
	return href ? { href, target: "_blank", rel: "noopener noreferrer" } : {};
}

function styleObject(raw: string): Record<string, string> | null {
	const style: Record<string, string> = {};
	for (const part of raw.split(";")) {
		const index = part.indexOf(":");
		if (index <= 0) {
			continue;
		}
		const prop = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		if (!/^[a-zA-Z-]+$/.test(prop) || !value || /[<>"']/.test(value)) {
			continue;
		}
		style[prop] = value;
	}
	return Object.keys(style).length > 0 ? style : null;
}

function ImageBlock({ attrs }: { attrs: OpencodeHtmlAttr[] }) {
	return (
		<img
			className="oc-img oc-img-block"
			src={htmlAttrValue(attrs, "src") ?? ""}
			alt={htmlAttrValue(attrs, "alt") ?? ""}
			width={htmlAttrValue(attrs, "width") ?? undefined}
			height={htmlAttrValue(attrs, "height") ?? undefined}
			loading="lazy"
		/>
	);
}

function MdBlock({ block }: { block: OpencodeMarkdown }) {
	if (block.type === "heading") {
		const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
		return (
			<Tag>
				<Inlines inlines={block.inlines} />
			</Tag>
		);
	}
	if (block.type === "code") {
		return (
			<pre className="oc-code">
				{block.lang ? <span className="oc-code-lang">{block.lang}</span> : null}
				{block.text}
			</pre>
		);
	}
	if (block.type === "list") {
		const Tag = block.ordered ? "ol" : "ul";
		return (
			<Tag start={block.ordered && block.start !== 1 ? block.start : undefined}>
				{at(block.items, (item) => (
					<li>
						<Inlines inlines={item.inlines} />
						{at(item.blocks, (child) => (
							<MdBlock block={child} />
						))}
					</li>
				))}
			</Tag>
		);
	}
	if (block.type === "quote") {
		return (
			<blockquote>
				{at(block.blocks, (child) => (
					<MdBlock block={child} />
				))}
			</blockquote>
		);
	}
	if (block.type === "table") {
		return (
			<div className="oc-table">
				<table>
					<thead>
						<tr>
							{at(block.header, (cell, index) => (
								<th style={{ textAlign: block.aligns[index] ?? undefined }}>
									<Inlines inlines={cell} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{at(block.rows, (row) => (
							<tr>
								{at(row, (cell, index) => (
									<td style={{ textAlign: block.aligns[index] ?? undefined }}>
										<Inlines inlines={cell} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	if (block.type === "hr") {
		return <hr />;
	}
	if (block.type === "html") {
		if (block.tag === "img") {
			return <ImageBlock attrs={block.attrs} />;
		}
		if (block.tag === "hr") {
			return <hr />;
		}
		const props = htmlProps(block.attrs);
		const className = [
			typeof props.className === "string" ? props.className : "",
			"oc-html",
			`oc-html-${block.tag}`,
		]
			.filter(Boolean)
			.join(" ");
		return createElement(
			block.tag,
			{
				...props,
				className,
				...linkProps(htmlAttrValue(block.attrs, "href")),
			},
			at(block.blocks, (child) => <MdBlock block={child} />),
		);
	}
	if (block.inlines.length === 1 && block.inlines[0]?.type === "image") {
		const image = block.inlines[0];
		return (
			<ImageBlock
				attrs={[
					{ name: "src", value: image.href },
					{ name: "alt", value: image.alt },
				]}
			/>
		);
	}
	return (
		<p>
			<Inlines inlines={block.inlines} />
		</p>
	);
}
