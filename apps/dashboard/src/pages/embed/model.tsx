import ModelViewer from "@components/ModelViewer";
import Box from "@shpaw415/mui-lite/Box";
import {
	MODEL_EMBED_BRIDGE_KEY,
	MODEL_EMBED_MESSAGE_TYPE,
	MODEL_EMBED_PENDING_KEY,
	MODEL_EMBED_READY_TYPE,
	type ModelEmbedPayload,
	parseModelEmbedMessage,
} from "gpio-companion";
import { parseLocale } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useColorMode } from "../../hooks/useColorMode.tsx";
import { useLocale } from "../../hooks/useLocale.tsx";

function emptyPayload(): ModelEmbedPayload {
	return { type: MODEL_EMBED_MESSAGE_TYPE };
}

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

export default function ModelEmbedPage() {
	const { setLocale } = useLocale();
	const { setMode } = useColorMode();
	const [payload, setPayload] = useState<ModelEmbedPayload>(emptyPayload);

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
			const next = parseModelEmbedMessage(data);
			if (next) {
				setPayload(next);
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
		const pending = bridge[MODEL_EMBED_PENDING_KEY];
		if (pending) {
			apply(pending);
		}
		bridge[MODEL_EMBED_BRIDGE_KEY] = apply;
		window.addEventListener("message", onMessage);
		window.parent.postMessage({ type: MODEL_EMBED_READY_TYPE }, "*");
		bridge.ReactNativeWebView?.postMessage(
			JSON.stringify({ type: MODEL_EMBED_READY_TYPE }),
		);
		return () => {
			window.removeEventListener("message", onMessage);
			delete bridge[MODEL_EMBED_BRIDGE_KEY];
		};
	}, []);

	return (
		<Box sx={{ height: "100dvh", minHeight: 0, display: "flex" }}>
			<Box sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
				<ModelViewer glbBase64={payload.glbBase64} fill />
			</Box>
		</Box>
	);
}
