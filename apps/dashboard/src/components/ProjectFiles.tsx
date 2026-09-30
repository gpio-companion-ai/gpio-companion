import { POST as listFiles } from "@api/files/list";
import { POST as signFilesLive } from "@api/files/live";
import { POST as readFile } from "@api/files/read";
import { PUT as writeFile } from "@api/files/write";
import { POST as pushProject } from "@api/projects/push";
import {
	type BoardFileEntry,
	type BoardFileNode,
	BREADBOARD_DIAGRAM_JSON,
	boardFileApplyEvent,
	boardFileDirty,
	boardFileLanguage,
	boardFileTree,
	clampSplitPercent,
	countBoardFiles,
	filterBoardNodes,
	OC_EDITOR_SPLIT_KEY,
	parseBoardFileEvent,
} from "gpio-companion";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { useColorMode } from "../hooks/useColorMode.tsx";
import { useT } from "../hooks/useLocale.tsx";
import { useWorkbench } from "../hooks/useWorkbench.tsx";
import { unwrapAction } from "../lib/action.ts";
import BreadboardViewer from "./BreadboardViewer.tsx";
import ModelViewer from "./ModelViewer.tsx";

type Props = {
	uuid: string;
	owner: string;
	name: string;
	children: ReactNode;
};

type OpenFile = {
	path: string;
	kind: "text" | "model" | "binary";
	text: string;
	base64: string;
};

export default function ProjectFiles({ uuid, owner, name, children }: Props) {
	const t = useT();
	const { mode } = useColorMode();
	const { boards } = useWorkbench();
	const boardModel = boards.find((board) => board.uuid === uuid)?.model || null;
	const [entries, setEntries] = useState<BoardFileEntry[]>([]);
	const [branch, setBranch] = useState("");
	const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
	const [file, setFile] = useState<OpenFile | null>(null);
	const [draft, setDraft] = useState("");
	const [diagramView, setDiagramView] = useState<"json" | "board">("board");
	const [stale, setStale] = useState(false);
	const [note, setNote] = useState("");
	const [saved, setSaved] = useState("");
	const [busy, setBusy] = useState("");
	const [fileFilter, setFileFilter] = useState("");
	const [fileLoading, setFileLoading] = useState(false);
	const echo = useRef("");
	const fileRef = useRef(file);
	const draftRef = useRef(draft);
	const stageRef = useRef<HTMLDivElement>(null);
	fileRef.current = file;
	draftRef.current = draft;
	const openPathRef = useRef<(path: string) => Promise<void>>(async () => {});
	const openedPath = useRef("");
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
		setStale(false);
		setNote("");
		setSaved("");
		setEntries([]);
		setBranch("");
		setOpenDirs(new Set());
		setFileFilter("");
		setDiagramView("board");
		openedPath.current = "";
	}, [uuid, name]);

	useEffect(() => {
		if (!uuid || !name) {
			return;
		}
		let closed = false;
		void listFiles({ uuid, name })
			.then((result) => {
				if (closed || !result.ok) {
					if (!closed && !result.ok) {
						setNote(result.error);
					}
					return;
				}
				setEntries(result.data.entries);
				setBranch(result.data.branch);
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
		if (!uuid || !name || typeof window === "undefined") {
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
				void listFiles({ uuid, name }).then((result) => {
					if (closed || !result.ok) {
						return;
					}
					setEntries(result.data.entries);
					setBranch(result.data.branch);
				});
			}, 200);
		}

		async function connect() {
			if (closed) {
				return;
			}
			try {
				const signed = unwrapAction(await signFilesLive({ uuid, name }));
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
		setFileLoading(true);
		const result = await readFile({ uuid, name, path });
		setFileLoading(false);
		if (!result.ok) {
			setNote(result.error);
			setSaved("");
			return;
		}
		const next: OpenFile = {
			path: result.data.path,
			kind: result.data.kind,
			text: result.data.text ?? "",
			base64: result.data.base64 ?? "",
		};
		setFile(next);
		setDraft(next.text);
		if (openedPath.current !== path) {
			openedPath.current = path;
			setDiagramView(path === BREADBOARD_DIAGRAM_JSON ? "board" : "json");
		}
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
	}
	openPathRef.current = openPath;

	async function saveBoard() {
		if (file?.kind !== "text" || !uuid || !name) {
			return;
		}
		setBusy("board");
		const result = await writeFile({
			uuid,
			name,
			path: file.path,
			text: draft,
		});
		setBusy("");
		if (!result.ok) {
			setNote(result.error);
			setSaved("");
			return;
		}
		echo.current = file.path;
		setFile({ ...file, text: draft });
		setStale(false);
		setNote("");
		setSaved(t("code.savedBoard"));
	}

	async function saveGithub() {
		if (!uuid || !owner || !name) {
			return;
		}
		setBusy("github");
		const result = await pushProject({ uuid, owner, name });
		setBusy("");
		if (!result.ok) {
			setNote(result.error);
			setSaved("");
			return;
		}
		const pushed = result.data.board.branch || branch;
		if (pushed) {
			setBranch(pushed);
		}
		setNote("");
		setSaved(t("code.savedGithub").replace("{branch}", pushed || name));
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

	return (
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
					<button
						type="button"
						className="oc-mini"
						disabled={!uuid || !owner || !name || busy === "github"}
						title={t("code.saveGithub")}
						onClick={() => void saveGithub()}
					>
						{busy === "github" ? t("code.savingGithub") : t("code.saveGithub")}
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
				<div className="oc-tree-scroll" role="tree" aria-label={t("code.files")}>
					{visibleTree.length === 0 ? (
						<p className="oc-editor-note">
							{fileFilter.trim() ? t("code.searchEmpty") : t("code.emptyTree")}
						</p>
					) : (
						visibleTree.map((node) => (
							<TreeRows
								key={node.path}
								node={node}
								depth={0}
								openDirs={fileFilter.trim() ? openAllDirs(visibleTree) : openDirs}
								active={file?.path ?? ""}
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
				</div>
			</aside>
			<div
				className={`oc-stage${file ? " is-split" : ""}`}
				ref={stageRef}
			>
				{file ? (
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
										if (
											dirty &&
											!window.confirm(t("code.discardConfirm"))
										) {
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
							) : file.kind === "binary" ? (
								<p className="oc-editor-note">{t("code.binary")}</p>
							) : (
								<CodeEditor
									path={file.path}
									value={draft}
									theme={mode === "dark" ? "vs-dark" : "vs"}
									onChange={setDraft}
									onSave={() => void saveBoard()}
								/>
							)}
						</div>
					</section>
				) : null}
				{file ? <div className="oc-split" onPointerDown={onSplitDown} /> : null}
				<div className="oc-chat">{children}</div>
			</div>
		</div>
	);
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
}: {
	node: BoardFileNode;
	depth: number;
	openDirs: Set<string>;
	active: string;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
}) {
	const open = node.type === "dir" && openDirs.has(node.path);
	return (
		<>
			<button
				type="button"
				role="treeitem"
				aria-level={depth + 1}
				aria-expanded={node.type === "dir" ? open : undefined}
				aria-current={node.path === active ? "true" : undefined}
				title={node.path}
				className={`oc-tree-row${node.path === active ? " is-active" : ""}`}
				style={{ paddingLeft: 8 + depth * 12 }}
				onClick={() =>
					node.type === "dir" ? onToggle(node.path) : onOpen(node.path)
				}
			>
				{node.type === "dir" ? (
					<Chevron open={open} />
				) : (
					<span className="oc-tree-chevron" />
				)}
				{node.type === "dir" ? <FolderIcon /> : <FileIcon />}
				<span className="oc-tree-name">{node.name}</span>
			</button>
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
}: {
	path: string;
	value: string;
	theme: "vs-dark" | "vs";
	onChange: (value: string) => void;
	onSave: () => void;
}) {
	const [Editor, setEditor] = useState<
		typeof import("@monaco-editor/react").default | null
	>(null);
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
