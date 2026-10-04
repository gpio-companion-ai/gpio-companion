import { describe, expect, test } from "bun:test";
import {
	htmlAttrValue,
	parseOpencodeMarkdown,
	serializeSafeHtml,
} from "./opencode-markdown.ts";

describe("parseOpencodeMarkdown images", () => {
	test("parses a markdown image into an image node", () => {
		expect(
			parseOpencodeMarkdown("![LED wiring](https://example.com/led.png)"),
		).toEqual([
			{
				type: "paragraph",
				inlines: [
					{
						type: "image",
						href: "https://example.com/led.png",
						alt: "LED wiring",
					},
				],
			},
		]);
	});

	test("keeps only remote http(s) image sources", () => {
		expect(parseOpencodeMarkdown("![x](data:image/png;base64,AAAA)")).toEqual([
			{ type: "paragraph", inlines: [{ type: "text", text: "x" }] },
		]);
		expect(parseOpencodeMarkdown("![x](javascript:alert(1))")).toEqual([
			{ type: "paragraph", inlines: [{ type: "text", text: "x" }] },
		]);
		expect(parseOpencodeMarkdown("![x](/local/path.png)")).toEqual([
			{ type: "paragraph", inlines: [{ type: "text", text: "x" }] },
		]);
	});

	test("parses an inline img tag", () => {
		expect(
			parseOpencodeMarkdown(
				'see <img src="https://x.test/y.png" alt="chip"> now',
			),
		).toEqual([
			{
				type: "paragraph",
				inlines: [
					{ type: "text", text: "see " },
					{ type: "image", href: "https://x.test/y.png", alt: "chip" },
					{ type: "text", text: " now" },
				],
			},
		]);
	});

	test("keeps an unsafe img tag as literal text", () => {
		expect(parseOpencodeMarkdown('<img src="javascript:alert(1)">')).toEqual([
			{
				type: "paragraph",
				inlines: [{ type: "text", text: '<img src="javascript:alert(1)">' }],
			},
		]);
	});

	test("parses a standalone img line as a block", () => {
		expect(
			parseOpencodeMarkdown('<img src="https://x.test/y.png" width="320">'),
		).toEqual([
			{
				type: "html",
				tag: "img",
				attrs: [
					{ name: "width", value: "320" },
					{ name: "src", value: "https://x.test/y.png" },
				],
				blocks: [],
			},
		]);
	});
});

describe("parseOpencodeMarkdown custom html", () => {
	test("parses a block container with nested markdown", () => {
		expect(
			parseOpencodeMarkdown(
				"<board-note>\n### Step 1\n- wire pin 7\n</board-note>\nafter",
			),
		).toEqual([
			{
				type: "html",
				tag: "board-note",
				attrs: [],
				blocks: [
					{
						type: "heading",
						level: 3,
						inlines: [{ type: "text", text: "Step 1" }],
					},
					{
						type: "list",
						ordered: false,
						start: 1,
						items: [
							{
								inlines: [{ type: "text", text: "wire pin 7" }],
								blocks: [],
							},
						],
					},
				],
			},
			{ type: "paragraph", inlines: [{ type: "text", text: "after" }] },
		]);
	});

	test("parses a same-line container with inline markdown", () => {
		expect(parseOpencodeMarkdown("<step-guide>do **it**</step-guide>")).toEqual(
			[
				{
					type: "html",
					tag: "step-guide",
					attrs: [],
					blocks: [
						{
							type: "paragraph",
							inlines: [
								{ type: "text", text: "do " },
								{ type: "strong", inlines: [{ type: "text", text: "it" }] },
							],
						},
					],
				},
			],
		);
	});

	test("parses an inline container inside a paragraph", () => {
		expect(parseOpencodeMarkdown("a <note>x</note> b")).toEqual([
			{
				type: "paragraph",
				inlines: [
					{ type: "text", text: "a " },
					{
						type: "html",
						tag: "note",
						attrs: [],
						inlines: [{ type: "text", text: "x" }],
					},
					{ type: "text", text: " b" },
				],
			},
		]);
	});

	test("drops non-allowlisted attributes", () => {
		const blocks = parseOpencodeMarkdown(
			'<wiring-check onclick="evil()" class="c" style="color: red">hi</wiring-check>',
		);
		expect(blocks[0]).toMatchObject({
			type: "html",
			tag: "wiring-check",
			attrs: [
				{ name: "class", value: "c" },
				{ name: "style", value: "color: red" },
			],
		});
	});

	test("keeps dangerous tags and unclosed containers as literal text", () => {
		for (const source of [
			"<script>alert(1)</script>",
			'<iframe src="https://x.test"></iframe>',
			"<style>a {}</style>",
			"<wiring-check>unclosed",
		]) {
			const blocks = parseOpencodeMarkdown(source);
			expect(JSON.stringify(blocks)).not.toContain('"type":"html"');
			expect(JSON.stringify(blocks)).not.toContain('"type":"image"');
		}
		expect(parseOpencodeMarkdown("<script>alert(1)</script>")).toEqual([
			{
				type: "paragraph",
				inlines: [{ type: "text", text: "<script>alert(1)</script>" }],
			},
		]);
	});

	test("maps an hr tag to an hr block", () => {
		expect(parseOpencodeMarkdown("<hr />")).toEqual([{ type: "hr" }]);
	});
});

describe("serializeSafeHtml", () => {
	test("serializes a sanitized tree", () => {
		expect(
			serializeSafeHtml(
				parseOpencodeMarkdown(
					'<board-note class="c">\n# H\n![a](https://e/i.png)\n</board-note>',
				),
			),
		).toBe(
			'<board-note class="c"><h1>H</h1><p><img src="https://e/i.png" alt="a" /></p></board-note>',
		);
	});

	test("escapes text", () => {
		expect(serializeSafeHtml(parseOpencodeMarkdown("a < b & c"))).toBe(
			"<p>a &lt; b &amp; c</p>",
		);
	});
});

describe("htmlAttrValue", () => {
	test("finds an attribute value", () => {
		const blocks = parseOpencodeMarkdown(
			'<board-note title="tip">x</board-note>',
		);
		const block = blocks[0];
		if (block?.type !== "html") {
			throw new Error("expected html block");
		}
		expect(htmlAttrValue(block.attrs, "title")).toBe("tip");
		expect(htmlAttrValue(block.attrs, "missing")).toBeNull();
	});
});
