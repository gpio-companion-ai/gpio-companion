import { useMemo } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

export default function SvgPreview({ text }: { text: string }) {
	const html = useMemo(
		() =>
			`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;background:#fff;height:100%;display:flex;align-items:center;justify-content:center}svg{width:100%;height:100%}</style></head><body>${text}</body></html>`,
		[text],
	);
	return (
		<View
			style={{
				flex: 1,
				backgroundColor: "#fff",
				borderRadius: 8,
				overflow: "hidden",
				margin: 12,
			}}
		>
			<WebView
				source={{ html }}
				style={{ flex: 1, backgroundColor: "transparent" }}
				javaScriptEnabled={false}
				originWhitelist={["about:blank"]}
				showsVerticalScrollIndicator={false}
			/>
		</View>
	);
}
