import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { CreditsUsageSummary } from "../lib/api.ts";
import { useColorMode } from "../lib/color-mode.tsx";
import { dashboardUrl } from "../lib/config.ts";
import { useLocale, useT } from "../lib/locale.tsx";
import {
	mobileUsageEmbedUrl,
	USAGE_EMBED_MESSAGE_TYPE,
	USAGE_EMBED_READY_TYPE,
	usageEmbedScript,
} from "../lib/usage-embed.ts";
import { Muted, Paper } from "./ui.tsx";

export default function UsageChartsWebView({
	summary,
}: {
	summary: CreditsUsageSummary;
}) {
	const t = useT();
	const { locale } = useLocale();
	const { mode } = useColorMode();
	const [failed, setFailed] = useState(false);
	const webRef = useRef<WebView>(null);

	const payload = {
		type: USAGE_EMBED_MESSAGE_TYPE,
		days: summary.days,
		since: summary.since,
		calls: summary.calls,
		micros: summary.micros,
		byKind: summary.byKind,
		byModel: summary.byModel,
		daily: summary.daily,
	} as const;
	const uri = mobileUsageEmbedUrl(dashboardUrl, { locale, theme: mode });
	const script = usageEmbedScript({ ...payload });

	const scriptRef = useRef(script);
	scriptRef.current = script;

	function push() {
		webRef.current?.injectJavaScript(scriptRef.current);
	}

	useEffect(() => {
		const inject = () => {
			webRef.current?.injectJavaScript(script);
		};
		inject();
		const timers = [250, 1000].map((ms) => setTimeout(inject, ms));
		return () => {
			for (const timer of timers) {
				clearTimeout(timer);
			}
		};
	}, [script]);

	if (failed) {
		return (
			<Paper>
				<Muted>
					{summary.calls > 0
						? `${t("credits.usageSpent")}: $${(summary.micros / 1_000_000).toFixed(4)} · ${t("credits.usageCalls", { count: summary.calls })}`
						: t("credits.usageEmpty")}
				</Muted>
			</Paper>
		);
	}

	return (
		<View style={{ height: 1180, borderRadius: 8, overflow: "hidden" }}>
			<WebView
				ref={webRef}
				source={{ uri }}
				style={{ flex: 1, backgroundColor: "transparent" }}
				javaScriptEnabled
				domStorageEnabled
				nestedScrollEnabled
				originWhitelist={["https://*"]}
				setSupportMultipleWindows={false}
				injectedJavaScript={script}
				injectedJavaScriptBeforeContentLoaded={script}
				onError={() => setFailed(true)}
				onHttpError={() => setFailed(true)}
				onLoadEnd={push}
				onMessage={(event) => {
					try {
						const data = JSON.parse(event.nativeEvent.data) as {
							type?: string;
						};
						if (data.type === USAGE_EMBED_READY_TYPE) {
							push();
						}
					} catch {
						return;
					}
				}}
			/>
		</View>
	);
}
