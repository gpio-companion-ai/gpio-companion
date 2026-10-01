export type OpencodeHtmlAttr = { name: string; value: string };

export type OpencodeInline =
	| { type: "text"; text: string }
	| { type: "code"; text: string }
	| { type: "strong"; inlines: OpencodeInline[] }
	| { type: "em"; inlines: OpencodeInline[] }
	| { type: "strike"; inlines: OpencodeInline[] }
	| { type: "link"; href: string; inlines: OpencodeInline[] }
	| { type: "image"; href: string; alt: string }
	| {
			type: "html";
			tag: string;
			attrs: OpencodeHtmlAttr[];
			inlines: OpencodeInline[];
	  }
	| { type: "break" };

export type OpencodeListItem = {
	inlines: OpencodeInline[];
	blocks: OpencodeMarkdown[];
};

export type OpencodeMarkdown =
	| { type: "heading"; level: number; inlines: OpencodeInline[] }
	| { type: "paragraph"; inlines: OpencodeInline[] }
	| { type: "code"; lang: string; text: string }
	| { type: "list"; ordered: boolean; start: number; items: OpencodeListItem[] }
	| { type: "quote"; blocks: OpencodeMarkdown[] }
	| {
			type: "table";
			aligns: Array<"left" | "center" | "right" | null>;
			header: OpencodeInline[][];
			rows: OpencodeInline[][][];
	  }
	| { type: "hr" }
	| {
			type: "html";
			tag: string;
			attrs: OpencodeHtmlAttr[];
			blocks: OpencodeMarkdown[];
	  };

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const HR_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const ESCAPES = "\\`*_{}[]()#+-.!~";
const HTML_OPEN_RE =
	/^<([a-z][a-z0-9-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*"|='[^']*'|=[^\s"'=<>`]+)?)*)\s*(\/?)>/;
const ATTR_NAME_RE = /^[^\s"'>/=]+/;
const ATTR_VALUE_RE = /^[^\s"'=<>`]+/;
const DANGEROUS_TAGS = new Set([
	"script",
	"iframe",
	"object",
	"embed",
	"style",
	"link",
	"meta",
	"form",
	"base",
	"frame",
	"frameset",
	"applet",
	"head",
	"title",
]);
const ALLOWED_ATTRS = new Set([
	"src",
	"href",
	"alt",
	"title",
	"width",
	"height",
	"class",
	"style",
	"start",
	"align",
]);
const VOID_TAGS = new Set(["img", "br", "hr"]);

export function parseOpencodeMarkdown(source: string): OpencodeMarkdown[] {
	const text = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!text.trim()) {
		return [];
	}
	return parseBlocks(text.split("\n"), 0, Number.POSITIVE_INFINITY).blocks;
}

function parseBlocks(
	lines: string[],
	start: number,
	end: number,
): { blocks: OpencodeMarkdown[]; next: number } {
	const blocks: OpencodeMarkdown[] = [];
	const stop = Math.min(end, lines.length);
	let i = start;
	while (i < stop) {
		const line = lines[i] ?? "";
		if (!line.trim()) {
			i += 1;
			continue;
		}
		const fence = fenceOpen(line);
		if (fence) {
			const read = readFence(lines, i, stop, fence);
			blocks.push(read.block);
			i = read.next;
			continue;
		}
		if (HR_RE.test(line)) {
			blocks.push({ type: "hr" });
			i += 1;
			continue;
		}
		const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(line);
		if (
			heading?.[1] &&
			(line.length === heading[1].length || line[heading[1].length] === " ")
		) {
			const raw = (heading[2] ?? "").replace(/\s+#+\s*$/, "").trim();
			blocks.push({
				type: "heading",
				level: heading[1].length,
				inlines: parseInlines(raw),
			});
			i += 1;
			continue;
		}
		if (/^ {0,3}>/.test(line)) {
			const read = readQuote(lines, i, stop);
			blocks.push(read.block);
			i = read.next;
			continue;
		}
		if (isTableStart(lines, i, stop)) {
			const read = readTable(lines, i, stop);
			blocks.push(read.block);
			i = read.next;
			continue;
		}
		const html = readHtmlBlock(lines, i, stop);
		if (html) {
			blocks.push(html.block);
			i = html.next;
			continue;
		}
		if (LIST_RE.test(line)) {
			const read = readList(lines, i, stop);
			blocks.push(read.block);
			i = read.next;
			continue;
		}
		const para: string[] = [];
		while (
			i < stop &&
			(lines[i] ?? "").trim() &&
			!isBlockStart(lines, i, stop)
		) {
			para.push(lines[i] ?? "");
			i += 1;
		}
		if (para.length === 0) {
			i += 1;
			continue;
		}
		const text = joinParagraph(para);
		if (text) {
			blocks.push({ type: "paragraph", inlines: parseInlines(text) });
		}
	}
	return { blocks, next: i };
}

function isBlockStart(lines: string[], index: number, end: number): boolean {
	const line = lines[index] ?? "";
	if (!line.trim()) {
		return false;
	}
	return (
		Boolean(fenceOpen(line)) ||
		HR_RE.test(line) ||
		/^(#{1,6})(\s|$)/.test(line) ||
		/^ {0,3}>/.test(line) ||
		isTableStart(lines, index, end) ||
		isHtmlBlockStart(lines, index, end) ||
		LIST_RE.test(line)
	);
}

function isHtmlBlockStart(
	lines: string[],
	index: number,
	end: number,
): boolean {
	const open = htmlOpenLine(lines[index] ?? "");
	if (!open) {
		return false;
	}
	if (open.tag === "hr") {
		return true;
	}
	if (open.tag === "img") {
		return Boolean(safeHref(htmlAttrValue(open.attrs, "src") ?? ""));
	}
	if (VOID_TAGS.has(open.tag)) {
		return false;
	}
	if (findHtmlClose(open.rest, open.tag)) {
		return true;
	}
	for (let j = index + 1; j < end; j += 1) {
		if (findHtmlClose(lines[j] ?? "", open.tag)) {
			return true;
		}
	}
	return false;
}

function fenceOpen(line: string): { marker: string; lang: string } | null {
	const match = FENCE_RE.exec(line);
	if (!match?.[2]) {
		return null;
	}
	const info = (match[3] ?? "").trim();
	return { marker: match[2], lang: info.split(/\s+/)[0] ?? "" };
}

function readFence(
	lines: string[],
	index: number,
	end: number,
	open: { marker: string; lang: string },
): { block: OpencodeMarkdown; next: number } {
	const body: string[] = [];
	let i = index + 1;
	let closed = false;
	while (i < end) {
		if (isFenceClose(lines[i] ?? "", open.marker)) {
			closed = true;
			i += 1;
			break;
		}
		body.push(lines[i] ?? "");
		i += 1;
	}
	let text = body.join("\n");
	if (closed) {
		text = text.replace(/\n$/, "");
	}
	return {
		block: { type: "code", lang: open.lang, text },
		next: i,
	};
}

function isFenceClose(line: string, marker: string): boolean {
	const match = /^(\s{0,3})(`{3,}|~{3,})\s*$/.exec(line);
	const token = match?.[2] ?? "";
	return token[0] === marker[0] && token.length >= marker.length;
}

type HtmlOpen = {
	indent: number;
	tag: string;
	attrs: OpencodeHtmlAttr[];
	rest: string;
};

function htmlOpenLine(line: string): HtmlOpen | null {
	const match =
		/^ {0,3}<([a-z][a-z0-9-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*"|='[^']*'|=[^\s"'=<>`]+)?)*)\s*(\/?)>(.*)$/.exec(
			line,
		);
	if (!match?.[1]) {
		return null;
	}
	const tag = match[1];
	if (DANGEROUS_TAGS.has(tag)) {
		return null;
	}
	const attrs = parseAttrs(match[2] ?? "");
	if (!attrs) {
		return null;
	}
	return {
		indent: leadingSpaces(line),
		tag,
		attrs: filterAttrs(attrs),
		rest: match[4] ?? "",
	};
}

function readHtmlBlock(
	lines: string[],
	index: number,
	end: number,
): { block: OpencodeMarkdown; next: number } | null {
	const open = htmlOpenLine(lines[index] ?? "");
	if (!open) {
		return null;
	}
	if (open.tag === "hr") {
		if (open.rest.trim()) {
			lines[index] = open.rest;
			return { block: { type: "hr" }, next: index };
		}
		return { block: { type: "hr" }, next: index + 1 };
	}
	if (open.tag === "img") {
		const href = safeHref(htmlAttrValue(open.attrs, "src") ?? "");
		if (!href) {
			return null;
		}
		const attrs = [
			...open.attrs.filter((attr) => attr.name !== "src"),
			{ name: "src", value: href },
		];
		if (open.rest.trim()) {
			lines[index] = open.rest;
			return {
				block: { type: "html", tag: "img", attrs, blocks: [] },
				next: index,
			};
		}
		return {
			block: { type: "html", tag: "img", attrs, blocks: [] },
			next: index + 1,
		};
	}
	if (VOID_TAGS.has(open.tag)) {
		return null;
	}
	const sameLine = findHtmlClose(open.rest, open.tag);
	if (sameLine) {
		const inner = sameLine.inner
			? parseBlocks([sameLine.inner], 0, 1).blocks
			: [];
		const block: OpencodeMarkdown = {
			type: "html",
			tag: open.tag,
			attrs: open.attrs,
			blocks: inner,
		};
		if (sameLine.trailing.trim()) {
			lines[index] = sameLine.trailing;
			return { block, next: index };
		}
		return { block, next: index + 1 };
	}
	const body: string[] = open.rest.trim()
		? [dedent(open.rest, open.indent)]
		: [];
	let j = index + 1;
	let close: { inner: string; trailing: string } | null = null;
	while (j < end) {
		close = findHtmlClose(lines[j] ?? "", open.tag);
		if (close) {
			if (close.inner.trim()) {
				body.push(close.inner);
			}
			break;
		}
		body.push(dedent(lines[j] ?? "", open.indent));
		j += 1;
	}
	if (j >= end || !close) {
		return null;
	}
	const block: OpencodeMarkdown = {
		type: "html",
		tag: open.tag,
		attrs: open.attrs,
		blocks: parseBlocks(body, 0, body.length).blocks,
	};
	if (close.trailing.trim()) {
		lines[j] = close.trailing;
		return { block, next: j };
	}
	return { block, next: j + 1 };
}

function findHtmlClose(
	source: string,
	tag: string,
): { inner: string; raw: string; trailing: string } | null {
	const match = new RegExp(`</${tag}\\s*>`, "i").exec(source);
	if (!match) {
		return null;
	}
	return {
		inner: source.slice(0, match.index),
		raw: match[0],
		trailing: source.slice(match.index + match[0].length),
	};
}

function readHtmlInline(
	source: string,
	index: number,
): { node: OpencodeInline; end: number } | null {
	const match = HTML_OPEN_RE.exec(source.slice(index));
	if (!match?.[1]) {
		return null;
	}
	const tag = match[1];
	if (DANGEROUS_TAGS.has(tag)) {
		return null;
	}
	const attrs = parseAttrs(match[2] ?? "");
	if (!attrs) {
		return null;
	}
	const safe = filterAttrs(attrs);
	const after = index + match[0].length;
	if (tag === "br") {
		return { node: { type: "break" }, end: after };
	}
	if (tag === "img") {
		const href = safeHref(htmlAttrValue(safe, "src") ?? "");
		if (!href) {
			return null;
		}
		return {
			node: { type: "image", href, alt: htmlAttrValue(safe, "alt") ?? "" },
			end: after,
		};
	}
	if (match[3] === "/" || VOID_TAGS.has(tag)) {
		return {
			node: { type: "html", tag, attrs: safe, inlines: [] },
			end: after,
		};
	}
	const close = findHtmlClose(source.slice(after), tag);
	if (!close) {
		return null;
	}
	return {
		node: {
			type: "html",
			tag,
			attrs: safe,
			inlines: parseInlines(close.inner),
		},
		end: after + close.inner.length + close.raw.length,
	};
}

function parseAttrs(raw: string): OpencodeHtmlAttr[] | null {
	const attrs: OpencodeHtmlAttr[] = [];
	let i = 0;
	while (i < raw.length) {
		if (/\s/.test(raw[i] ?? "")) {
			i += 1;
			continue;
		}
		const name = ATTR_NAME_RE.exec(raw.slice(i))?.[0];
		if (!name) {
			return null;
		}
		i += name.length;
		let value = "";
		if ((raw[i] ?? "") === "=") {
			i += 1;
			const quote = raw[i] ?? "";
			if (quote === '"' || quote === "'") {
				const close = raw.indexOf(quote, i + 1);
				if (close < 0) {
					return null;
				}
				value = raw.slice(i + 1, close);
				i = close + 1;
			} else {
				const match = ATTR_VALUE_RE.exec(raw.slice(i));
				if (!match?.[0]) {
					return null;
				}
				value = match[0];
				i += match[0].length;
			}
		}
		attrs.push({ name: name.toLowerCase(), value });
	}
	return attrs;
}

function filterAttrs(attrs: OpencodeHtmlAttr[]): OpencodeHtmlAttr[] {
	return attrs.filter(
		(attr) => ALLOWED_ATTRS.has(attr.name) && !/^on/i.test(attr.name),
	);
}

export function htmlAttrValue(
	attrs: OpencodeHtmlAttr[],
	name: string,
): string | null {
	for (const attr of attrs) {
		if (attr.name === name) {
			return attr.value;
		}
	}
	return null;
}

function inlineText(inlines: OpencodeInline[]): string {
	let text = "";
	for (const node of inlines) {
		if (node.type === "text" || node.type === "code") {
			text += node.text;
		} else if (node.type === "image") {
			text += node.alt;
		} else if (node.type === "break") {
			text += " ";
		} else {
			text += inlineText(node.inlines);
		}
	}
	return text;
}

function readQuote(
	lines: string[],
	index: number,
	end: number,
): { block: OpencodeMarkdown; next: number } {
	const inner: string[] = [];
	let i = index;
	while (i < end && /^ {0,3}>/.test(lines[i] ?? "")) {
		inner.push((lines[i] ?? "").replace(/^ {0,3}>\s?/, ""));
		i += 1;
	}
	if (i === index) {
		i += 1;
	}
	return {
		block: {
			type: "quote",
			blocks: parseBlocks(inner, 0, inner.length).blocks,
		},
		next: i,
	};
}

function isTableStart(lines: string[], index: number, end: number): boolean {
	const line = lines[index] ?? "";
	const next = lines[index + 1] ?? "";
	if (index + 1 >= end || !line.includes("|") || !isTableSep(next)) {
		return false;
	}
	return (
		splitRow(line).length > 0 && splitRow(line).length === splitRow(next).length
	);
}

function isTableSep(line: string): boolean {
	if (!line.includes("|") || !line.includes("-")) {
		return false;
	}
	const cells = splitRow(line);
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith("|")) {
		row = row.slice(1);
	}
	if (row.endsWith("|")) {
		row = row.slice(0, -1);
	}
	return row.split("|").map((cell) => cell.trim());
}

function readTable(
	lines: string[],
	index: number,
	end: number,
): { block: OpencodeMarkdown; next: number } {
	const header = splitRow(lines[index] ?? "").map((cell) => parseInlines(cell));
	const aligns = splitRow(lines[index + 1] ?? "").map(alignOf);
	const rows: OpencodeInline[][][] = [];
	let i = index + 2;
	while (i < end && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) {
		if (isTableSep(lines[i] ?? "")) {
			break;
		}
		rows.push(splitRow(lines[i] ?? "").map((cell) => parseInlines(cell)));
		i += 1;
	}
	if (i === index) {
		i += 1;
	}
	return {
		block: { type: "table", aligns, header, rows },
		next: i,
	};
}

function alignOf(cell: string): "left" | "center" | "right" | null {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) {
		return "center";
	}
	if (right) {
		return "right";
	}
	if (left) {
		return "left";
	}
	return null;
}

function readList(
	lines: string[],
	index: number,
	end: number,
): { block: OpencodeMarkdown; next: number } {
	const first = LIST_RE.exec(lines[index] ?? "");
	if (!first?.[2]) {
		return {
			block: { type: "list", ordered: false, start: 1, items: [] },
			next: index + 1,
		};
	}
	const ordered = /^\d/.test(first[2]);
	const markerIndent = (first[1] ?? "").length;
	const start = ordered ? Number(/^(\d+)/.exec(first[2])?.[1] ?? "1") : 1;
	const items: OpencodeListItem[] = [];
	let i = index;
	while (i < end) {
		const match = LIST_RE.exec(lines[i] ?? "");
		if (!match?.[2] || (match[1] ?? "").length !== markerIndent) {
			break;
		}
		if (ordered !== /^\d/.test(match[2])) {
			break;
		}
		const marker = match[2];
		const strip = markerIndent + marker.length + 1;
		const itemText = [match[3] ?? ""];
		const nested: string[] = [];
		i += 1;
		while (i < end) {
			const next = lines[i] ?? "";
			if (!next.trim()) {
				const peek = nextContent(lines, i + 1, end);
				if (peek < 0) {
					break;
				}
				const peekLine = lines[peek] ?? "";
				const peekList = LIST_RE.exec(peekLine);
				if (peekList && (peekList[1] ?? "").length === markerIndent) {
					break;
				}
				if (leadingSpaces(peekLine) <= markerIndent) {
					break;
				}
				while (i < peek) {
					nested.push(dedent(lines[i] ?? "", strip));
					i += 1;
				}
				continue;
			}
			if (leadingSpaces(next) < strip) {
				break;
			}
			const nestedList = LIST_RE.exec(next);
			if (
				nestedList &&
				(nestedList[1] ?? "").length <= markerIndent &&
				leadingSpaces(next) <= markerIndent
			) {
				break;
			}
			const body = dedent(next, strip);
			const open = htmlOpenLine(body);
			if (
				open &&
				open.tag !== "hr" &&
				!VOID_TAGS.has(open.tag) &&
				!findHtmlClose(open.rest, open.tag)
			) {
				nested.push(body);
				i += 1;
				while (i < end) {
					const inner = dedent(lines[i] ?? "", strip);
					nested.push(inner);
					const closed = findHtmlClose(inner, open.tag);
					i += 1;
					if (closed) {
						break;
					}
				}
				continue;
			}
			if (isNestedBlock(next, strip) || !next.trim()) {
				nested.push(dedent(next, strip));
				i += 1;
				continue;
			}
			itemText.push(next.trim());
			i += 1;
		}
		const blocks = parseBlocks(nested, 0, nested.length).blocks;
		items.push({ inlines: parseInlines(joinParagraph(itemText)), blocks });
	}
	if (i === index) {
		i += 1;
	}
	return { block: { type: "list", ordered, start, items }, next: i };
}

function isNestedBlock(line: string, strip: number): boolean {
	const body = dedent(line, strip);
	const open = htmlOpenLine(body);
	if (open) {
		if (open.tag === "hr") {
			return true;
		}
		if (open.tag === "img") {
			return Boolean(safeHref(htmlAttrValue(open.attrs, "src") ?? ""));
		}
		if (VOID_TAGS.has(open.tag)) {
			return false;
		}
		return true;
	}
	return (
		Boolean(fenceOpen(body)) ||
		HR_RE.test(body) ||
		/^(#{1,6})(\s|$)/.test(body) ||
		/^ {0,3}>/.test(body) ||
		LIST_RE.test(body)
	);
}

function nextContent(lines: string[], index: number, end: number): number {
	for (let i = index; i < end; i += 1) {
		if ((lines[i] ?? "").trim()) {
			return i;
		}
	}
	return -1;
}

function leadingSpaces(line: string): number {
	let spaces = 0;
	for (const char of line) {
		if (char === " ") {
			spaces += 1;
			continue;
		}
		if (char === "\t") {
			spaces += 4;
			continue;
		}
		break;
	}
	return spaces;
}

function dedent(line: string, width: number): string {
	let spaces = 0;
	let i = 0;
	while (i < line.length && spaces < width) {
		if (line[i] === " ") {
			spaces += 1;
			i += 1;
			continue;
		}
		if (line[i] === "\t") {
			spaces += 4;
			i += 1;
			continue;
		}
		break;
	}
	return line.slice(i);
}

function joinParagraph(lines: string[]): string {
	const parts: string[] = [];
	for (const line of lines) {
		const hard = / {2}$/.test(line) || /\\$/.test(line);
		const text = line.replace(/\\$/, "").trim();
		if (!text) {
			if (hard && parts.length > 0) {
				parts.push("\n");
			}
			continue;
		}
		if (parts.length > 0 && parts[parts.length - 1] !== "\n") {
			parts.push(hard ? "\n" : " ");
		}
		parts.push(text);
		if (hard) {
			parts.push("\n");
		}
	}
	return parts.join("").replace(/\n$/, "");
}

function parseInlines(source: string): OpencodeInline[] {
	const out: OpencodeInline[] = [];
	let i = 0;
	const pushText = (text: string) => {
		if (!text) {
			return;
		}
		const last = out[out.length - 1];
		if (last?.type === "text") {
			last.text += text;
			return;
		}
		out.push({ type: "text", text });
	};
	while (i < source.length) {
		const char = source[i] ?? "";
		if (char === "\\" && ESCAPES.includes(source[i + 1] ?? "")) {
			pushText(source[i + 1] ?? "");
			i += 2;
			continue;
		}
		if (char === "\n") {
			out.push({ type: "break" });
			i += 1;
			continue;
		}
		if (char === "<") {
			const html = readHtmlInline(source, i);
			if (html) {
				out.push(html.node);
				i = html.end;
				continue;
			}
			pushText("<");
			i += 1;
			continue;
		}
		if (char === "`") {
			const width = runLength(source, i, "`");
			const close = findRun(source, i + width, "`", width);
			if (close < 0) {
				pushText(source.slice(i));
				break;
			}
			let inner = source.slice(i + width, close);
			if (
				inner.length >= 2 &&
				inner.startsWith(" ") &&
				inner.endsWith(" ") &&
				inner.trim()
			) {
				inner = inner.slice(1, -1);
			}
			out.push({ type: "code", text: inner.replace(/\n/g, " ") });
			i = close + width;
			continue;
		}
		if (source.startsWith("~~", i)) {
			const close = source.indexOf("~~", i + 2);
			if (close < 0 || source.slice(i + 2, close).includes("\n")) {
				pushText("~");
				i += 1;
				continue;
			}
			const inner = source.slice(i + 2, close);
			if (!inner) {
				pushText("~~");
				i += 2;
				continue;
			}
			out.push({ type: "strike", inlines: parseInlines(inner) });
			i = close + 2;
			continue;
		}
		if (char === "!" && source[i + 1] === "[") {
			const image = readLink(source, i + 1);
			if (image) {
				const href = safeHref(image.href);
				if (href) {
					out.push({
						type: "image",
						href,
						alt: inlineText(parseInlines(image.label)),
					});
					i = image.end;
					continue;
				}
				const alt = parseInlines(image.label);
				if (alt.length > 0) {
					out.push(...alt);
				} else {
					pushText(image.label);
				}
				i = image.end;
				continue;
			}
		}
		if (char === "[") {
			const link = readLink(source, i);
			if (link) {
				const label = parseInlines(link.label);
				const href = safeHref(link.href);
				if (href) {
					out.push({ type: "link", href, inlines: label });
				} else if (label.length > 0) {
					out.push(...label);
				} else {
					pushText(link.label);
				}
				i = link.end;
				continue;
			}
		}
		if (source.startsWith("http://", i) || source.startsWith("https://", i)) {
			const match = /^https?:\/\/[^\s<]+/.exec(source.slice(i));
			if (match?.[0]) {
				let href = match[0];
				let trail = "";
				while (/[.,;:!?)]$/.test(href)) {
					trail = href.slice(-1) + trail;
					href = href.slice(0, -1);
				}
				const safe = safeHref(href);
				if (safe) {
					out.push({
						type: "link",
						href: safe,
						inlines: [{ type: "text", text: safe }],
					});
					pushText(trail);
					i += match[0].length;
					continue;
				}
			}
		}
		if (source.startsWith("**", i) || source.startsWith("__", i)) {
			const marker = source.slice(i, i + 2);
			const close = findMarker(source, i + 2, marker);
			if (close < 0 || !source.slice(i + 2, close).trim()) {
				pushText(marker[0] ?? "*");
				i += 1;
				continue;
			}
			out.push({
				type: "strong",
				inlines: parseInlines(source.slice(i + 2, close)),
			});
			i = close + 2;
			continue;
		}
		if ((char === "*" || char === "_") && canOpenEm(source, i, char)) {
			const close = findEmClose(source, i + 1, char);
			if (close < 0) {
				pushText(char);
				i += 1;
				continue;
			}
			out.push({
				type: "em",
				inlines: parseInlines(source.slice(i + 1, close)),
			});
			i = close + 1;
			continue;
		}
		const next = nextSpecial(source, i + 1);
		pushText(source.slice(i, next));
		i = next;
	}
	return out;
}

function safeHref(raw: string): string | null {
	const href = raw.trim().replace(/^<|>$/g, "");
	if (!/^https?:\/\//i.test(href)) {
		return null;
	}
	if (/[\s<>]/.test(href)) {
		return null;
	}
	return href;
}

function readLink(
	source: string,
	index: number,
): { label: string; href: string; end: number } | null {
	if (source[index] !== "[") {
		return null;
	}
	let depth = 1;
	let j = index + 1;
	while (j < source.length && depth > 0) {
		if (source[j] === "\\") {
			j += 2;
			continue;
		}
		if (source[j] === "[") {
			depth += 1;
		} else if (source[j] === "]") {
			depth -= 1;
		}
		if (depth > 0) {
			j += 1;
		}
	}
	if (depth !== 0 || source[j] !== "]") {
		return null;
	}
	if (source[j + 1] !== "(") {
		return null;
	}
	const dest = readDestination(source, j + 2);
	if (!dest) {
		return null;
	}
	return { label: source.slice(index + 1, j), href: dest.href, end: dest.end };
}

function readDestination(
	source: string,
	index: number,
): { href: string; end: number } | null {
	if (source[index] === "<") {
		const close = source.indexOf(">", index + 1);
		if (close < 0 || source[close + 1] !== ")") {
			return null;
		}
		return { href: source.slice(index + 1, close), end: close + 2 };
	}
	let depth = 0;
	let j = index;
	while (j < source.length) {
		const char = source[j] ?? "";
		if (char === "\\") {
			j += 2;
			continue;
		}
		if (char === "(") {
			depth += 1;
			j += 1;
			continue;
		}
		if (char === ")") {
			if (depth === 0) {
				const href = source.slice(index, j).trim();
				return href ? { href, end: j + 1 } : null;
			}
			depth -= 1;
			j += 1;
			continue;
		}
		if (/\s/.test(char)) {
			const href = source.slice(index, j).trim();
			const close = source.indexOf(")", j);
			if (!href || close < 0) {
				return null;
			}
			return { href, end: close + 1 };
		}
		j += 1;
	}
	return null;
}

function runLength(source: string, index: number, char: string): number {
	let i = index;
	while (source[i] === char) {
		i += 1;
	}
	return i - index;
}

function findRun(
	source: string,
	index: number,
	char: string,
	width: number,
): number {
	for (let i = index; i < source.length; i += 1) {
		if (source[i] !== char) {
			continue;
		}
		if (runLength(source, i, char) === width) {
			return i;
		}
	}
	return -1;
}

function findMarker(source: string, index: number, marker: string): number {
	let i = index;
	while (i < source.length) {
		if (source[i] === "`") {
			const width = runLength(source, i, "`");
			const close = findRun(source, i + width, "`", width);
			if (close < 0) {
				return -1;
			}
			i = close + width;
			continue;
		}
		if (source.startsWith(marker, i)) {
			return i;
		}
		i += 1;
	}
	return -1;
}

function canOpenEm(source: string, index: number, marker: string): boolean {
	const prev = source[index - 1] ?? "";
	const next = source[index + 1] ?? "";
	if (!next || /\s/.test(next) || next === marker) {
		return false;
	}
	if (marker === "_" && /[A-Za-z0-9]/.test(prev)) {
		return false;
	}
	return true;
}

function canCloseEm(source: string, index: number, marker: string): boolean {
	const prev = source[index - 1] ?? "";
	const next = source[index + 1] ?? "";
	if (!prev || /\s/.test(prev)) {
		return false;
	}
	if (marker === "_" && /[A-Za-z0-9]/.test(next)) {
		return false;
	}
	return true;
}

function findEmClose(source: string, index: number, marker: string): number {
	let i = index;
	while (i < source.length) {
		if (source[i] === "\n") {
			return -1;
		}
		if (source[i] === "`") {
			const width = runLength(source, i, "`");
			const close = findRun(source, i + width, "`", width);
			if (close < 0) {
				return -1;
			}
			i = close + width;
			continue;
		}
		if (marker === "*" && source.startsWith("**", i)) {
			i += 2;
			continue;
		}
		if (source[i] === marker && canCloseEm(source, i, marker)) {
			return i;
		}
		i += 1;
	}
	return -1;
}

function nextSpecial(source: string, index: number): number {
	for (let i = index; i < source.length; i += 1) {
		const char = source[i] ?? "";
		if (
			char === "\\" ||
			char === "\n" ||
			char === "`" ||
			char === "*" ||
			char === "_" ||
			char === "~" ||
			char === "[" ||
			char === "!" ||
			char === "<" ||
			source.startsWith("http://", i) ||
			source.startsWith("https://", i)
		) {
			return i;
		}
	}
	return source.length;
}

export function serializeSafeHtml(blocks: OpencodeMarkdown[]): string {
	return blocks.map(serializeBlock).join("");
}

function serializeBlock(block: OpencodeMarkdown): string {
	if (block.type === "heading") {
		return `<h${block.level}>${serializeInlines(block.inlines)}</h${block.level}>`;
	}
	if (block.type === "paragraph") {
		return `<p>${serializeInlines(block.inlines)}</p>`;
	}
	if (block.type === "code") {
		return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
	}
	if (block.type === "list") {
		const tag = block.ordered ? "ol" : "ul";
		const start =
			block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
		const items = block.items
			.map(
				(item) =>
					`<li>${serializeInlines(item.inlines)}${serializeSafeHtml(item.blocks)}</li>`,
			)
			.join("");
		return `<${tag}${start}>${items}</${tag}>`;
	}
	if (block.type === "quote") {
		return `<blockquote>${serializeSafeHtml(block.blocks)}</blockquote>`;
	}
	if (block.type === "table") {
		const aligns = block.aligns
			.map((align) => (align ? ` style="text-align: ${align}"` : ""))
			.join("");
		const head = block.header
			.map(
				(cell, index) =>
					`<th${aligns[index] ?? ""}>${serializeInlines(cell)}</th>`,
			)
			.join("");
		const body = block.rows
			.map(
				(row) =>
					`<tr>${row
						.map(
							(cell, index) =>
								`<td${aligns[index] ?? ""}>${serializeInlines(cell)}</td>`,
						)
						.join("")}</tr>`,
			)
			.join("");
		return `<div class="oc-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
	}
	if (block.type === "hr") {
		return "<hr />";
	}
	return serializeHtmlTag(
		block.tag,
		block.attrs,
		serializeSafeHtml(block.blocks),
	);
}

function serializeInlines(inlines: OpencodeInline[]): string {
	let out = "";
	for (const node of inlines) {
		if (node.type === "text") {
			out += escapeHtml(node.text);
		} else if (node.type === "break") {
			out += "<br />";
		} else if (node.type === "code") {
			out += `<code>${escapeHtml(node.text)}</code>`;
		} else if (node.type === "strong") {
			out += `<strong>${serializeInlines(node.inlines)}</strong>`;
		} else if (node.type === "em") {
			out += `<em>${serializeInlines(node.inlines)}</em>`;
		} else if (node.type === "strike") {
			out += `<s>${serializeInlines(node.inlines)}</s>`;
		} else if (node.type === "link") {
			out += `<a href="${escapeHtml(node.href)}">${serializeInlines(node.inlines)}</a>`;
		} else if (node.type === "image") {
			out += `<img src="${escapeHtml(node.href)}" alt="${escapeHtml(node.alt)}" />`;
		} else {
			out += serializeHtmlTag(
				node.tag,
				node.attrs,
				serializeInlines(node.inlines),
			);
		}
	}
	return out;
}

function serializeHtmlTag(
	tag: string,
	attrs: OpencodeHtmlAttr[],
	inner: string,
): string {
	if (tag === "img") {
		const src = escapeHtml(htmlAttrValue(attrs, "src") ?? "");
		const alt = escapeHtml(htmlAttrValue(attrs, "alt") ?? "");
		return `<img src="${src}" alt="${alt}" />`;
	}
	if (tag === "hr") {
		return "<hr />";
	}
	const safe = filterAttrs(attrs);
	const rendered = safe
		.map((attr) => ` ${attr.name}="${escapeHtml(attr.value)}"`)
		.join("");
	return `<${tag}${rendered}>${inner}</${tag}>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
