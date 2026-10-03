import { asSshWsError, parseSshWsCommand } from "gpio-companion-ssh";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview/lib/WebViewTypes";
import { connectSshLive } from "../lib/api";
import { useColorMode } from "../lib/color-mode.tsx";
import { useT } from "../lib/locale.tsx";
import { FIT_JS, XTERM_CSS, XTERM_JS } from "../lib/xterm-bundle.ts";
import { ErrorText, Muted, TextButton } from "./ui";

type SshStatus = "idle" | "connecting" | "auth" | "live" | "closed";

type Props = {
	uuid: string;
	token: string | null;
};

type SocketMessage = { data?: unknown };

export default function DockSsh({ uuid, token }: Props) {
	const tCore = useT();
	const colors = useColorMode().colors;
	const webRef = useRef<WebView>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const sendRef = useRef<(data: string) => void>(() => undefined);
	const resizeRef = useRef<(cols: number, rows: number) => void>(
		() => undefined,
	);
	const [status, setStatus] = useState<SshStatus>("idle");
	const [error, setError] = useState("");

	const disconnectSocket = useCallback(() => {
		const socket = socketRef.current;
		socketRef.current = null;
		if (socket) {
			try {
				socket.close(1000, "client disconnect");
			} catch {
				undefined;
			}
		}
	}, []);

	const write = useCallback((chunk: string) => {
		webRef.current?.injectJavaScript(
			`window.__sshWrite(${JSON.stringify(chunk)}); true;`,
		);
	}, []);

	const handleSocketMessage = useCallback(
		(event: SocketMessage) => {
			try {
				const parsed = JSON.parse(String(event.data ?? ""));
				const wsError = asSshWsError(parsed);
				if (wsError) {
					setError(wsError);
					return;
				}
				if (parsed && typeof parsed === "object") {
					const record = parsed as Record<string, unknown>;
					if (record.status === "auth") {
						setStatus("auth");
						return;
					}
					if (record.status === "connected") {
						setStatus("live");
						return;
					}
					if (record.status === "closed") {
						setStatus("closed");
						return;
					}
				}
				if (typeof parsed.chunk === "string") {
					write(parsed.chunk);
				}
			} catch {
				undefined;
			}
		},
		[write],
	);

	const connect = useCallback(async () => {
		const trimmed = uuid.trim();
		if (!token || !trimmed) {
			return;
		}
		disconnectSocket();
		setError("");
		setStatus("connecting");
		try {
			const signed = await connectSshLive(token, trimmed);
			const wsUrl = signed.wsUrl.trim();
			if (!wsUrl) {
				throw new Error("missing ssh websocket url");
			}
			webRef.current?.injectJavaScript(
				"window.__sshReset && window.__sshReset(); true;",
			);
			const next = new WebSocket(wsUrl);
			socketRef.current = next;
			next.onopen = () => {
				if (socketRef.current === next) {
					next.send(JSON.stringify({ op: "open" }));
				}
			};
			next.onmessage = handleSocketMessage as (event: unknown) => void;
			next.onclose = () => {
				if (socketRef.current === next) {
					socketRef.current = null;
					setStatus("closed");
				}
			};
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "ssh failed");
			setStatus("closed");
		}
	}, [disconnectSocket, handleSocketMessage, token, uuid]);

	const disconnect = useCallback(() => {
		disconnectSocket();
		setStatus("closed");
	}, []);

	useEffect(() => {
		disconnectSocket();
		setStatus("idle");
		setError("");
	}, [disconnectSocket, uuid]);

	useEffect(() => {
		return () => {
			disconnectSocket();
		};
	}, [disconnectSocket]);

	const send = useCallback((data: string) => {
		const socket = socketRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(parseSshWsCommand({ op: "input", data })));
		}
	}, []);

	const resize = useCallback((cols: number, rows: number) => {
		const socket = socketRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(
				JSON.stringify(parseSshWsCommand({ op: "resize", cols, rows })),
			);
		}
	}, []);

	const onWebViewMessage = useCallback(
		(event: WebViewMessageEvent) => {
			try {
				const parsed = JSON.parse(String(event.nativeEvent.data ?? ""));
				if (parsed?.t === "d" && typeof parsed.d === "string") {
					send(parsed.d);
					return;
				}
				if (parsed?.t === "r") {
					resize(Number(parsed.cols), Number(parsed.rows));
				}
			} catch {
				undefined;
			}
		},
		[resize, send],
	);

	const html = terminalHtml(colors);
	const busy = status === "connecting" || status === "auth";
	const live = status === "live";

	return (
		<View style={{ flex: 1, gap: 8 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<TextButton
					label={
						busy
							? tCore("deck.dock.sshConnecting")
							: live
								? tCore("deck.dock.sshDisconnect")
								: tCore("deck.dock.sshOpen")
					}
					danger={live}
					disabled={busy || !token}
					onPress={() => void (live ? disconnect() : connect())}
				/>
			</View>
			<Muted>{tCore("deck.dock.sshHint")}</Muted>
			{error ? <ErrorText>{error}</ErrorText> : null}
			{status === "closed" && !error ? (
				<Muted>{tCore("deck.dock.sshClosed")}</Muted>
			) : null}
			{!token ? (
				<Muted>{tCore("deck.dock.needBoard")}</Muted>
			) : (
				<View
					style={{
						flex: 1,
						borderWidth: 1,
						borderColor: colors.border,
						borderRadius: 8,
						backgroundColor: colors.surface,
						overflow: "hidden",
					}}
				>
					<WebView
						ref={webRef}
						source={{ html }}
						onMessage={onWebViewMessage}
						originWhitelist={["*"]}
						hideKeyboardAccessoryView
						keyboardDisplayRequiresUserAction={false}
						style={{ flex: 1, backgroundColor: "transparent" }}
					/>
				</View>
			)}
		</View>
	);
}

function terminalHtml(colors: {
	surface: string;
	border: string;
	text: string;
	muted: string;
}): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>
${XTERM_CSS}
html, body { margin: 0; padding: 4px; height: 100%; background: ${colors.surface}; }
#term { height: calc(100% - 8px); }
.xterm .xterm-viewport { background: ${colors.surface} !important; }
</style>
</head>
<body>
<div id="term"></div>
<script>${XTERM_JS}</script>
<script>${FIT_JS}</script>
<script>
(function () {
	var term = new Terminal({
		cursorBlink: true,
		fontSize: 12,
		scrollback: 2000,
		theme: { background: "${colors.surface}", foreground: "${colors.text}" }
	});
	var fit = new FitAddon.FitAddon();
	term.loadAddon(fit);
	term.open(document.getElementById("term"));
	try { fit.fit(); } catch (e) {}
	function post(payload) {
		window.ReactNativeWebView.postMessage(JSON.stringify(payload));
	}
	term.onData(function (data) { post({ t: "d", d: data }); });
	if (typeof ResizeObserver !== "undefined") {
		new ResizeObserver(function () {
			try {
				fit.fit();
				post({ t: "r", cols: term.cols, rows: term.rows });
			} catch (e) {}
		}).observe(document.getElementById("term"));
	}
	window.__sshWrite = function (chunk) { term.write(chunk); };
	window.__sshReset = function () { term.reset(); };
	post({ t: "r", cols: term.cols, rows: term.rows });
})();
</script>
</body>
</html>`;
}
