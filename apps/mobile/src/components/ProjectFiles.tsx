import {
	type BoardFileEntry,
	type BoardFileNode,
	boardFileApplyEvent,
	boardFileTree,
	EDITOR_EMBED_MESSAGE_TYPE,
	EDITOR_EMBED_READY_TYPE,
	type EditorEmbedPayload,
	editorEmbedInjectSource,
	editorEmbedUrl,
	isEditorEmbedSave,
	parseBoardFileEvent,
	parseEditorEmbedChange,
} from "gpio-companion-files";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
	listBoardFiles,
	pushProject,
	readBoardFile,
	signBoardFilesLive,
	writeBoardFile,
} from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useColorMode, useColors } from "../lib/color-mode.tsx";
import { dashboardUrl } from "../lib/config.ts";
import { useLocale, useT } from "../lib/locale.tsx";
import BreadboardWebView from "./BreadboardWebView.tsx";
import ModelWebView from "./ModelWebView.tsx";

type Props = {
	token: string;
	uuid: string;
	owner: string;
	name: string;
};

type OpenFile = {
	path: string;
	kind: "text" | "model" | "binary";
	text: string;
	base64: string;
};

const BREADBOARD_DIAGRAM_JSON = "breadboard/diagram.json";

export default function ProjectFiles({ token, uuid, owner, name }: Props) {
	const t = useT();
	const colors = useColors();
	const { boards } = useUserBoards();
	const boardModel =
		boards.find((board) => board.device.uuid === uuid)?.status?.model ?? null;
	const { locale } = useLocale();
	const { mode } = useColorMode();
	const [entries, setEntries] = useState<BoardFileEntry[]>([]);
	const [branch, setBranch] = useState("");
	const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
	const [file, setFile] = useState<OpenFile | null>(null);
	const [draft, setDraft] = useState("");
	const [diagramView, setDiagramView] = useState<"json" | "board">("board");
	const [rev, setRev] = useState(0);
	const [stale, setStale] = useState(false);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState("");
	const echo = useRef("");
	const fileRef = useRef(file);
	const draftRef = useRef(draft);
	const openPathRef = useRef<(path: string) => Promise<void>>(async () => {});
	const openedPath = useRef("");
	fileRef.current = file;
	draftRef.current = draft;
	const dirty = Boolean(file && file.kind === "text" && draft !== file.text);
	const showBoard =
		file?.path === BREADBOARD_DIAGRAM_JSON && diagramView === "board";
	const tree = boardFileTree(entries);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the board or project changes
	useEffect(() => {
		setFile(null);
		setDraft("");
		setStale(false);
		setNote("");
		setEntries([]);
		setBranch("");
		setDiagramView("board");
		openedPath.current = "";
	}, [uuid, name]);

	useEffect(() => {
		if (!token || !uuid || !name) {
			return;
		}
		let closed = false;
		void listBoardFiles(token, uuid, name)
			.then((data) => {
				if (closed) {
					return;
				}
				setEntries(data.entries);
				setBranch(data.branch);
				setNote("");
			})
			.catch((caught: unknown) => {
				if (!closed) {
					setNote(caught instanceof Error ? caught.message : "request failed");
				}
			});
		return () => {
			closed = true;
		};
	}, [token, uuid, name]);

	useEffect(() => {
		if (!token || !uuid || !name) {
			return;
		}
		let closed = false;
		let socket: WebSocket | null = null;
		let timer = 0;
		let delay = 500;
		let refresh = 0;

		function scheduleList() {
			clearTimeout(refresh);
			refresh = setTimeout(() => {
				void listBoardFiles(token, uuid, name).then((data) => {
					if (closed) {
						return;
					}
					setEntries(data.entries);
					setBranch(data.branch);
				});
			}, 200) as unknown as number;
		}

		async function connect() {
			if (closed) {
				return;
			}
			try {
				const signed = await signBoardFilesLive(token, uuid, name);
				if (closed) {
					return;
				}
				socket?.close();
				const next = new WebSocket(signed.wsUrl);
				socket = next;
				next.addEventListener("message", (event) => {
					const change = parseBoardFileEvent(event.data);
					if (!change) {
						return;
					}
					const current = fileRef.current;
					const applied = boardFileApplyEvent({
						event: change,
						openPath: current?.path ?? "",
						dirty:
							current?.kind === "text" && draftRef.current !== current.text,
						echo: echo.current === change.path,
					});
					if (applied.refreshTree) {
						scheduleList();
					}
					if (applied.action === "echo") {
						echo.current = "";
						return;
					}
					if (applied.action === "stale") {
						setStale(true);
						return;
					}
					if (applied.action === "missing") {
						setFile(null);
						setDraft("");
						setNote(t("code.fileMissing"));
						return;
					}
					if (applied.action === "reload" && current) {
						void openPathRef.current(current.path);
					}
				});
				next.addEventListener("close", () => {
					if (closed || socket !== next) {
						return;
					}
					timer = setTimeout(() => {
						delay = Math.min(delay * 2, 8000);
						void connect();
					}, delay) as unknown as number;
				});
			} catch {
				if (!closed) {
					timer = setTimeout(() => void connect(), delay) as unknown as number;
				}
			}
		}

		void connect();
		return () => {
			closed = true;
			clearTimeout(timer);
			clearTimeout(refresh);
			socket?.close();
		};
	}, [token, uuid, name, t]);

	async function openPath(path: string) {
		try {
			const data = await readBoardFile(token, uuid, name, path);
			const next: OpenFile = {
				path: data.path,
				kind: data.kind,
				text: data.text ?? "",
				base64: data.base64 ?? "",
			};
			setFile(next);
			setDraft(next.text);
			if (openedPath.current !== path) {
				openedPath.current = path;
				setDiagramView(path === BREADBOARD_DIAGRAM_JSON ? "board" : "json");
			}
			setRev((value) => value + 1);
			setStale(false);
			setNote("");
			const parts = path.split("/");
			parts.pop();
			setOpenDirs((current) => {
				const copy = new Set(current);
				let acc = "";
				for (const part of parts) {
					acc = acc ? `${acc}/${part}` : part;
					copy.add(acc);
				}
				return copy;
			});
		} catch (caught) {
			setNote(caught instanceof Error ? caught.message : "request failed");
		}
	}
	openPathRef.current = openPath;

	async function saveBoard(text = draft) {
		if (file?.kind !== "text") {
			return;
		}
		setBusy("board");
		try {
			await writeBoardFile(token, uuid, name, file.path, text);
			echo.current = file.path;
			setFile({ ...file, text });
			setDraft(text);
			setStale(false);
			setNote("");
		} catch (caught) {
			setNote(caught instanceof Error ? caught.message : "request failed");
		}
		setBusy("");
	}

	async function saveGithub() {
		if (!uuid || !owner || !name) {
			return;
		}
		setBusy("github");
		try {
			const result = await pushProject(token, { uuid, owner, name });
			const pushed = result.board.branch || branch;
			if (pushed) {
				setBranch(pushed);
			}
			setNote(t("code.savedGithub").replace("{branch}", pushed || name));
		} catch (caught) {
			setNote(caught instanceof Error ? caught.message : "request failed");
		}
		setBusy("");
	}

	const payload: EditorEmbedPayload = {
		type: EDITOR_EMBED_MESSAGE_TYPE,
		path: file?.path ?? "",
		text: file?.text ?? "",
		language: "plaintext",
		rev,
	};

	return (
		<View style={{ flex: 1 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 12,
					paddingVertical: 8,
					borderBottomWidth: 1,
					borderBottomColor: colors.chipBg,
				}}
			>
				<Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>
					{name || t("code.files")}
					{branch ? `  ${branch}` : ""}
				</Text>
				<Pressable
					disabled={busy === "github"}
					onPress={() => void saveGithub()}
				>
					<Text style={{ color: colors.primary, fontWeight: "600" }}>
						{busy === "github" ? t("code.savingGithub") : t("code.saveGithub")}
					</Text>
				</Pressable>
			</View>
			{file ? (
				<View style={{ flex: 1.2, minHeight: 180 }}>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 8,
							paddingHorizontal: 12,
							paddingVertical: 6,
						}}
					>
						<Pressable onPress={() => setFile(null)}>
							<Text style={{ color: colors.primary }}>{t("code.files")}</Text>
						</Pressable>
						<Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
							{file.path}
							{dirty ? " ●" : ""}
						</Text>
						{stale ? (
							<Pressable onPress={() => void openPath(file.path)}>
								<Text style={{ color: colors.primary }}>
									{t("code.updatedOnBoard")}
								</Text>
							</Pressable>
						) : null}
						{file.path === BREADBOARD_DIAGRAM_JSON ? (
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Pressable onPress={() => setDiagramView("json")}>
									<Text
										style={{
											color:
												diagramView === "json" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.viewJson")}
									</Text>
								</Pressable>
								<Pressable onPress={() => setDiagramView("board")}>
									<Text
										style={{
											color:
												diagramView === "board" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.viewBreadboard")}
									</Text>
								</Pressable>
							</View>
						) : null}
						{file.kind === "text" ? (
							<Pressable
								disabled={!dirty || busy === "board"}
								onPress={() => void saveBoard()}
							>
								<Text style={{ color: colors.primary, fontWeight: "600" }}>
									{busy === "board"
										? t("code.savingBoard")
										: t("code.saveBoard")}
								</Text>
							</Pressable>
						) : null}
					</View>
					{showBoard ? (
						<View style={{ flex: 1, minHeight: 0 }}>
							<BreadboardWebView
								diagramText={draft}
								boardModel={boardModel}
								fill
							/>
						</View>
					) : file.kind === "model" ? (
						<ModelWebView glbBase64={file.base64} />
					) : file.kind === "binary" ? (
						<Text style={{ color: colors.muted, padding: 12 }}>
							{t("code.binary")}
						</Text>
					) : (
						<EditorFrame
							locale={locale}
							theme={mode}
							payload={{ ...payload, text: draft, path: file.path }}
							onChange={setDraft}
							onSave={() => void saveBoard(draftRef.current)}
						/>
					)}
				</View>
			) : (
				<ScrollView style={{ flex: 1 }}>
					{note ? (
						<Text style={{ color: colors.muted, padding: 12 }}>{note}</Text>
					) : null}
					{tree.length === 0 ? (
						<Text style={{ color: colors.muted, padding: 12 }}>
							{t("code.emptyTree")}
						</Text>
					) : (
						tree.map((node) => (
							<TreeRows
								key={node.path}
								node={node}
								depth={0}
								openDirs={openDirs}
								color={colors.text}
								onToggle={(path) =>
									setOpenDirs((current) => {
										const copy = new Set(current);
										if (copy.has(path)) {
											copy.delete(path);
										} else {
											copy.add(path);
										}
										return copy;
									})
								}
								onOpen={(path) => void openPath(path)}
							/>
						))
					)}
				</ScrollView>
			)}
		</View>
	);
}

function TreeRows({
	node,
	depth,
	openDirs,
	color,
	onToggle,
	onOpen,
}: {
	node: BoardFileNode;
	depth: number;
	openDirs: Set<string>;
	color: string;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
}) {
	const open = node.type === "dir" && openDirs.has(node.path);
	return (
		<View>
			<Pressable
				onPress={() =>
					node.type === "dir" ? onToggle(node.path) : onOpen(node.path)
				}
				style={{
					height: 28,
					justifyContent: "center",
					paddingLeft: 8 + depth * 14,
				}}
			>
				<Text style={{ color }} numberOfLines={1}>
					{node.type === "dir" ? (open ? "▾ " : "▸ ") : "  "}
					{node.name}
				</Text>
			</Pressable>
			{open
				? node.children.map((child) => (
						<TreeRows
							key={child.path}
							node={child}
							depth={depth + 1}
							openDirs={openDirs}
							color={color}
							onToggle={onToggle}
							onOpen={onOpen}
						/>
					))
				: null}
		</View>
	);
}

function EditorFrame({
	payload,
	locale,
	theme,
	onChange,
	onSave,
}: {
	payload: EditorEmbedPayload;
	locale: string;
	theme: string;
	onChange: (text: string) => void;
	onSave: () => void;
}) {
	const webRef = useRef<WebView>(null);
	const uri = editorEmbedUrl(dashboardUrl, { locale, theme });
	const script = editorEmbedInjectSource(payload);
	const scriptRef = useRef(script);
	scriptRef.current = script;

	function push() {
		webRef.current?.injectJavaScript(scriptRef.current);
	}

	useEffect(() => {
		webRef.current?.injectJavaScript(script);
	}, [script]);

	return (
		<WebView
			ref={webRef}
			source={{ uri }}
			style={{ flex: 1, backgroundColor: "transparent" }}
			javaScriptEnabled
			domStorageEnabled
			originWhitelist={["https://*"]}
			setSupportMultipleWindows={false}
			injectedJavaScript={script}
			injectedJavaScriptBeforeContentLoaded={script}
			onLoadEnd={push}
			onMessage={(event) => {
				try {
					const data = JSON.parse(event.nativeEvent.data) as unknown;
					if (
						data &&
						typeof data === "object" &&
						(data as { type?: string }).type === EDITOR_EMBED_READY_TYPE
					) {
						push();
						return;
					}
					if (isEditorEmbedSave(data)) {
						onSave();
						return;
					}
					const text = parseEditorEmbedChange(data);
					if (text != null) {
						onChange(text);
					}
				} catch {
					return;
				}
			}}
		/>
	);
}
