import Box from "@shpaw415/mui-lite/Box";
import {
	boardFileLanguage,
	type CodeEditorSelection,
	EDITOR_EMBED_BRIDGE_KEY,
	EDITOR_EMBED_CHANGE_TYPE,
	EDITOR_EMBED_PENDING_KEY,
	EDITOR_EMBED_READY_TYPE,
	EDITOR_EMBED_SAVE_TYPE,
	EDITOR_EMBED_SELECTION_TYPE,
	type EditorEmbedPayload,
	parseEditorEmbedMessage,
} from "gpio-companion";
import { parseLocale } from "gpio-companion/i18n";
import { useEffect, useRef, useState } from "react";
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

export default function EditorEmbedPage() {
	const { setLocale } = useLocale();
	const { setMode, mode } = useColorMode();
	const [payload, setPayload] = useState<EditorEmbedPayload | null>(null);
	const [text, setText] = useState("");
	const applied = useRef(-1);

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
			const next = parseEditorEmbedMessage(data);
			if (!next) {
				return;
			}
			setPayload(next);
			if (next.rev !== applied.current) {
				applied.current = next.rev;
				setText(next.text);
			}
		}
		function onMessage(event: MessageEvent) {
			apply(event.data);
		}
		const bridge = window as unknown as Window & {
			ReactNativeWebView?: { postMessage: (message: string) => void };
		} & Record<string, unknown>;
		const pending = bridge[EDITOR_EMBED_PENDING_KEY];
		if (pending) {
			apply(pending);
		}
		bridge[EDITOR_EMBED_BRIDGE_KEY] = apply;
		window.addEventListener("message", onMessage);
		const ready = JSON.stringify({ type: EDITOR_EMBED_READY_TYPE });
		window.parent.postMessage({ type: EDITOR_EMBED_READY_TYPE }, "*");
		bridge.ReactNativeWebView?.postMessage(ready);
		return () => {
			window.removeEventListener("message", onMessage);
			delete bridge[EDITOR_EMBED_BRIDGE_KEY];
		};
	}, []);

	function post(message: unknown) {
		const body = JSON.stringify(message);
		window.parent.postMessage(message, "*");
		const bridge = window as unknown as {
			ReactNativeWebView?: { postMessage: (value: string) => void };
		};
		bridge.ReactNativeWebView?.postMessage(body);
	}

	return (
		<Box sx={{ height: "100dvh", minHeight: 0 }}>
			<EmbedEditor
				path={payload?.path ?? "file.txt"}
				value={text}
				theme={mode === "dark" ? "vs-dark" : "vs"}
				onChange={(next) => {
					setText(next);
					post({ type: EDITOR_EMBED_CHANGE_TYPE, text: next });
				}}
				onSave={() => post({ type: EDITOR_EMBED_SAVE_TYPE })}
				onSelection={(selection) => {
					post({ type: EDITOR_EMBED_SELECTION_TYPE, selection });
				}}
			/>
		</Box>
	);
}

function EmbedEditor({
	path,
	value,
	theme,
	onChange,
	onSave,
	onSelection,
}: {
	path: string;
	value: string;
	theme: "vs-dark" | "vs";
	onChange: (value: string) => void;
	onSave: () => void;
	onSelection: (selection: CodeEditorSelection | null) => void;
}) {
	const [Editor, setEditor] = useState<
		typeof import("@monaco-editor/react").default | null
	>(null);
	const onSelectionRef = useRef(onSelection);
	onSelectionRef.current = onSelection;
	useEffect(() => {
		let closed = false;
		void import("@monaco-editor/react").then((mod) => {
			if (!closed) {
				setEditor(() => mod.default);
			}
		});
		return () => {
			closed = true;
		};
	}, []);
	if (!Editor) {
		return null;
	}
	return (
		<Editor
			height="100%"
			path={path}
			language={payloadLanguage(path)}
			theme={theme}
			value={value}
			onChange={(next) => onChange(next ?? "")}
			onMount={(editor, monaco) => {
				editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
				editor.onDidChangeCursorSelection(() => {
					const selection = editor.getSelection();
					const model = editor.getModel();
					if (!selection || selection.isEmpty() || !model) {
						onSelectionRef.current(null);
						return;
					}
					onSelectionRef.current({
						startLine: selection.startLineNumber,
						endLine: selection.endLineNumber,
						text: model.getValueInRange(selection),
					});
				});
			}}
			options={{
				fontSize: 13,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				wordWrap: "on",
				automaticLayout: true,
				tabSize: 2,
			}}
		/>
	);
}

function payloadLanguage(path: string): string {
	return boardFileLanguage(path);
}
