import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { boardAppDirFromPath } from "gpio-companion-app";
import {
	codeAttachFileName,
	codeAttachKind,
	codeComposerErrorKey,
	type ExplorerPick,
	explorerCreateDir,
	stageExplorerFile,
} from "gpio-companion-attach";
import {
	type BoardFileEntry,
	type BoardFileNode,
	BREADBOARD_DIAGRAM_JSON,
	boardFileApplyEvent,
	boardFileDirty,
	boardFileTree,
	boardImageDataUrl,
	type CodeEditorSelection,
	countBoardFiles,
	EDITOR_EMBED_MESSAGE_TYPE,
	EDITOR_EMBED_READY_TYPE,
	type EditorEmbedPayload,
	editorEmbedInjectSource,
	editorEmbedUrl,
	filterBoardNodes,
	isEditorEmbedSave,
	isMarkdownPath,
	isSvgPath,
	parseBoardFileEvent,
	parseEditorEmbedChange,
	parseEditorEmbedSelection,
} from "gpio-companion-files";
import { findSketchByName, sketchNameFromPath } from "gpio-companion-sketches";
import { useEffect, useRef, useState } from "react";
import {
	Alert,
	DeviceEventEmitter,
	Modal,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { WebView } from "react-native-webview";
import {
	listBoardFiles,
	loadAppStatus,
	loadBoardApps,
	loadFlashSketches,
	loadRun,
	loadRunSketches,
	pushProject,
	readBoardFile,
	removeBoardFile,
	renameBoardFile,
	signBoardFilesLive,
	startApp,
	startRun,
	stopApp,
	stopRun,
	uploadBoardFile,
	writeBoardFile,
} from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColorMode, useColors } from "../lib/color-mode.tsx";
import { dashboardUrl } from "../lib/config.ts";
import { useLocale, useT } from "../lib/locale.tsx";
import type { Colors } from "../lib/theme.ts";
import AppWebView from "./AppWebView.tsx";
import BreadboardWebView from "./BreadboardWebView.tsx";
import ModelWebView from "./ModelWebView.tsx";
import { MarkdownView } from "./OcMarkdown.tsx";
import SvgPreview from "./SvgPreview.tsx";
import ZoomableImage from "./ZoomableImage.tsx";

type Props = {
	token: string;
	uuid: string;
	owner: string;
	name: string;
	bridge?: { current: CodeFilesBridge };
	onFileStateChange?: (state: { dirty: boolean; stale: boolean }) => void;
	onEntries?: (entries: BoardFileEntry[]) => void;
	onAddContext?: (path: string, text: string) => void;
	onEditorSelection?: (
		path: string,
		selection: CodeEditorSelection | null,
	) => void;
	onContextRenamed?: (from: string, to: string) => void;
	onContextRemoved?: (path: string) => void;
};

type OpenFile = {
	path: string;
	kind: "text" | "model" | "image" | "binary";
	text: string;
	base64: string;
};

type SketchProbe = {
	kind: "run" | "flash" | null;
	phase: "loading" | "ready" | "unavailable";
	dir: string;
	running: boolean;
};

type AppProbe = {
	phase: "loading" | "ready" | "unavailable";
	dir: string;
	appId: string;
	running: boolean;
	otherRunning: boolean;
};

export type CodeFilesBridge = {
	openPath: (path: string) => Promise<void>;
	textFor: (path: string) => Promise<string>;
	openApp: (appId: string, title: string) => void;
	closeApp: () => void;
};

export default function ProjectFiles({
	token,
	uuid,
	owner,
	name,
	bridge,
	onFileStateChange,
	onEntries,
	onAddContext,
	onEditorSelection,
	onContextRenamed,
	onContextRemoved,
}: Props) {
	const t = useT();
	const colors = useColors();
	const { boards } = useUserBoards();
	const { setFlashSketch } = useBoardSelection();
	const boardModel =
		boards.find((board) => board.device.uuid === uuid)?.status?.model ?? null;
	const { locale } = useLocale();
	const { mode } = useColorMode();
	const [entries, setEntries] = useState<BoardFileEntry[]>([]);
	const [branch, setBranch] = useState("");
	const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
	const [file, setFile] = useState<OpenFile | null>(null);
	const [appView, setAppView] = useState<{
		appId: string;
		title: string;
	} | null>(null);
	const [draft, setDraft] = useState("");
	const [diagramView, setDiagramView] = useState<"json" | "board">("board");
	const [mdView, setMdView] = useState<"parsed" | "raw">("parsed");
	const [svgView, setSvgView] = useState<"preview" | "source">("preview");
	const [rev, setRev] = useState(0);
	const [stale, setStale] = useState(false);
	const [note, setNote] = useState("");
	const [saved, setSaved] = useState("");
	const [busy, setBusy] = useState("");
	const [fileFilter, setFileFilter] = useState("");
	const [fileMenu, setFileMenu] = useState<{
		path: string;
		x: number;
		y: number;
	} | null>(null);
	const [sketchProbe, setSketchProbe] = useState<SketchProbe | null>(null);
	const sketchActionId = useRef(0);
	const [appProbe, setAppProbe] = useState<AppProbe | null>(null);
	const appProbeId = useRef(0);
	const [picked, _setPicked] = useState<ExplorerPick | null>(null);
	const [creating, setCreating] = useState<string | null>(null);
	const [renaming, setRenaming] = useState("");
	const [nameDraft, setNameDraft] = useState("");
	const [fileLoading, setFileLoading] = useState(false);
	const echo = useRef("");
	const fileRef = useRef(file);
	const draftRef = useRef(draft);
	const openPathRef = useRef<(path: string) => Promise<void>>(async () => {});
	const openAppRef = useRef<(appId: string, title: string) => void>(() => {});
	const closeAppRef = useRef<() => void>(() => {});
	const openedPath = useRef("");
	const editorSelectionRef = useRef(onEditorSelection);
	editorSelectionRef.current = onEditorSelection;
	fileRef.current = file;
	draftRef.current = draft;
	const dirty = boardFileDirty(file?.kind ?? "", draft, file?.text ?? "");
	const showBoard =
		file?.path === BREADBOARD_DIAGRAM_JSON && diagramView === "board";
	const tree = boardFileTree(entries);
	const visibleTree = fileFilter.trim()
		? filterBoardNodes(tree, fileFilter)
		: tree;
	const fileCount = countBoardFiles(entries);

	useEffect(() => {
		onFileStateChange?.({ dirty, stale });
	}, [dirty, stale, onFileStateChange]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the board or project changes
	useEffect(() => {
		setFile(null);
		setDraft("");
		setStale(false);
		setNote("");
		setSaved("");
		setEntries([]);
		setBranch("");
		setOpenDirs(new Set());
		setFileFilter("");
		setDiagramView("board");
		setMdView("parsed");
		openedPath.current = "";
	}, [uuid, name]);

	useEffect(() => {
		onEntries?.(entries);
	}, [entries, onEntries]);

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
						if (current) {
							editorSelectionRef.current?.(current.path, null);
						}
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

	async function doOpen(path: string) {
		if (!token || !uuid || !name) {
			return;
		}
		setFileLoading(true);
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
			setAppView(null);
			if (openedPath.current !== path) {
				openedPath.current = path;
				setDiagramView(path === BREADBOARD_DIAGRAM_JSON ? "board" : "json");
				setMdView(isMarkdownPath(path) ? "parsed" : "raw");
				setSvgView(isSvgPath(path) ? "preview" : "source");
			}
			setRev((value) => value + 1);
			setStale(false);
			setNote("");
			setSaved("");
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
			setSaved("");
		}
		setFileLoading(false);
	}

	function confirmDiscard(onConfirm: () => void) {
		Alert.alert(t("code.discardConfirm"), "", [
			{ text: t("common.close"), style: "cancel" },
			{
				text: t("code.reloadFile"),
				style: "destructive",
				onPress: onConfirm,
			},
		]);
	}

	async function openPath(path: string) {
		if (!token || !uuid || !name) {
			return;
		}
		const current = fileRef.current;
		if (
			current &&
			current.path !== path &&
			boardFileDirty(current.kind, draftRef.current, current.text)
		) {
			confirmDiscard(() => {
				if (current.path !== path) {
					editorSelectionRef.current?.(current.path, null);
				}
				void doOpen(path);
			});
			return;
		}
		if (current && current.path !== path) {
			editorSelectionRef.current?.(current.path, null);
		}
		await doOpen(path);
	}
	openPathRef.current = openPath;

	function openApp(appId: string, title: string) {
		if (!token || !uuid || !appId) {
			return;
		}
		const current = fileRef.current;
		if (
			current &&
			boardFileDirty(current.kind, draftRef.current, current.text)
		) {
			confirmDiscard(() => {
				editorSelectionRef.current?.(current.path, null);
				setFile(null);
				setDraft("");
				setAppView({ appId, title: title || appId });
			});
			return;
		}
		if (current) {
			editorSelectionRef.current?.(current.path, null);
		}
		setFile(null);
		setDraft("");
		setAppView({ appId, title: title || appId });
	}

	function closeApp() {
		setAppView(null);
	}
	openAppRef.current = openApp;
	closeAppRef.current = closeApp;

	if (bridge) {
		bridge.current.openPath = (path: string) => openPathRef.current(path);
		bridge.current.textFor = textFor;
		bridge.current.openApp = (appId: string, title: string) =>
			openAppRef.current(appId, title);
		bridge.current.closeApp = () => closeAppRef.current();
	}

	function reloadStale() {
		const current = fileRef.current;
		if (!current) {
			return;
		}
		if (boardFileDirty(current.kind, draftRef.current, current.text)) {
			confirmDiscard(() => void doOpen(current.path));
			return;
		}
		void doOpen(current.path);
	}

	function shownError(message: string): string {
		const key = codeComposerErrorKey(message);
		if (key === "fileTooLarge") {
			return t("code.fileTooLarge");
		}
		if (key === "fileType") {
			return t("code.fileType");
		}
		if (key === "updateCompanion" || message.includes("404")) {
			return t("code.updateCompanion");
		}
		return message;
	}

	async function importBytes(
		dir: string,
		list: { name: string; bytes: Uint8Array }[],
	) {
		if (!token || !uuid || !name || list.length === 0) {
			return;
		}
		setBusy("drop");
		setNote("");
		const taken = entries
			.filter((item) => item.type === "file")
			.map((item) => item.path);
		try {
			for (const file of list) {
				const staged = stageExplorerFile({
					dir,
					filename: file.name,
					bytes: file.bytes,
					taken,
				});
				taken.push(staged.path);
				await uploadBoardFile(token, uuid, name, staged.path, {
					...(staged.base64
						? { base64: staged.base64 }
						: { text: staged.text ?? "" }),
				});
			}
			const listed = await listBoardFiles(token, uuid, name);
			setEntries(listed.entries);
			setBranch(listed.branch);
			if (dir) {
				setOpenDirs((current) => new Set(current).add(dir));
			}
			setSaved(t("code.dropped", { n: list.length }));
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function reloadFiles() {
		if (!token || !uuid || !name) {
			return;
		}
		const listed = await listBoardFiles(token, uuid, name);
		setEntries(listed.entries);
		setBranch(listed.branch);
		setNote("");
	}

	function reveal(dir: string) {
		if (!dir) {
			return;
		}
		setOpenDirs((current) => {
			const copy = new Set(current);
			let acc = "";
			for (const part of dir.split("/")) {
				acc = acc ? `${acc}/${part}` : part;
				copy.add(acc);
			}
			return copy;
		});
	}

	function startCreate() {
		const dir =
			explorerCreateDir(picked) || (file?.path ? parentDir(file.path) : "");
		setRenaming("");
		setCreating(dir);
		setNameDraft("untitled.txt");
		reveal(dir);
	}

	function startRename(path?: string) {
		const target =
			typeof path === "string" && path
				? path
				: picked?.path || file?.path || "";
		if (!target) {
			return;
		}
		setCreating(null);
		setFileMenu(null);
		setRenaming(target);
		setNameDraft(target.split("/").pop() ?? target);
		reveal(parentDir(target));
	}

	async function textFor(path: string) {
		if (fileRef.current?.path === path && fileRef.current.kind === "text") {
			return draftRef.current;
		}
		const data = await readBoardFile(token, uuid, name, path);
		if (data.kind !== "text" || typeof data.text !== "string") {
			throw new Error("context file must be text");
		}
		return data.text;
	}

	async function addToContext(path: string) {
		setFileMenu(null);
		try {
			onAddContext?.(path, await textFor(path));
		} catch (caught) {
			setNote(shownError(caught instanceof Error ? caught.message : ""));
			setSaved("");
		}
	}

	function openFileMenu(path: string, x: number, y: number) {
		setFileMenu({ path, x, y });
		const appDir = boardAppDirFromPath(path);
		if (appDir) {
			setSketchProbe({
				kind: null,
				phase: "unavailable",
				dir: "",
				running: false,
			});
			const id = ++appProbeId.current;
			setAppProbe({
				phase: "loading",
				dir: appDir,
				appId: "",
				running: false,
				otherRunning: false,
			});
			void loadAppProbe(id, appDir);
			return;
		}
		const id = ++sketchActionId.current;
		const runName = sketchNameFromPath("host", path);
		const flashName = sketchNameFromPath("firmware", path);
		if (!runName && !flashName) {
			setSketchProbe({
				kind: null,
				phase: "unavailable",
				dir: "",
				running: false,
			});
			return;
		}
		const kind = runName ? "run" : "flash";
		setSketchProbe({ kind, phase: "loading", dir: "", running: false });
		void loadSketchProbe(id, kind, runName ?? flashName ?? "");
	}

	async function loadSketchProbe(
		id: number,
		kind: "run" | "flash",
		sketchName: string,
	) {
		if (!token || !uuid) {
			if (sketchActionId.current === id) {
				setSketchProbe({
					kind,
					phase: "unavailable",
					dir: "",
					running: false,
				});
			}
			return;
		}
		try {
			const list = await (kind === "run"
				? loadRunSketches(token, uuid)
				: loadFlashSketches(token, uuid));
			if (sketchActionId.current !== id) {
				return;
			}
			const sketch = findSketchByName(list.sketches, name, sketchName);
			if (!sketch) {
				setSketchProbe({
					kind,
					phase: "unavailable",
					dir: "",
					running: false,
				});
				return;
			}
			const running =
				kind === "run" ? (await loadRun(token, uuid)).running : false;
			if (sketchActionId.current !== id) {
				return;
			}
			setSketchProbe({ kind, phase: "ready", dir: sketch.dir, running });
		} catch {
			if (sketchActionId.current === id) {
				setSketchProbe({
					kind,
					phase: "unavailable",
					dir: "",
					running: false,
				});
			}
		}
	}

	async function startSketch(dir: string) {
		setFileMenu(null);
		if (!token || !uuid) {
			return;
		}
		setBusy("sketch");
		try {
			await startRun(token, { uuid, dir });
			setNote("");
			setSaved(t("code.sketchStarted"));
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function stopSketch() {
		setFileMenu(null);
		if (!token || !uuid) {
			return;
		}
		setBusy("sketch");
		try {
			await stopRun(token, uuid);
			setNote("");
			setSaved(t("code.sketchStopped"));
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function loadAppProbe(id: number, dir: string) {
		const unavailable: AppProbe = {
			phase: "unavailable",
			dir: "",
			appId: "",
			running: false,
			otherRunning: false,
		};
		if (!token || !uuid) {
			if (appProbeId.current === id) {
				setAppProbe(unavailable);
			}
			return;
		}
		try {
			const [listed, status] = await Promise.all([
				loadBoardApps(token, uuid).catch(() => null),
				loadAppStatus(token, uuid).catch(() => null),
			]);
			if (appProbeId.current !== id) {
				return;
			}
			const entry =
				listed?.apps.find(
					(item) => item.project === name && item.dir === dir,
				) ?? null;
			if (!entry) {
				setAppProbe(unavailable);
				return;
			}
			const runningName = status?.running && status.name ? status.name : "";
			setAppProbe({
				phase: "ready",
				dir,
				appId: entry.name,
				running: runningName === entry.name,
				otherRunning: Boolean(runningName) && runningName !== entry.name,
			});
		} catch {
			if (appProbeId.current === id) {
				setAppProbe(unavailable);
			}
		}
	}

	function closeAppMenu() {
		setFileMenu(null);
	}

	async function startBoardApp(dir: string, appId: string) {
		closeAppMenu();
		if (!token || !uuid || !name) {
			return;
		}
		setBusy("app");
		try {
			await startApp(token, { uuid, repo: name, dir });
			setNote("");
			setSaved(t("code.appStartedNote"));
			if (appId) {
				openApp(appId, appId);
			}
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function stopBoardApp() {
		closeAppMenu();
		if (!token || !uuid) {
			return;
		}
		setBusy("app");
		try {
			await stopApp(token, uuid);
			setNote("");
			setSaved(t("code.appStoppedNote"));
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	function openAppFullscreen(appId: string) {
		closeAppMenu();
		if (!appId) {
			return;
		}
		DeviceEventEmitter.emit("gpio-ui-app-page", { appId, title: appId });
	}

	function flashSketchFromMenu(dir: string) {
		setFileMenu(null);
		setFlashSketch({ dir, project: name, autoStart: true });
		router.push("/project");
	}

	function deleteFile(path: string) {
		setFileMenu(null);
		if (!uuid || !name) {
			return;
		}
		const label = path.split("/").pop() ?? path;
		Alert.alert(
			t("code.deleteFile"),
			t("code.deleteFileConfirm", { name: label }),
			[
				{ text: t("common.close"), style: "cancel" },
				{
					text: t("code.deleteFile"),
					style: "destructive",
					onPress: () => {
						void confirmDelete(path, label);
					},
				},
			],
		);
	}

	async function confirmDelete(path: string, label: string) {
		if (!token || !uuid || !name) {
			return;
		}
		setBusy("file");
		try {
			await removeBoardFile(token, uuid, name, path);
			if (fileRef.current?.path === path) {
				setFile(null);
				setDraft("");
				openedPath.current = "";
			}
			onContextRemoved?.(path);
			await reloadFiles();
			setNote("");
			setSaved(t("code.deletedFile", { name: label }));
		} catch (caught) {
			setSaved("");
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function commitName() {
		if (!token || !uuid || !name) {
			return;
		}
		const draft = nameDraft.trim();
		if (!draft) {
			setCreating(null);
			setRenaming("");
			return;
		}
		setBusy("file");
		try {
			const filename = codeAttachFileName(draft);
			if (codeAttachKind(filename) !== "text") {
				throw new Error("file type is not allowed");
			}
			if (renaming) {
				const dir = parentDir(renaming);
				const to = dir ? `${dir}/${filename}` : filename;
				if (to !== renaming) {
					const renamed = await renameBoardFile(
						token,
						uuid,
						name,
						renaming,
						to,
					);
					if (file?.path === renaming) {
						setFile({ ...file, path: renamed.path });
					}
					onContextRenamed?.(renaming, renamed.path);
				}
			} else if (creating !== null) {
				const path = creating ? `${creating}/${filename}` : filename;
				await writeBoardFile(token, uuid, name, path, "");
				await openPath(path);
			}
			setCreating(null);
			setRenaming("");
			await reloadFiles();
		} catch (caught) {
			setNote(shownError(caught instanceof Error ? caught.message : ""));
		} finally {
			setBusy("");
		}
	}

	async function pickInto(dir: string) {
		const picked = await DocumentPicker.getDocumentAsync({
			multiple: true,
			copyToCacheDirectory: true,
		});
		if (picked.canceled) {
			return;
		}
		const list = [];
		for (const asset of picked.assets) {
			list.push({
				name: asset.name,
				bytes: new Uint8Array(await new File(asset.uri).arrayBuffer()),
			});
		}
		await importBytes(dir, list);
	}

	async function saveBoard(text = draft) {
		if (file?.kind !== "text" || !token || !uuid || !name || busy) {
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
			setSaved(t("code.savedBoard"));
		} catch (caught) {
			setNote(caught instanceof Error ? caught.message : "request failed");
			setSaved("");
		}
		setBusy("");
	}

	async function saveGithub() {
		if (!token || !uuid || !owner || !name || busy) {
			return;
		}
		setBusy("github");
		try {
			const result = await pushProject(token, { uuid, owner, name });
			const pushed = result.board.branch || branch;
			if (pushed) {
				setBranch(pushed);
			}
			setNote("");
			setSaved(t("code.savedGithub").replace("{branch}", pushed || name));
		} catch (caught) {
			setNote(caught instanceof Error ? caught.message : "request failed");
			setSaved("");
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

	const menuAppDir = fileMenu ? boardAppDirFromPath(fileMenu.path) : null;
	const menuAppProbe =
		appProbe &&
		menuAppDir &&
		appProbe.phase === "ready" &&
		appProbe.dir === menuAppDir
			? appProbe
			: null;

	return (
		<View style={{ flex: 1 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					flexWrap: "wrap",
					rowGap: 4,
					columnGap: 4,
					paddingHorizontal: 8,
					paddingVertical: 8,
					borderBottomWidth: 1,
					borderBottomColor: colors.chipBg,
				}}
			>
				<Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>
					{name || t("code.files")}
					{branch ? `  ${branch}` : ""}
					{fileCount > 0 ? `  ${t("code.filesCount", { n: fileCount })}` : ""}
				</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t("code.newFile")}
					disabled={!token || !uuid || !name || busy === "file"}
					onPress={startCreate}
					style={{
						minWidth: 40,
						minHeight: 40,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text style={{ color: colors.text, fontSize: 18 }}>+</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t("code.renameFile")}
					disabled={!(picked?.path || file?.path) || busy === "file"}
					onPress={() => startRename()}
					style={{
						minWidth: 40,
						minHeight: 40,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text style={{ color: colors.text, fontSize: 12 }}>A</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t("code.refreshFiles")}
					disabled={!token || !uuid || !name}
					onPress={() => void reloadFiles()}
					style={{
						minWidth: 40,
						minHeight: 40,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text style={{ color: colors.text, fontSize: 16 }}>↻</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t("code.dropRoot")}
					disabled={!token || !uuid || !name || busy === "drop"}
					onPress={() => void pickInto("")}
					style={{
						minWidth: 40,
						minHeight: 40,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text style={{ color: colors.primary, fontWeight: "600" }}>+</Text>
				</Pressable>
				<Pressable
					disabled={!token || !uuid || !owner || !name || busy === "github"}
					onPress={() => void saveGithub()}
					style={{ minHeight: 40, justifyContent: "center" }}
				>
					<Text style={{ color: colors.primary, fontWeight: "600" }}>
						{busy === "github" ? t("code.savingGithub") : t("code.saveGithub")}
					</Text>
				</Pressable>
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 12,
					paddingVertical: 6,
				}}
			>
				<TextInput
					value={fileFilter}
					placeholder={t("code.filterFiles")}
					placeholderTextColor={colors.placeholder}
					onChangeText={setFileFilter}
					style={{
						flex: 1,
						height: 32,
						borderRadius: 6,
						paddingHorizontal: 10,
						color: colors.text,
						backgroundColor: colors.chipBg,
					}}
				/>
				{fileFilter ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("code.clear")}
						onPress={() => setFileFilter("")}
					>
						<Text style={{ color: colors.primary, fontWeight: "600" }}>
							{t("code.clear")}
						</Text>
					</Pressable>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("code.collapseAll")}
						disabled={openDirs.size === 0}
						onPress={() => setOpenDirs(new Set())}
					>
						<Text style={{ color: colors.primary, fontWeight: "600" }}>
							{t("code.collapseAll")}
						</Text>
					</Pressable>
				)}
			</View>
			{note ? (
				<Text style={{ color: colors.danger, paddingHorizontal: 12 }}>
					{note}
				</Text>
			) : null}
			{saved ? (
				<Text style={{ color: colors.primary, paddingHorizontal: 12 }}>
					{saved}
				</Text>
			) : null}
			{appView ? (
				<View style={{ flex: 1, minHeight: 320 }}>
					<AppWebView
						token={token}
						uuid={uuid}
						appId={appView.appId}
						title={appView.title}
						onClose={closeApp}
					/>
				</View>
			) : file ? (
				<View style={{ flex: 1, minHeight: 320 }}>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							flexWrap: "wrap",
							rowGap: 4,
							columnGap: 8,
							paddingHorizontal: 8,
							paddingVertical: 6,
						}}
					>
						<Pressable
							onPress={() => setFile(null)}
							style={{ minHeight: 40, justifyContent: "center" }}
						>
							<Text style={{ color: colors.primary }}>{t("code.files")}</Text>
						</Pressable>
						<Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
							{file.path}
							{dirty ? " ●" : ""}
						</Text>
						{stale ? (
							<Pressable
								onPress={reloadStale}
								style={{ minHeight: 40, justifyContent: "center" }}
							>
								{" "}
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
						{file.kind === "text" && isMarkdownPath(file.path) ? (
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Pressable onPress={() => setMdView("parsed")}>
									<Text
										style={{
											color:
												mdView === "parsed" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.viewParsed")}
									</Text>
								</Pressable>
								<Pressable onPress={() => setMdView("raw")}>
									<Text
										style={{
											color: mdView === "raw" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.viewRaw")}
									</Text>
								</Pressable>
							</View>
						) : null}
						{file.kind === "text" && isSvgPath(file.path) ? (
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Pressable onPress={() => setSvgView("preview")}>
									<Text
										style={{
											color:
												svgView === "preview" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.preview")}
									</Text>
								</Pressable>
								<Pressable onPress={() => setSvgView("source")}>
									<Text
										style={{
											color:
												svgView === "source" ? colors.primary : colors.muted,
											fontWeight: "600",
										}}
									>
										{t("code.viewSource")}
									</Text>
								</Pressable>
							</View>
						) : null}
						{file.kind === "text" ? (
							<Pressable
								disabled={!dirty || busy === "board"}
								onPress={() => void saveBoard()}
								style={{ minHeight: 40, justifyContent: "center" }}
							>
								<Text style={{ color: colors.primary, fontWeight: "600" }}>
									{busy === "board"
										? t("code.savingBoard")
										: t("code.saveBoard")}
								</Text>
							</Pressable>
						) : null}
					</View>
					{fileLoading ? (
						<Text style={{ color: colors.muted, padding: 12 }}>
							{t("code.loadingFile")}
						</Text>
					) : showBoard ? (
						<View style={{ flex: 1, minHeight: 0 }}>
							<BreadboardWebView
								diagramText={draft}
								boardModel={boardModel}
								fill
							/>
						</View>
					) : file.kind === "model" ? (
						<ModelWebView glbBase64={file.base64} />
					) : file.kind === "image" ? (
						<ScrollView
							style={{ flex: 1 }}
							contentContainerStyle={{ padding: 12 }}
						>
							<ZoomableImage
								uri={boardImageDataUrl(file.base64, file.path)}
								title={file.path}
								height={320}
							/>
						</ScrollView>
					) : file.kind === "binary" ? (
						<Text style={{ color: colors.muted, padding: 12 }}>
							{t("code.binary")}
						</Text>
					) : file.kind === "text" &&
						isMarkdownPath(file.path) &&
						mdView === "parsed" ? (
						<ScrollView
							style={{ flex: 1 }}
							contentContainerStyle={{ padding: 12 }}
						>
							<MarkdownView text={draft} color={colors.text} />
						</ScrollView>
					) : file.kind === "text" &&
						isSvgPath(file.path) &&
						svgView === "preview" ? (
						<SvgPreview text={draft} />
					) : (
						<EditorFrame
							locale={locale}
							theme={mode}
							payload={{ ...payload, text: draft, path: file.path }}
							onChange={setDraft}
							onSave={() => void saveBoard(draftRef.current)}
							onSelection={(path, selection) =>
								editorSelectionRef.current?.(path, selection)
							}
						/>
					)}
				</View>
			) : (
				<ScrollView style={{ flex: 1 }}>
					{creating === "" ? (
						<TextInput
							value={nameDraft}
							autoFocus
							accessibilityLabel={t("code.fileName")}
							onChangeText={setNameDraft}
							onSubmitEditing={() => void commitName()}
							style={{ color: colors.text, padding: 8 }}
						/>
					) : null}
					{visibleTree.length === 0 ? (
						<Text style={{ color: colors.muted, padding: 12 }}>
							{fileFilter.trim() ? t("code.searchEmpty") : t("code.emptyTree")}
						</Text>
					) : (
						visibleTree.map((node) => (
							<TreeRows
								key={node.path}
								node={node}
								depth={0}
								openDirs={
									fileFilter.trim() ? openAllDirs(visibleTree) : openDirs
								}
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
								onAdd={(dir) => void pickInto(dir)}
								creating={creating}
								renaming={renaming}
								nameDraft={nameDraft}
								onName={setNameDraft}
								onCommit={() => void commitName()}
								onFileMenu={openFileMenu}
							/>
						))
					)}
				</ScrollView>
			)}
			<Modal
				visible={fileMenu !== null}
				transparent
				animationType="fade"
				onRequestClose={() => setFileMenu(null)}
			>
				<View style={{ flex: 1 }}>
					<Pressable style={{ flex: 1 }} onPress={() => setFileMenu(null)} />
					{fileMenu ? (
						<View
							style={{
								position: "absolute",
								left: Math.max(8, fileMenu.x),
								top: Math.max(8, fileMenu.y),
								minWidth: 180,
								borderRadius: 10,
								padding: 4,
								backgroundColor: colors.surface,
								borderWidth: 1,
								borderColor: colors.border,
							}}
						>
							{menuAppDir ? (
								<>
									<MenuRow
										label={t("code.appStart")}
										icon="play-arrow"
										colors={colors}
										disabled={
											!menuAppProbe ||
											busy === "app" ||
											menuAppProbe.running ||
											menuAppProbe.otherRunning
										}
										onPress={() => {
											if (!menuAppProbe) {
												return;
											}
											void startBoardApp(menuAppDir, menuAppProbe.appId);
										}}
									/>
									<MenuRow
										label={t("code.appStop")}
										icon="stop"
										colors={colors}
										disabled={!menuAppProbe?.running || busy === "app"}
										onPress={() => {
											if (!menuAppProbe?.running) {
												return;
											}
											void stopBoardApp();
										}}
									/>
									<View
										role="separator"
										style={{
											height: 1,
											marginVertical: 4,
											marginHorizontal: 8,
											backgroundColor: colors.border,
										}}
									/>
									<MenuRow
										label={t("code.appOpenPreview")}
										icon="picture-in-picture"
										colors={colors}
										disabled={!menuAppProbe?.running}
										onPress={() => {
											if (!menuAppProbe) {
												return;
											}
											closeAppMenu();
											openApp(menuAppProbe.appId, menuAppProbe.appId);
										}}
									/>
									<MenuRow
										label={t("code.appOpenFullscreen")}
										icon="fullscreen"
										colors={colors}
										disabled={!menuAppProbe?.running}
										onPress={() => {
											if (!menuAppProbe) {
												return;
											}
											openAppFullscreen(menuAppProbe.appId);
										}}
									/>
								</>
							) : (
								<>
									<MenuRow
										label={
											sketchProbe?.kind === "run" && sketchProbe.running
												? t("code.stopSketch")
												: t("code.runSketch")
										}
										icon={
											sketchProbe?.kind === "run" && sketchProbe.running
												? "stop"
												: "play-arrow"
										}
										colors={colors}
										disabled={
											sketchProbe?.kind !== "run" ||
											sketchProbe.phase !== "ready"
										}
										onPress={() => {
											if (
												sketchProbe?.kind !== "run" ||
												sketchProbe.phase !== "ready"
											) {
												return;
											}
											if (sketchProbe.running) {
												void stopSketch();
											} else {
												void startSketch(sketchProbe.dir);
											}
										}}
									/>
									<MenuRow
										label={t("code.flashSketch")}
										icon="bolt"
										colors={colors}
										disabled={
											sketchProbe?.kind !== "flash" ||
											sketchProbe.phase !== "ready"
										}
										onPress={() => {
											if (
												sketchProbe?.kind !== "flash" ||
												sketchProbe.phase !== "ready"
											) {
												return;
											}
											flashSketchFromMenu(sketchProbe.dir);
										}}
									/>
									<MenuRow
										label={t("code.addToContext")}
										icon="playlist-add"
										colors={colors}
										onPress={() => void addToContext(fileMenu.path)}
									/>
									<MenuRow
										label={t("code.renameFile")}
										icon="edit"
										colors={colors}
										onPress={() => startRename(fileMenu.path)}
									/>
									<View
										role="separator"
										style={{
											height: 1,
											marginVertical: 4,
											marginHorizontal: 8,
											backgroundColor: colors.border,
										}}
									/>
									<MenuRow
										label={t("code.deleteFile")}
										icon="delete-outline"
										danger
										colors={colors}
										onPress={() => deleteFile(fileMenu.path)}
									/>
								</>
							)}
						</View>
					) : null}
				</View>
			</Modal>
		</View>
	);
}

function MenuRow({
	label,
	icon,
	danger,
	disabled,
	colors,
	onPress,
}: {
	label: string;
	icon: React.ComponentProps<typeof MaterialIcons>["name"];
	danger?: boolean;
	disabled?: boolean;
	colors: Colors;
	onPress: () => void;
}) {
	const color = disabled ? colors.border : danger ? colors.danger : colors.text;
	return (
		<Pressable
			accessibilityRole="button"
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 12,
				padding: 10,
				borderRadius: 6,
				opacity: disabled ? 0.45 : 1,
				backgroundColor: pressed && !disabled ? colors.border : "transparent",
			})}
		>
			<Text style={{ flex: 1, color }}>{label}</Text>
			<MaterialIcons name={icon} size={18} color={color} />
		</Pressable>
	);
}

function parentDir(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

function openAllDirs(nodes: readonly BoardFileNode[]): Set<string> {
	const out = new Set<string>();
	const walk = (items: readonly BoardFileNode[]) => {
		for (const item of items) {
			if (item.type === "dir") {
				out.add(item.path);
				walk(item.children);
			}
		}
	};
	walk(nodes);
	return out;
}

function TreeRows({
	node,
	depth,
	openDirs,
	color,
	onToggle,
	onOpen,
	onAdd,
	creating,
	renaming,
	nameDraft,
	onName,
	onCommit,
	onFileMenu,
}: {
	node: BoardFileNode;
	depth: number;
	openDirs: Set<string>;
	color: string;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
	onAdd: (dir: string) => void;
	creating: string | null;
	renaming: string;
	nameDraft: string;
	onName: (value: string) => void;
	onCommit: () => void;
	onFileMenu: (path: string, x: number, y: number) => void;
}) {
	const t = useT();
	const open = node.type === "dir" && openDirs.has(node.path);
	const appDir = node.type === "dir" ? boardAppDirFromPath(node.path) : null;
	return (
		<View>
			<View
				style={{
					minHeight: 44,
					flexDirection: "row",
					alignItems: "center",
					paddingLeft: 8 + depth * 14,
				}}
			>
				<Pressable
					onPress={() =>
						node.type === "dir" ? onToggle(node.path) : onOpen(node.path)
					}
					delayLongPress={500}
					onLongPress={(event) => {
						if (node.type === "dir" && !appDir) {
							return;
						}
						onFileMenu(
							node.path,
							event.nativeEvent.pageX,
							event.nativeEvent.pageY,
						);
					}}
					style={{
						flex: 1,
						alignSelf: "stretch",
						justifyContent: "center",
					}}
				>
					{renaming === node.path ? (
						<TextInput
							value={nameDraft}
							autoFocus
							onChangeText={onName}
							onSubmitEditing={onCommit}
							style={{ color, padding: 0 }}
						/>
					) : (
						<Text style={{ color }} numberOfLines={1}>
							{node.type === "dir" ? (open ? "▾ " : "▸ ") : "  "}
							{node.name}
						</Text>
					)}
				</Pressable>
				{node.type === "dir" ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("code.dropFolder", { name: node.name })}
						onPress={() => onAdd(node.path)}
						style={{
							minWidth: 44,
							minHeight: 44,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Text style={{ color }}>+</Text>
					</Pressable>
				) : null}
			</View>
			{open && creating === node.path ? (
				<TextInput
					value={nameDraft}
					autoFocus
					onChangeText={onName}
					onSubmitEditing={onCommit}
					style={{ color, paddingLeft: 8 + (depth + 1) * 14 }}
				/>
			) : null}
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
							onAdd={onAdd}
							creating={creating}
							renaming={renaming}
							nameDraft={nameDraft}
							onName={onName}
							onCommit={onCommit}
							onFileMenu={onFileMenu}
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
	onSelection,
}: {
	payload: EditorEmbedPayload;
	locale: string;
	theme: string;
	onChange: (text: string) => void;
	onSave: () => void;
	onSelection: (path: string, selection: CodeEditorSelection | null) => void;
}) {
	const webRef = useRef<WebView>(null);
	const t = useT();
	const colors = useColors();
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
			startInLoadingState
			renderLoading={() => (
				<View
					style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
				>
					<Text style={{ color: colors.muted }}>{t("code.loading")}</Text>
				</View>
			)}
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
					const selection = parseEditorEmbedSelection(data);
					if (selection !== undefined) {
						if (payload.path) {
							onSelection(payload.path, selection);
						}
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
