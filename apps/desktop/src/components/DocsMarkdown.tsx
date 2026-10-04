import { type MouseEvent, useMemo } from "react";
import { openExternal } from "../api";
import { renderDocsMarkdown } from "../lib/markdown";

export default function DocsMarkdown({
	content,
	onOpenDoc,
}: {
	content: string;
	onOpenDoc?: (id: string) => void;
}) {
	const html = useMemo(() => renderDocsMarkdown(content), [content]);

	function onClick(event: MouseEvent<HTMLDivElement>) {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const anchor = target.closest("a");
		if (!(anchor instanceof HTMLAnchorElement)) {
			return;
		}
		const href = anchor.getAttribute("href") ?? "";
		if (href.startsWith("#doc:")) {
			event.preventDefault();
			onOpenDoc?.(href.slice(5));
			return;
		}
		if (href.startsWith("#")) {
			event.preventDefault();
			document.getElementById(href.slice(1))?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
			return;
		}
		if (/^https?:\/\//i.test(href)) {
			event.preventDefault();
			void openExternal(href);
		}
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: delegates link clicks out to the OS browser
		// biome-ignore lint/a11y/useKeyWithClickEvents: links inside the rendered docs remain keyboard focusable
		<div
			className="docs-markdown"
			onClick={onClick}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: official docs bundled at build time, not user HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
