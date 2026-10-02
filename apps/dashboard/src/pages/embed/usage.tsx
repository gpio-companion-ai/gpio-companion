import Box from "@shpaw415/mui-lite/Box";
import {
	parseUsageEmbedMessage,
	USAGE_EMBED_BRIDGE_KEY,
	USAGE_EMBED_MESSAGE_TYPE,
	USAGE_EMBED_PENDING_KEY,
	USAGE_EMBED_READY_TYPE,
	type UsageChartSummary,
} from "gpio-companion";
import { parseLocale } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import UsageCharts from "../../components/UsageCharts.tsx";
import { useColorMode } from "../../hooks/useColorMode.tsx";
import { useLocale } from "../../hooks/useLocale.tsx";

function readSearch(): { locale?: string; theme?: string } {
	if (typeof window === "undefined") {
		return {};
	}
	const params = new URLSearchParams(window.location.search);
	return {
		locale: params.get("locale") ?? undefined,
		theme: params.get("theme") ?? undefined,
	};
}

export default function UsageEmbedPage() {
	const { setLocale } = useLocale();
	const { setMode, mode } = useColorMode();
	const [summary, setSummary] = useState<UsageChartSummary | null>(null);

	useEffect(() => {
		const search = readSearch();
		const locale = parseLocale(search.locale ?? "");
		if (locale) {
			setLocale(locale);
		}
		if (search.theme === "dark" || search.theme === "light") {
			setMode(search.theme);
		}
	}, [setLocale, setMode]);

	useEffect(() => {
		function apply(data: unknown) {
			const next = parseUsageEmbedMessage(data);
			if (next && next.type === USAGE_EMBED_MESSAGE_TYPE) {
				const { type: _type, ...rest } = next;
				setSummary(rest);
			}
		}
		function onMessage(event: MessageEvent) {
			if (event.origin && event.origin !== window.location.origin) {
				return;
			}
			apply(event.data);
		}
		const bridge = window as unknown as Window & {
			ReactNativeWebView?: { postMessage: (message: string) => void };
		} & Record<string, unknown>;
		const pending = bridge[USAGE_EMBED_PENDING_KEY];
		if (pending) {
			apply(pending);
		}
		bridge[USAGE_EMBED_BRIDGE_KEY] = apply;
		window.addEventListener("message", onMessage);
		window.parent.postMessage({ type: USAGE_EMBED_READY_TYPE }, "*");
		bridge.ReactNativeWebView?.postMessage(
			JSON.stringify({ type: USAGE_EMBED_READY_TYPE }),
		);
		return () => {
			window.removeEventListener("message", onMessage);
			delete bridge[USAGE_EMBED_BRIDGE_KEY];
		};
	}, []);

	return (
		<Box sx={{ minHeight: "100dvh", padding: 16 }}>
			{summary ? (
				<UsageCharts summary={summary} dark={mode !== "light"} />
			) : null}
		</Box>
	);
}
