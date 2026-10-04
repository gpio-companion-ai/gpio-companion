import { BREADBOARD_DIAGRAM_JSON } from "gpio-companion";
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
	boardFileApplyEvent,
	boardFileDirty,
	boardFileLanguage,
	boardFileTree,
	boardImageDataUrl,
	type CodeEditorSelection,
	clampSplitPercent,
	countBoardFiles,
	filterBoardNodes,
	isMarkdownPath,
	isSvgPath,
	OC_EDITOR_SPLIT_KEY,
	parseBoardFileEvent,
	svgDataUrl,
} from "gpio-companion-files";
import { findSketchByName, sketchNameFromPath } from "gpio-companion-sketches";
import {
	Fragment,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
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
} from "../api";
import { useColorMode } from "../color-mode";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import useMobile from "../hooks/useMobile";
import { useT } from "../locale";
import AppFrame from "./AppFrame";
import BreadboardViewer from "./BreadboardViewer";
import ModelViewer from "./ModelViewer";
import { MarkdownView } from "./OcMarkdown";

export type CodeFilesBridge = {
	textFor: (path: string) => Promise<string>;
	openPath: (path: string) => Promise<void>;
	openApp: (appId: string, title: string) => void;
	closeApp: () => void;
};

type FileMenu = {
	path: string;
	x: number;
	y: number;
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

type ContextMenuItem = {
	key: string;
	label: string;
	danger?: boolean;
	disabled?: boolean;
	separatorBefore?: boolean;
	icon: ReactNode;
	onSelect: () => void;
};

type Props = {
	uuid: string;
	owner: string;
	name: string;
	children: ReactNode;
	bridge?: { current: CodeFilesBridge };
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

export default function ProjectFiles({
	uuid,
	owner,
	name,
	children,
	bridge,
	onEntries,
	onAddContext,
	onEditorSelection,
	onContextRenamed,
	onContextRemoved,
}: Props) {
	const t = useT();
	const { mode } = useColorMode();
	const mobile = useMobile();
	type MobilePane = "chat" | "files" | "preview";
	const [mobilePane, setMobilePane] = useState<MobilePane>("chat");
	const { boards } = useUserBoards();
	const { requestAction, setFlashSketch } = useBoardSelection();
	const boardModel =
		boards.find((board) => board.device.uuid === uuid)?.status?.model ?? null;
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
	const [stale, setStale] = useState(false);
	const [note, setNote] = useState("");
	const [saved, setSaved] = useState("");
	const [busy, setBusy] = useState("");
	const [fileFilter, setFileFilter] = useState("");
	const [fileMenu, setFileMenu] = useState<FileMenu | null>(null);
	const fileMenuRef = useRef<HTMLDivElement | null>(null);
	const [sketchProbe, setSketchProbe] = useState<SketchProbe | null>(null);
	const sketchActionId = useRef(0);
	const [appProbe, setAppProbe] = useState<AppProbe | null>(null);
	const appProbeId = useRef(0);
	const [dropDir, setDropDir] = useState<string | null>(null);
	const [picked, setPicked] = useState<ExplorerPick | null>(null);
	const [creating, setCreating] = useState<string | null>(null);
	const [renaming, setRenaming] = useState("");
	const [nameDraft, setNameDraft] = useState("");
	const [fileLoading, setFileLoading] = useState(false);
	const echo = useRef("");
	const fileRef = useRef(file);
	const draftRef = useRef(draft);
	const mobileRef = useRef(mobile);
	const stageRef = useRef<HTMLDivElement>(null);
	const editorSelectionRef = useRef(onEditorSelection);
	editorSelectionRef.current = onEditorSelection;
	const openPathRef = useRef<(path: string) => Promise<void>>(async () => {});
	const openAppRef = useRef<(appId: string, title: string) => void>(() => {});
	const closeAppRef = useRef<() => void>(() => {});
	const openedPath = useRef("");
	fileRef.current = file;
	draftRef.current = draft;
	mobileRef.current = mobile;
	const dirty = boardFileDirty(file?.kind ?? "", draft, file?.text ?? "");
	const showBoard =
		file?.path === BREADBOARD_DIAGRAM_JSON && diagramView === "board";
	const tree = boardFileTree(entries);
	const visibleTree = fileFilter.trim()
		? filterBoardNodes(tree, fileFilter)
		: tree;
	const fileCount = countBoardFiles(entries);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the board or project changes
	useEffect(() => {
		const current = fileRef.current;
		if (current && draftRef.current !== current.text) {
			if (!window.confirm(t("code.discardConfirm"))) {
				return;
			}
		}
		setFile(null);
		setDraft("");
		setAppView(null);
		setStale(false);
		setNote("");
		setSaved("");
		setMobilePane("chat");
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
		if (!fileMenu) {
			return;
		}
		function onPointer(event: PointerEvent) {
			if (
				fileMenuRef.current &&
				!fileMenuRef.current.contains(event.target as Node)
			) {
				setFileMenu(null);
			}
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setFileMenu(null);
			}
		}
		function onScroll() {
			setFileMenu(null);
		}
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [fileMenu]);

	useEffect(() => {
		if (!uuid || !name) {
			return;
		}
		let closed = false;
		void listBoardFiles(uuid, name)
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
	}, [uuid, name]);

	useEffect(() => {
		if (!uuid || !name) {
			return;
		}
		let closed = false;
		let socket: WebSocket | null = null;
		let timer = 0;
		let delay = 500;
		let refresh = 0;

		function scheduleList() {
			window.clearTimeout(refresh);
			refresh = window.setTimeout(() => {
				void listBoardFiles(uuid, name).then((data) => {
					if (closed) {
						return;
					}
					setEntries(data.entries);
					setBranch(data.branch);
				});
			}, 200);
		}

		async function connect() {
			if (closed) {
				return;
			}
			try {
				const signed = await signBoardFilesLive(uuid, name);
				if (closed) {
					return;
				}
				socket?.close();
				const next = new WebSocket(signed.wsUrl);
				socket = next;
				next.addEventListener("message", (event) => {
					if (socket !== next) {
						return;
					}
					let parsed: unknown;
					try {
						parsed = JSON.parse(String(event.data ?? ""));
					} catch {
						return;
					}
					const change = parseBoardFileEvent(parsed);
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
						if (mobileRef.current) {
							setMobilePane("chat");
						}
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
					timer = window.setTimeout(() => {
						delay = Math.min(delay * 2, 8000);
						void connect();
					}, delay);
				});
			} catch {
				if (!closed) {
					timer = window.setTimeout(() => void connect(), delay);
				}
			}
		}

		void connect();
		return () => {
			closed = true;
			window.clearTimeout(timer);
			window.clearTimeout(refresh);
			socket?.close();
		};
	}, [uuid, name, t]);

	async function openPath(path: string) {
		if (!uuid || !name) {
			return;
		}
		const current = fileRef.current;
		if (
			current &&
			current.path !== path &&
			current.kind === "text" &&
			draftRef.current !== current.text &&
			!window.confirm(t("code.discardConfirm"))
		) {
			return;
		}
		if (current && current.path !== path) {
			editorSelectionRef.current?.(current.path, null);
		}
		setAppView(null);
		setFileLoading(true);
		try {
			const data = await readBoardFile(uuid, name, path);
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
				setMdView(isMarkdownPath(path) ? "parsed" : "raw");
				setSvgView(isSvgPath(path) ? "preview" : "source");
			}
			setStale(false);
			setNote("");
			setSaved("");
			if (mobile) {
				setMobilePane("preview");
			}
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
	openPathRef.current = openPath;

	function openApp(appId: string, title: string) {
		if (!uuid || !appId) {
			return;
		}
		const current = fileRef.current;
		if (
			current &&
			current.kind === "text" &&
			draftRef.current !== current.text &&
			!window.confirm(t("code.discardConfirm"))
		) {
			return;
		}
		editorSelectionRef.current?.(current?.path ?? "", null);
		setFile(null);
		setDraft("");
		setStale(false);
		setNote("");
		setSaved("");
		setAppView({ appId, title: title || appId });
		if (mobileRef.current) {
			setMobilePane("preview");
		}
	}

	function closeApp() {
		setAppView(null);
		if (mobileRef.current && !fileRef.current) {
			setMobilePane("chat");
		}
	}
	openAppRef.current = openApp;
	closeAppRef.current = closeApp;

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

	async function reloadFiles() {
		if (!uuid || !name) {
			return;
		}
		const listed = await listBoardFiles(uuid, name);
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

	function openFileMenu(path: string, x: number, y: number) {
		const left = Math.max(8, Math.min(x, window.innerWidth - 228));
		const top = Math.max(8, Math.min(y, window.innerHeight - 96));
		setFileMenu({ path, x: left, y: top });
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
		try {
			const list = await (kind === "run"
				? loadRunSketches(uuid)
				: loadFlashSketches(uuid));
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
			const running = kind === "run" ? (await loadRun(uuid)).running : false;
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
		if (!uuid) {
			return;
		}
		setBusy("sketch");
		try {
			await startRun({ uuid, dir });
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
		if (!uuid) {
			return;
		}
		setBusy("sketch");
		try {
			await stopRun(uuid);
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
		try {
			const [listed, status] = await Promise.all([
				loadBoardApps(uuid).catch(() => null),
				loadAppStatus(uuid).catch(() => null),
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
		if (!uuid || !name) {
			return;
		}
		setBusy("app");
		try {
			await startApp({ uuid, repo: name, dir });
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
		if (!uuid) {
			return;
		}
		setBusy("app");
		try {
			await stopApp(uuid);
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
		try {
			window.dispatchEvent(
				new CustomEvent("gpio-ui-app-page", {
					detail: { appId, title: appId },
				}),
			);
		} catch {
			undefined;
		}
	}

	function flashSketchFromMenu(dir: string) {
		setFileMenu(null);
		setFlashSketch({ dir, project: name });
		requestAction("flash");
	}

	async function textFor(path: string) {
		if (fileRef.current?.path === path && fileRef.current.kind === "text") {
			return draftRef.current;
		}
		const data = await readBoardFile(uuid, name, path);
		if (data.kind !== "text" || typeof data.text !== "string") {
			throw new Error("context file must be text");
		}
		return data.text;
	}

	if (bridge) {
		bridge.current.textFor = textFor;
		bridge.current.openPath = (path: string) => openPathRef.current(path);
		bridge.current.openApp = (appId: string, title: string) =>
			openAppRef.current(appId, title);
		bridge.current.closeApp = () => closeAppRef.current();
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

	async function deleteFile(path: string) {
		setFileMenu(null);
		if (!uuid || !name) {
			return;
		}
		const label = path.split("/").pop() ?? path;
		if (!window.confirm(t("code.deleteFileConfirm", { name: label }))) {
			return;
		}
		setBusy("file");
		try {
			await removeBoardFile(uuid, name, path);
			if (fileRef.current?.path === path) {
				setFile(null);
				setDraft("");
				openedPath.current = "";
				if (mobile) {
					setMobilePane("chat");
				}
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
		if (!uuid || !name) {
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
					const renamed = await renameBoardFile(uuid, name, renaming, to);
					if (file?.path === renaming) {
						setFile({ ...file, path: renamed.path });
					}
					onContextRenamed?.(renaming, renamed.path);
				}
			} else if (creating !== null) {
				const path = creating ? `${creating}/${filename}` : filename;
				await writeBoardFile(uuid, name, path, "");
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

	async function importFiles(dir: string, list: File[]) {
		if (!uuid || !name || list.length === 0) {
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
					bytes: new Uint8Array(await file.arrayBuffer()),
					taken,
				});
				taken.push(staged.path);
				await uploadBoardFile(uuid, name, staged.path, {
					...(staged.base64
						? { base64: staged.base64 }
						: { text: staged.text ?? "" }),
				});
			}
			const listed = await listBoardFiles(uuid, name);
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
			setDropDir(null);
		}
	}

	async function saveBoard() {
		if (file?.kind !== "text" || !uuid || !name) {
			return;
		}
		setBusy("board");
		try {
			await writeBoardFile(uuid, name, file.path, draft);
			echo.current = file.path;
			setFile({ ...file, text: draft });
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
		if (!uuid || !owner || !name) {
			return;
		}
		setBusy("github");
		try {
			const result = await pushProject({ uuid, owner, name });
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

	useEffect(() => {
		try {
			const stored = window.localStorage.getItem(OC_EDITOR_SPLIT_KEY);
			const pct = clampSplitPercent(Number(stored));
			if (stored && stageRef.current) {
				stageRef.current.style.setProperty("--oc-editor", `${pct}%`);
			}
		} catch {
			return;
		}
	}, []);

	function onSplitDown(event: ReactPointerEvent<HTMLDivElement>) {
		const stage = event.currentTarget.parentElement;
		if (!stage) {
			return;
		}
		const pane = stage;
		event.preventDefault();
		const rect = pane.getBoundingClientRect();
		function move(ev: PointerEvent) {
			const wide = window.matchMedia("(min-width: 801px)").matches;
			const ratio = wide
				? (ev.clientX - rect.left) / rect.width
				: (ev.clientY - rect.top) / rect.height;
			const next = clampSplitPercent(ratio * 100);
			pane.style.setProperty("--oc-editor", `${next}%`);
		}
		function up() {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			try {
				const raw = pane.style.getPropertyValue("--oc-editor").replace("%", "");
				window.localStorage.setItem(
					OC_EDITOR_SPLIT_KEY,
					String(clampSplitPercent(Number(raw))),
				);
			} catch {
				return;
			}
		}
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	const filesDirty = dirty;
	return (
		<div className={`oc-code-tabs${mobile ? ` is-m-${mobilePane}` : ""}`}>
			{mobile ? (
				<div
					className="oc-pane-tabs"
					role="tablist"
					aria-label={t("code.title")}
				>
					{(
						[
							{ id: "chat", label: t("code.chat") },
							{
								id: "files",
								label: `${t("code.files")}${filesDirty || stale ? " ●" : ""}`,
							},
							{ id: "preview", label: t("code.preview") },
						] as const
					).map((tab) => (
						<button
							key={tab.id}
							type="button"
							role="tab"
							aria-selected={mobilePane === tab.id}
							className={mobilePane === tab.id ? "is-on" : undefined}
							disabled={tab.id === "preview" && !file && !appView}
							onClick={() => setMobilePane(tab.id)}
						>
							{tab.label}
						</button>
					))}
				</div>
			) : null}
			<div className="oc-work">
				<aside className="oc-tree" aria-label={t("code.files")}>
					<div className="oc-tree-head">
						<span className="oc-tree-title" title={name}>
							{name || t("code.files")}
						</span>
						{branch ? (
							<span className="oc-tree-branch" title={branch}>
								{branch}
							</span>
						) : null}
						{fileCount > 0 ? (
							<span
								className="oc-tree-branch"
								title={t("code.filesCount", { n: fileCount })}
							>
								{t("code.filesCount", { n: fileCount })}
							</span>
						) : null}
						<span className="oc-tree-actions">
							<button
								type="button"
								className="oc-tree-action"
								aria-label={t("code.newFile")}
								title={t("code.newFile")}
								disabled={!uuid || !name || busy === "file"}
								onClick={startCreate}
							>
								<NewFileIcon />
							</button>
							<button
								type="button"
								className="oc-tree-action"
								aria-label={t("code.renameFile")}
								title={t("code.renameFile")}
								disabled={!(picked?.path || file?.path) || busy === "file"}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => startRename()}
							>
								<RenameIcon />
							</button>
							<button
								type="button"
								className="oc-tree-action"
								aria-label={t("code.refreshFiles")}
								title={t("code.refreshFiles")}
								disabled={!uuid || !name}
								onClick={() => void reloadFiles()}
							>
								<RefreshIcon />
							</button>
						</span>
						<button
							type="button"
							className="oc-mini"
							disabled={!uuid || !owner || !name || busy === "github"}
							title={t("code.saveGithub")}
							onClick={() => void saveGithub()}
						>
							{busy === "github"
								? t("code.savingGithub")
								: t("code.saveGithub")}
						</button>
					</div>
					<div className="oc-tree-filter">
						<input
							value={fileFilter}
							placeholder={t("code.filterFiles")}
							aria-label={t("code.filterFiles")}
							onChange={(event) => setFileFilter(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									setFileFilter("");
								}
							}}
						/>
						{fileFilter ? (
							<button
								type="button"
								className="oc-mini"
								aria-label={t("code.clear")}
								onClick={() => setFileFilter("")}
							>
								{t("code.clear")}
							</button>
						) : (
							<button
								type="button"
								className="oc-mini"
								aria-label={t("code.collapseAll")}
								disabled={openDirs.size === 0}
								onClick={() => setOpenDirs(new Set())}
							>
								{t("code.collapseAll")}
							</button>
						)}
					</div>
					{note ? <p className="oc-editor-note oc-error-note">{note}</p> : null}
					{saved ? <p className="oc-editor-note oc-success">{saved}</p> : null}
					<div
						className={`oc-tree-scroll${dropDir === "" ? " is-drop" : ""}`}
						role="tree"
						aria-label={t("code.files")}
						onDragOver={(event) => {
							if (!event.dataTransfer.types.includes("Files")) {
								return;
							}
							event.preventDefault();
							setDropDir("");
						}}
						onDragLeave={(event) => {
							if (event.currentTarget.contains(event.relatedTarget as Node)) {
								return;
							}
							setDropDir(null);
						}}
						onDrop={(event) => {
							event.preventDefault();
							void importFiles("", [...event.dataTransfer.files]);
						}}
					>
						{creating === "" ? (
							<NameRow
								value={nameDraft}
								label={t("code.fileName")}
								onChange={setNameDraft}
								onCommit={() => void commitName()}
								onCancel={() => setCreating(null)}
							/>
						) : null}
						{visibleTree.length === 0 ? (
							<p className="oc-editor-note">
								{fileFilter.trim()
									? t("code.searchEmpty")
									: t("code.emptyTree")}
							</p>
						) : (
							visibleTree.map((node) => (
								<TreeRows
									key={node.path}
									node={node}
									depth={0}
									openDirs={
										fileFilter.trim() ? openAllDirs(visibleTree) : openDirs
									}
									active={picked?.path || file?.path || ""}
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
									onOpen={(path) => {
										setPicked({ path, type: "file" });
										void openPath(path);
									}}
									onPickDir={(path) => setPicked({ path, type: "dir" })}
									dropDir={dropDir}
									onDragFolder={setDropDir}
									onDropFiles={(dir, list) => void importFiles(dir, list)}
									creating={creating}
									renaming={renaming}
									nameDraft={nameDraft}
									onName={setNameDraft}
									onCommit={() => void commitName()}
									onCancelName={() => {
										setCreating(null);
										setRenaming("");
									}}
									onFileMenu={openFileMenu}
								/>
							))
						)}
					</div>
				</aside>
				<div
					className={`oc-stage${file || appView ? " is-split" : ""}`}
					ref={stageRef}
				>
					{appView ? (
						<section className="oc-editor" aria-label={appView.title}>
							<AppFrame
								uuid={uuid}
								appId={appView.appId}
								title={appView.title}
								onClose={closeApp}
							/>
						</section>
					) : file ? (
						<section className="oc-editor" aria-label={file.path}>
							<div className="oc-editor-bar">
								<span
									className={`oc-editor-name${dirty ? " is-dirty" : ""}`}
									title={dirty ? `${file.path} ●` : file.path}
								>
									{file.path}
								</span>
								{stale ? (
									<button
										type="button"
										className="oc-mini"
										title={t("code.discardConfirm")}
										onClick={() => {
											if (dirty && !window.confirm(t("code.discardConfirm"))) {
												return;
											}
											void openPath(file.path);
										}}
									>
										{t("code.updatedOnBoard")}
									</button>
								) : null}
								{file.path === BREADBOARD_DIAGRAM_JSON ? (
									<span className="oc-view-toggle">
										<button
											type="button"
											className={`oc-mini${diagramView === "json" ? " is-on" : ""}`}
											aria-pressed={diagramView === "json"}
											onClick={() => setDiagramView("json")}
										>
											{t("code.viewJson")}
										</button>
										<button
											type="button"
											className={`oc-mini${diagramView === "board" ? " is-on" : ""}`}
											aria-pressed={diagramView === "board"}
											onClick={() => setDiagramView("board")}
										>
											{t("code.viewBreadboard")}
										</button>
									</span>
								) : null}
								{file.kind === "text" && isMarkdownPath(file.path) ? (
									<span className="oc-view-toggle">
										<button
											type="button"
											className={`oc-mini${mdView === "parsed" ? " is-on" : ""}`}
											aria-pressed={mdView === "parsed"}
											onClick={() => setMdView("parsed")}
										>
											{t("code.viewParsed")}
										</button>
										<button
											type="button"
											className={`oc-mini${mdView === "raw" ? " is-on" : ""}`}
											aria-pressed={mdView === "raw"}
											onClick={() => setMdView("raw")}
										>
											{t("code.viewRaw")}
										</button>
									</span>
								) : null}
								{file.kind === "text" && isSvgPath(file.path) ? (
									<span className="oc-view-toggle">
										<button
											type="button"
											className={`oc-mini${svgView === "preview" ? " is-on" : ""}`}
											aria-pressed={svgView === "preview"}
											onClick={() => setSvgView("preview")}
										>
											{t("code.preview")}
										</button>
										<button
											type="button"
											className={`oc-mini${svgView === "source" ? " is-on" : ""}`}
											aria-pressed={svgView === "source"}
											onClick={() => setSvgView("source")}
										>
											{t("code.viewSource")}
										</button>
									</span>
								) : null}
								{file.kind === "text" ? (
									<button
										type="button"
										className="oc-mini"
										disabled={!dirty || busy === "board"}
										onClick={() => void saveBoard()}
									>
										{busy === "board"
											? t("code.savingBoard")
											: t("code.saveBoard")}
									</button>
								) : null}
							</div>
							<div className="oc-editor-body">
								{fileLoading ? (
									<p className="oc-editor-note">{t("code.loadingFile")}</p>
								) : showBoard ? (
									<BreadboardViewer
										diagramText={draft}
										boardModel={boardModel}
										fill
									/>
								) : file.kind === "model" ? (
									<ModelViewer glbBase64={file.base64} fill />
								) : file.kind === "image" ? (
									<div className="oc-md-preview">
										<img
											className="oc-image-preview"
											src={boardImageDataUrl(file.base64, file.path)}
											alt={file.path}
										/>
									</div>
								) : file.kind === "binary" ? (
									<p className="oc-editor-note">{t("code.binary")}</p>
								) : file.kind === "text" &&
									isMarkdownPath(file.path) &&
									mdView === "parsed" ? (
									<div className="oc-md-preview">
										<MarkdownView text={draft} />
									</div>
								) : file.kind === "text" &&
									isSvgPath(file.path) &&
									svgView === "preview" ? (
									<div className="oc-md-preview">
										<img
											className="oc-image-preview"
											src={svgDataUrl(draft)}
											alt={file.path}
										/>
									</div>
								) : (
									<CodeEditor
										path={file.path}
										value={draft}
										theme={mode === "dark" ? "vs-dark" : "vs"}
										onChange={setDraft}
										onSave={() => void saveBoard()}
										onSelection={(selectedPath, selection) =>
											editorSelectionRef.current?.(selectedPath, selection)
										}
									/>
								)}
							</div>
						</section>
					) : null}
					{file || appView ? (
						<div className="oc-split" onPointerDown={onSplitDown} />
					) : null}
					<div className="oc-chat">{children}</div>
				</div>
				{fileMenu
					? createPortal(
							<FileContextMenu
								menu={fileMenu}
								menuRef={fileMenuRef}
								ariaLabel={t("code.fileActions")}
								onClose={() => setFileMenu(null)}
								items={fileMenuItems(fileMenu.path)}
							/>,
							document.body,
						)
					: null}
			</div>
		</div>
	);

	function fileMenuItems(path: string): ContextMenuItem[] {
		const appDir = boardAppDirFromPath(path);
		if (appDir) {
			const probe = appProbe;
			const readyProbe =
				probe && probe.phase === "ready" && probe.dir === appDir ? probe : null;
			const running = Boolean(readyProbe?.running);
			const actionBusy = busy === "app";
			return [
				{
					key: "app-start",
					label: t("code.appStart"),
					icon: <PlayIcon />,
					disabled:
						!readyProbe ||
						actionBusy ||
						readyProbe.running ||
						readyProbe.otherRunning,
					onSelect: () => {
						if (!readyProbe) {
							return;
						}
						void startBoardApp(appDir, readyProbe.appId);
					},
				},
				{
					key: "app-stop",
					label: t("code.appStop"),
					icon: <StopSketchIcon />,
					disabled: !running || actionBusy,
					onSelect: () => {
						if (!readyProbe?.running) {
							return;
						}
						void stopBoardApp();
					},
				},
				{
					key: "app-preview",
					label: t("code.appOpenPreview"),
					icon: <AppPreviewIcon />,
					disabled: !running,
					separatorBefore: true,
					onSelect: () => {
						if (!readyProbe) {
							return;
						}
						closeAppMenu();
						openApp(readyProbe.appId, readyProbe.appId);
					},
				},
				{
					key: "app-full",
					label: t("code.appOpenFullscreen"),
					icon: <FullscreenIcon />,
					disabled: !running,
					onSelect: () => {
						if (!readyProbe) {
							return;
						}
						openAppFullscreen(readyProbe.appId);
					},
				},
			];
		}
		const items: ContextMenuItem[] = [];
		const probe = sketchProbe;
		const runReady = probe?.kind === "run" && probe.phase === "ready";
		const flashReady = probe?.kind === "flash" && probe.phase === "ready";
		items.push(
			{
				key: "run-sketch",
				label:
					runReady && probe.running
						? t("code.stopSketch")
						: t("code.runSketch"),
				icon: runReady && probe.running ? <StopSketchIcon /> : <PlayIcon />,
				disabled: !runReady,
				onSelect: () => {
					if (probe?.kind !== "run" || probe.phase !== "ready") {
						return;
					}
					if (probe.running) {
						void stopSketch();
					} else {
						void startSketch(probe.dir);
					}
				},
			},
			{
				key: "flash-sketch",
				label: t("code.flashSketch"),
				icon: <FlashSketchIcon />,
				disabled: !flashReady,
				onSelect: () => {
					if (probe?.kind !== "flash" || probe.phase !== "ready") {
						return;
					}
					flashSketchFromMenu(probe.dir);
				},
			},
		);
		items.push(
			{
				key: "context",
				label: t("code.addToContext"),
				icon: <ContextIcon />,
				onSelect: () => void addToContext(path),
			},
			{
				key: "rename",
				label: t("code.renameFile"),
				icon: <RenameIcon />,
				onSelect: () => startRename(path),
			},
			{
				key: "delete",
				label: t("code.deleteFile"),
				danger: true,
				separatorBefore: true,
				icon: <TrashIcon />,
				onSelect: () => void deleteFile(path),
			},
		);
		return items;
	}
}

function FileContextMenu({
	menu,
	menuRef,
	ariaLabel,
	onClose,
	items,
}: {
	menu: FileMenu;
	menuRef: RefObject<HTMLDivElement | null>;
	ariaLabel: string;
	onClose: () => void;
	items: ContextMenuItem[];
}) {
	return (
		<div
			ref={menuRef}
			className="oc-context-menu"
			role="menu"
			aria-label={ariaLabel}
			style={{ left: menu.x, top: menu.y }}
		>
			{items.map((item, index) => (
				<Fragment key={item.key}>
					{item.separatorBefore && index > 0 ? (
						<hr className="oc-context-menu-sep" />
					) : null}
					<button
						type="button"
						role="menuitem"
						className={`oc-context-menu-item${item.danger ? " is-danger" : ""}`}
						disabled={item.disabled}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							onClose();
							item.onSelect();
						}}
					>
						<span className="oc-context-menu-label">{item.label}</span>
						<span className="oc-context-menu-icon" aria-hidden="true">
							{item.icon}
						</span>
					</button>
				</Fragment>
			))}
		</div>
	);
}

function NameRow({
	value,
	label,
	onChange,
	onCommit,
	onCancel,
}: {
	value: string;
	label: string;
	onChange: (value: string) => void;
	onCommit: () => void;
	onCancel: () => void;
}) {
	const skip = useRef(false);
	const ready = useRef(false);
	useEffect(() => {
		const timer = window.setTimeout(() => {
			ready.current = true;
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);
	return (
		<div className="oc-tree-row" style={{ paddingLeft: 8 }}>
			<span className="oc-tree-chevron" />
			<FileIcon />
			<input
				className="oc-tree-name-input"
				value={value}
				aria-label={label}
				// biome-ignore lint/a11y/noAutofocus: focus is the point of the inline rename input
				autoFocus
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						skip.current = true;
						onCommit();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						skip.current = true;
						onCancel();
					}
				}}
				onBlur={() => {
					if (!ready.current || skip.current) {
						skip.current = false;
						return;
					}
					onCommit();
				}}
			/>
		</div>
	);
}

function NewFileIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4 2.5h5l3 3V13.5H4zM9 2.5V6h3.2M8 8.5v4M6 10.5h4" />
		</svg>
	);
}

function RenameIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M9 3.5l3.5 3.5L6 13.5H2.5V10z" />
		</svg>
	);
}

function ContextIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M4 2.5h5l3 3V13.5H4zM9 2.5V6h3.2" />
			<path d="M6.2 9.5h3.6M8 7.7v3.6" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2h5.8l.6-8.2M6.7 7v3.9M9.3 7v3.9" />
		</svg>
	);
}

function PlayIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
			<path d="M5 3.2l7.5 4.8L5 12.8z" />
		</svg>
	);
}

function StopSketchIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
			<path d="M4.5 4.5h7v7h-7z" />
		</svg>
	);
}

function FlashSketchIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
			<path d="M8.8 1.5L4 9h3.1L6 14.5 12 7H8.4z" />
		</svg>
	);
}

function AppPreviewIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M2 3.5h12v9H2zM2 6h12M4.2 4.8h.01M6.2 4.8h.01" />
		</svg>
	);
}

function FullscreenIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
		>
			<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
		</svg>
	);
}

function RefreshIcon() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M13 8a5 5 0 11-1.2-3.2M13 2.5V5.5H10" />
		</svg>
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
	active,
	onToggle,
	onOpen,
	onPickDir,
	dropDir,
	onDragFolder,
	onDropFiles,
	creating,
	renaming,
	nameDraft,
	onName,
	onCommit,
	onCancelName,
	onFileMenu,
}: {
	node: BoardFileNode;
	depth: number;
	openDirs: Set<string>;
	active: string;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
	onPickDir: (path: string) => void;
	dropDir: string | null;
	onDragFolder: (dir: string) => void;
	onDropFiles: (dir: string, list: File[]) => void;
	creating: string | null;
	renaming: string;
	nameDraft: string;
	onName: (value: string) => void;
	onCommit: () => void;
	onCancelName: () => void;
	onFileMenu: (path: string, x: number, y: number) => void;
}) {
	const hold = useRef(0);
	const holdAt = useRef({ x: 0, y: 0 });
	const held = useRef(false);
	const suppressMenu = useRef(false);
	const open = node.type === "dir" && openDirs.has(node.path);
	const target = node.type === "dir" ? node.path : parentDir(node.path);
	const appDir = node.type === "dir" ? boardAppDirFromPath(node.path) : null;
	return (
		<>
			{renaming === node.path ? (
				<NameRow
					value={nameDraft}
					label={node.name}
					onChange={onName}
					onCommit={onCommit}
					onCancel={onCancelName}
				/>
			) : (
				<button
					type="button"
					role="treeitem"
					aria-level={depth + 1}
					aria-expanded={node.type === "dir" ? open : undefined}
					aria-current={node.path === active ? "true" : undefined}
					title={node.type === "dir" ? target : node.path}
					className={`oc-tree-row${node.path === active ? " is-active" : ""}${dropDir === target && node.type === "dir" ? " is-drop" : ""}`}
					style={{
						paddingLeft: 8 + depth * 12,
						touchAction: "manipulation",
						WebkitTouchCallout: "none",
						userSelect: "none",
					}}
					onClick={() => {
						if (held.current) {
							held.current = false;
							return;
						}
						if (node.type === "dir") {
							onPickDir(node.path);
							onToggle(node.path);
							return;
						}
						onOpen(node.path);
					}}
					onContextMenu={(event) => {
						event.preventDefault();
						event.stopPropagation();
						if (suppressMenu.current) {
							suppressMenu.current = false;
							return;
						}
						window.clearTimeout(hold.current);
						if (node.type === "dir" && !appDir) {
							return;
						}
						onFileMenu(node.path, event.clientX, event.clientY);
					}}
					onPointerDown={(event) => {
						if ((node.type === "dir" && !appDir) || event.button !== 0) {
							return;
						}
						held.current = false;
						suppressMenu.current = false;
						holdAt.current = { x: event.clientX, y: event.clientY };
						window.clearTimeout(hold.current);
						hold.current = window.setTimeout(() => {
							held.current = true;
							suppressMenu.current = true;
							onFileMenu(node.path, holdAt.current.x, holdAt.current.y);
						}, 500);
					}}
					onPointerMove={(event) => {
						if (
							Math.hypot(
								event.clientX - holdAt.current.x,
								event.clientY - holdAt.current.y,
							) > 8
						) {
							window.clearTimeout(hold.current);
						}
					}}
					onPointerUp={() => window.clearTimeout(hold.current)}
					onPointerCancel={() => window.clearTimeout(hold.current)}
					onLostPointerCapture={() => window.clearTimeout(hold.current)}
					onDragOver={(event) => {
						if (!event.dataTransfer.types.includes("Files")) {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						onDragFolder(target);
					}}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onDropFiles(target, [...event.dataTransfer.files]);
					}}
				>
					{node.type === "dir" ? (
						<Chevron open={open} />
					) : (
						<span className="oc-tree-chevron" />
					)}
					{node.type === "dir" ? <FolderIcon /> : <FileIcon />}
					<span className="oc-tree-name">{node.name}</span>
				</button>
			)}
			{open && creating === node.path ? (
				<NameRow
					value={nameDraft}
					label={node.name}
					onChange={onName}
					onCommit={onCommit}
					onCancel={onCancelName}
				/>
			) : null}
			{open
				? node.children.map((child) => (
						<TreeRows
							key={child.path}
							node={child}
							depth={depth + 1}
							openDirs={openDirs}
							active={active}
							onToggle={onToggle}
							onOpen={onOpen}
							onPickDir={onPickDir}
							dropDir={dropDir}
							onDragFolder={onDragFolder}
							onDropFiles={onDropFiles}
							creating={creating}
							renaming={renaming}
							nameDraft={nameDraft}
							onName={onName}
							onCommit={onCommit}
							onCancelName={onCancelName}
							onFileMenu={onFileMenu}
						/>
					))
				: null}
		</>
	);
}

function CodeEditor({
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
	onSelection: (path: string, selection: CodeEditorSelection | null) => void;
}) {
	const [Editor, setEditor] = useState<
		typeof import("@monaco-editor/react").default | null
	>(null);
	const onSelectionRef = useRef(onSelection);
	onSelectionRef.current = onSelection;
	const pathRef = useRef(path);
	pathRef.current = path;
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
		return <p className="oc-editor-note">Loading…</p>;
	}
	return (
		<Editor
			height="100%"
			path={path}
			language={boardFileLanguage(path)}
			theme={theme}
			value={value}
			onChange={(next) => onChange(next ?? "")}
			onMount={(editor, monaco) => {
				editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
				editor.onDidChangeCursorSelection(() => {
					const selection = editor.getSelection();
					const model = editor.getModel();
					if (!selection || selection.isEmpty() || !model) {
						onSelectionRef.current(pathRef.current, null);
						return;
					}
					onSelectionRef.current(pathRef.current, {
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

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			className={`oc-tree-chevron${open ? " is-open" : ""}`}
			viewBox="0 0 16 16"
			aria-hidden="true"
		>
			<path
				d="M6 4l4 4-4 4"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			/>
		</svg>
	);
}

function FolderIcon() {
	return (
		<svg className="oc-tree-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M2 4.5h4l1 1.5h7v6.5H2z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
		</svg>
	);
}

function FileIcon() {
	return (
		<svg className="oc-tree-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M4 2.5h5l3 3V13.5H4z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
		</svg>
	);
}
