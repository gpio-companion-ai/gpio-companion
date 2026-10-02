import {
	applyCodeMention,
	CODE_ATTACH_ACCEPT,
	CODE_VOICE_MAX_MS,
	type CodeAttachDraft,
	type CodeEditorSelection,
	type CodeSpeechPlayer,
	CodeSpeechQueue,
	type CodeSpeechStatus,
	type CodeVoiceProvider,
	codeAppendSpeechDirective,
	codeAttachPrompt,
	codeComposerErrorKey,
	codeHasSpeechDirective,
	codeMentionAt,
	codeSpeechBlocks,
	codeSpeechChunks,
	codeVoiceProvider,
	codeVoiceUtterance,
	encodeBase64,
	filterCodeMentions,
	hasBoardSelectionDraft,
	removeContextDrafts,
	renameContextDrafts,
	replaceBoardContext,
	stageBoardContext,
	stageCodeAttach,
} from "gpio-companion-attach";
import {
	activeOpencodeQuestion,
	applyOpencodeEvent,
	CODE_DEFAULT_MODEL,
	codeNavBack,
	codeQuestionAnswer,
	codeQuestionSlideIndex,
	codeRepoLabel,
	codeRepoOwner,
	codeScrollKey,
	codeSessionTitle,
	emptyOpencodeView,
	filterCodeSessions,
	holdOpencodePromptEvent,
	matchCodeRepo,
	matchOpencodeQuestionID,
	mergeOpencodeQuestions,
	noteOpencodePrompt,
	OPENCODE_EFFORT_KEY,
	OPENCODE_MODEL_KEY,
	OPENCODE_PERMISSION_MODE_KEY,
	OPENCODE_PERMISSION_MODES,
	type OpencodeClientCall,
	type OpencodePart,
	type OpencodePermissionMode,
	type OpencodePermissionResponse,
	type OpencodePromptEpoch,
	type OpencodeTurn,
	type OpencodeView,
	opencodeEventResumeUrl,
	opencodeModelChoices,
	opencodePermissionMode,
	opencodePromptFields,
	opencodeQuestions,
	opencodeReplyAccepted,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeStoredEffort,
	opencodeStoredModel,
	opencodeStoredPermissionMode,
	opencodeToolStacks,
	opencodeTurns,
	parseOpencodeEventFrame,
	pendingOpencodeFromMessages,
	pendingOpencodeTurn,
	pruneCodePromptState,
	pushCodeNav,
	type ReasoningEffort,
	readCodeNav,
	readStoredOpencodePrompts,
	recoverOpencodePrompts,
	releaseSettledPromptHolds,
	rememberOpencodePrompt,
	replaceCodeNav,
	seedOpencodePrompts,
	settleOpencodeTurns,
	storeOpencodePrompts,
} from "gpio-companion-opencode";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	getVoiceSettings,
	listProjects,
	opencodeCall,
	signOpencodeLive,
	speakCode,
	transcribeCode,
	uploadBoardFile,
} from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useLocale, useT } from "../locale";
import { Blocks } from "./OcMarkdown";
import ProjectFiles, { type CodeFilesBridge } from "./ProjectFiles";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";
type ChipMenuId = "model" | "effort" | "permission" | "project" | "board";

function ChipMenu({
	open,
	label,
	value,
	hint,
	selected,
	options,
	menuRef,
	place = "up",
	onOpen,
	onPick,
}: {
	open: boolean;
	label: string;
	value: string;
	hint?: string;
	selected: string;
	options: Array<{ id: string; name: string; hint?: string }>;
	menuRef: { current: HTMLDivElement | null };
	place?: "up" | "down";
	onOpen: () => void;
	onPick: (id: string) => void;
}) {
	return (
		<div
			className={`oc-model${open ? " is-open" : ""}`}
			ref={open ? menuRef : undefined}
		>
			<button
				type="button"
				className="oc-chip"
				aria-label={label}
				aria-expanded={open}
				aria-haspopup="listbox"
				onClick={onOpen}
			>
				<span>{label}</span>
				<span>{value}</span>
				{hint ? <span className="oc-model-provider">{hint}</span> : null}
			</button>
			{open ? (
				<div
					className={`oc-model-menu${place === "down" ? " is-down" : ""}`}
					role="listbox"
					aria-label={label}
				>
					{options.map((item) => (
						<button
							key={item.id}
							type="button"
							role="option"
							aria-selected={item.id === selected}
							className={item.id === selected ? "is-on" : undefined}
							onClick={() => onPick(item.id)}
						>
							<span>{item.name}</span>
							{item.hint ? (
								<span className="oc-model-provider">{item.hint}</span>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function boardChipName(item: { uuid: string; label?: string } | undefined) {
	return item?.label?.trim() || item?.uuid || "";
}

function boardChipHint(
	item: { uuid: string; label?: string } | undefined,
	model?: string,
) {
	const named = model?.trim();
	if (named) {
		return named;
	}
	return item?.label?.trim() ? item.uuid.slice(0, 8) : undefined;
}

function SearchIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="11" cy="11" r="6" />
			<path d="M16 16l4 4" />
		</svg>
	);
}

function AttachIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M8 12.5l6.2-6.2a3 3 0 114.2 4.2l-7.4 7.4a4.5 4.5 0 11-6.4-6.4l7-7" />
		</svg>
	);
}

function MicIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="9" y="3" width="6" height="11" rx="3" />
			<path d="M6 11a6 6 0 0012 0M12 17v4" />
		</svg>
	);
}

function SendIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 19V6M7 11l5-5 5 5" />
		</svg>
	);
}

function StopIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect
				x="8"
				y="8"
				width="8"
				height="8"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}

function BackIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M14 6l-6 6 6 6" />
		</svg>
	);
}

function formatSessionTime(updated: number): string {
	if (!updated) {
		return "";
	}
	return new Date(updated).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function stackStatus(parts: OpencodePart[]): "running" | "error" | "done" {
	if (parts.some((part) => part.status === "running")) {
		return "running";
	}
	if (parts.some((part) => part.status === "error")) {
		return "error";
	}
	return "done";
}

function toolInfo(
	part: OpencodePart,
	inputLabel: string,
	outputLabel: string,
): string {
	const chunks: string[] = [];
	if (part.input) {
		chunks.push(`${inputLabel}\n${part.input}`);
	}
	if (part.output) {
		chunks.push(`${outputLabel}\n${part.output}`);
	}
	return chunks.join("\n\n");
}

function ToolStack({ parts }: { parts: OpencodePart[] }) {
	const t = useT();
	const running = parts.some((part) => part.status === "running");
	const touched = useRef(false);
	const [open, setOpen] = useState(running);
	const [info, setInfo] = useState("");
	useEffect(() => {
		if (!touched.current) {
			setOpen(running);
		}
	}, [running]);
	const names = [
		...new Set(parts.map((part) => part.tool).filter(Boolean)),
	].join(", ");
	const label =
		parts.length === 1
			? names
			: t("code.toolStack", { n: parts.length, names });
	return (
		<div className={`oc-tools is-${stackStatus(parts)}`}>
			<button
				type="button"
				className="oc-tools-toggle"
				aria-expanded={open}
				onClick={() => {
					touched.current = true;
					setOpen((value) => !value);
				}}
			>
				<i className="oc-mark" />
				<strong>{label}</strong>
				<span aria-hidden="true">{open ? "▾" : "▸"}</span>
			</button>
			{open
				? parts.map((part) => {
						const body = toolInfo(
							part,
							t("code.toolInput"),
							t("code.toolOutput"),
						);
						return (
							<div key={part.id}>
								<button
									type="button"
									className={`oc-tool is-${part.status}`}
									aria-expanded={info === part.id}
									onClick={() =>
										setInfo((current) => (current === part.id ? "" : part.id))
									}
								>
									<i className="oc-mark" />
									<strong>{part.tool}</strong>
									{part.text ? <span>{part.text}</span> : null}
								</button>
								{info === part.id && body ? (
									<pre className="oc-code oc-tool-info">{body}</pre>
								) : null}
							</div>
						);
					})
				: null}
		</div>
	);
}

function TurnView({ turn, caret }: { turn: OpencodeTurn; caret: boolean }) {
	const blocks =
		turn.role === "assistant" ? opencodeToolStacks(turn.parts) : [];
	return (
		<article className="oc-turn">
			{turn.role === "user" ? (
				<p className="oc-user">{turn.text}</p>
			) : (
				blocks.map((block) =>
					block.type === "text" ? (
						<Blocks key={block.id} text={block.text} />
					) : (
						<ToolStack key={block.id} parts={block.parts} />
					),
				)
			)}
			{caret ? <span className="oc-caret" /> : null}
		</article>
	);
}

export default function OpenCodeSession({
	onOpenProject,
}: {
	onOpenProject?: () => void;
}) {
	const t = useT();
	const { locale } = useLocale();
	const { uuid, setUuid } = useBoardSelection();
	const { devices, boards } = useUserBoards();
	const selected = uuid || devices[0]?.uuid || "";
	const [repos, setRepos] = useState<Repo[]>([]);
	const [repo, setRepo] = useState("");
	const [view, setView] = useState<OpencodeView>(() => {
		if (typeof window === "undefined") {
			return emptyOpencodeView();
		}
		return seedOpencodePrompts(
			emptyOpencodeView(),
			readCodeNav(window.location.search).sessionID,
		);
	});
	const [mode, setMode] = useState<Mode>(() =>
		typeof window === "undefined"
			? "home"
			: readCodeNav(window.location.search).mode,
	);
	const [prompt, setPrompt] = useState("");
	const [files, setFiles] = useState<CodeAttachDraft[]>([]);
	const [boardPaths, setBoardPaths] = useState<string[]>([]);
	const [caret, setCaret] = useState(0);
	const [mentionOff, setMentionOff] = useState("");
	const [mentionIndex, setMentionIndex] = useState(0);
	const filesBridge = useRef<CodeFilesBridge>({
		textFor: async () => {
			throw new Error("file is missing");
		},
		openPath: async () => {
			throw new Error("file is missing");
		},
	});
	const previewPending = useRef<{ repo: string; path: string } | null>(null);
	const repoRef = useRef(repo);
	repoRef.current = repo;
	const reposRef = useRef(repos);
	reposRef.current = repos;
	const rememberEntries = useCallback(
		(entries: { type: string; path: string }[]) => {
			setBoardPaths(
				entries.filter((item) => item.type === "file").map((item) => item.path),
			);
		},
		[],
	);
	const [uploading, setUploading] = useState(false);
	const [voiceProvider, setVoiceProvider] =
		useState<CodeVoiceProvider>("workers-ai");
	const [pttHeld, setPttHeld] = useState(false);
	const [voiceLevel, setVoiceLevel] = useState(0);
	const [voiceListening, setVoiceListening] = useState(false);
	const [speechStatus, setSpeechStatus] = useState<CodeSpeechStatus>({
		speaking: false,
		paused: false,
		preparing: false,
		canReplay: false,
	});
	const voiceSpeakingNow = speechStatus.speaking;
	const [readAloud, setReadAloud] = useState(false);
	const [voiceQueued, setVoiceQueued] = useState(0);
	const [voiceTranscribing, setVoiceTranscribing] = useState(false);
	const [voiceReply, setVoiceReply] = useState(false);
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [sessionsSeq, setSessionsSeq] = useState(0);
	const [slide, setSlide] = useState(0);
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [showCustom, setShowCustom] = useState(false);
	const [model, setModel] = useState(CODE_DEFAULT_MODEL);
	const [effort, setEffort] = useState<ReasoningEffort>("medium");
	const [permissionMode, setPermissionMode] =
		useState<OpencodePermissionMode>("ask");
	const [menu, setMenu] = useState<ChipMenuId | "">("");
	const [selectsOpen, setSelectsOpen] = useState(false);
	const [replyBusy, setReplyBusy] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const voiceEngine = useRef<{
		stream: MediaStream;
		context: AudioContext;
		analyser: AnalyserNode;
		data: Float32Array<ArrayBuffer>;
		raf: number;
	} | null>(null);
	const voiceUtter = useRef<{
		recorder: MediaRecorder;
		started: number;
		voiceAt: number;
		source: "ptt";
		cancel(): void;
	} | null>(null);
	const voiceSpeaking = useRef<HTMLAudioElement | null>(null);
	const speechSpoken = useRef(new Map<string, number>());
	const speechQueue = useRef<CodeSpeechQueue | null>(null);
	const speechIo = useRef({
		fetch: async (text: string) => (await speakCode(text, locale)).audio,
		play: playSpeech,
		changed: setSpeechStatus,
		failed: (caught: unknown) =>
			setError(shownError(caught instanceof Error ? caught.message : "")),
	});
	speechIo.current.fetch = async (text) =>
		(await speakCode(text, locale)).audio;
	speechIo.current.failed = (caught) =>
		setError(shownError(caught instanceof Error ? caught.message : ""));
	if (!speechQueue.current)
		speechQueue.current = new CodeSpeechQueue({
			fetch: (text) => speechIo.current.fetch(text),
			play: (audio) => speechIo.current.play(audio),
			changed: (status) => speechIo.current.changed(status),
			failed: (caught) => speechIo.current.failed(caught),
		});
	const voiceSpoken = useRef(new Set<string>());
	const voiceQueue = useRef<string[]>([]);
	const voiceShown = useRef(-1);
	const speechScope = useRef({
		uuid: selected,
		repo,
		mode,
		sessionID: view.sessionID,
	});
	const speechDirectiveSentRef = useRef<string | null>(null);
	const pttRef = useRef(false);
	const pttParts = useRef(new Map<number, string>());
	const pttSeq = useRef(0);
	const pttPending = useRef(0);
	const voiceTickRef = useRef<() => void>(() => {});
	const beginPttRef = useRef<() => void>(() => {});
	const endPttRef = useRef<() => void>(() => {});
	const stopVoiceEngineRef = useRef<() => void>(() => {});
	const finishVoiceRef = useRef<(blob: Blob) => void>(() => {});
	const menuRef = useRef<HTMLDivElement>(null);
	const askedId = useRef("");
	const prompts = useRef<OpencodePromptEpoch>({
		epoch: 0,
		dropped: new Set(),
	});
	const held = useRef(new Set<string>());
	const replying = useRef(false);

	useEffect(() => {
		void listProjects()
			.then((result) => {
				setRepos(
					result.repos.map((item) => ({
						owner: item.owner,
						name: item.name,
					})),
				);
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			});
	}, []);

	useEffect(() => {
		void getVoiceSettings()
			.then((result) => {
				setVoiceProvider(codeVoiceProvider(result.provider));
			})
			.catch(() => setVoiceProvider("workers-ai"));
	}, []);

	useEffect(() => {
		try {
			setModel(
				opencodeStoredModel(window.localStorage.getItem(OPENCODE_MODEL_KEY)),
			);
			setEffort(
				opencodeStoredEffort(window.localStorage.getItem(OPENCODE_EFFORT_KEY)),
			);
			setPermissionMode(
				opencodeStoredPermissionMode(
					window.localStorage.getItem(OPENCODE_PERMISSION_MODE_KEY),
				),
			);
		} catch {
			setModel(CODE_DEFAULT_MODEL);
			setEffort("medium");
		}
	}, []);

	useEffect(() => {
		if (!selected || !repo) {
			return;
		}
		let cancelled = false;
		void opencodeCall({
			uuid: selected,
			repo,
			op: "permission-mode",
		})
			.then((result) => {
				if (cancelled) {
					return;
				}
				const record = result as { mode?: unknown } | null;
				const mode = opencodePermissionMode(record?.mode);
				setPermissionMode(mode);
				try {
					window.localStorage.setItem(OPENCODE_PERMISSION_MODE_KEY, mode);
				} catch {
					return;
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selected, repo]);

	useEffect(() => {
		let stored = "";
		try {
			stored = window.localStorage.getItem(PROJECT_KEY) ?? "";
		} catch {
			stored = "";
		}
		setRepo(matchCodeRepo(repos, stored));
	}, [repos]);

	function clearQuestionDraft() {
		setSlide(0);
		setPicks({});
		setCustom({});
		setShowCustom(false);
	}

	function promptAnswer(item: { question: string }) {
		return codeQuestionAnswer(
			picks[item.question],
			custom[item.question] ?? "",
		);
	}

	const pickChoice = useCallback((prompt: string, option: string) => {
		setPicks((current) => ({ ...current, [prompt]: option }));
		setCustom((current) => ({ ...current, [prompt]: "" }));
		setShowCustom(false);
	}, []);

	function moveQuestion(delta: number) {
		if (!question || question.prompts.length === 0) {
			return;
		}
		const count = question.prompts.length;
		const index = codeQuestionSlideIndex(slide, count, 0);
		const current = question.prompts[index];
		if (delta > 0 && (!current || !promptAnswer(current))) {
			return;
		}
		setSlide(codeQuestionSlideIndex(index, count, delta));
	}

	function selectRepo(name: string) {
		setRepo(name);
		const match = repos.find((item) => item.name === name);
		if (match) {
			window.localStorage.setItem(PROJECT_KEY, `${match.owner}/${match.name}`);
		}
	}

	function remember(name: string) {
		selectRepo(name);
		setQuery("");
		clearQuestionDraft();
		leaveChat();
	}

	function requestPreview(repoName: string, path: string) {
		if (!repoName || !path) {
			return;
		}
		if (!reposRef.current.some((item) => item.name === repoName)) {
			setError(t("code.noProjects"));
			return;
		}
		if (repoName !== repoRef.current) {
			previewPending.current = { repo: repoName, path };
			selectRepo(repoName);
			return;
		}
		previewPending.current = null;
		void filesBridge.current.openPath(path).catch(() => undefined);
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: shell event wiring mounts once
	useEffect(() => {
		function onPreview(event: Event) {
			const detail = (event as CustomEvent<{ repo?: unknown; path?: unknown }>)
				.detail;
			if (
				!detail ||
				typeof detail.repo !== "string" ||
				typeof detail.path !== "string"
			) {
				return;
			}
			requestPreview(detail.repo, detail.path);
		}
		// Sticky request set by the app shell when it navigates to Code first.
		try {
			const win = window as unknown as {
				__gpioUiPreview?: { repo: string; path: string };
			};
			const sticky = win.__gpioUiPreview;
			if (sticky) {
				win.__gpioUiPreview = undefined;
				requestPreview(sticky.repo, sticky.path);
			}
		} catch {
			undefined;
		}
		window.addEventListener("gpio-ui-preview", onPreview);
		return () => {
			window.removeEventListener("gpio-ui-preview", onPreview);
		};
	}, []);

	useEffect(() => {
		const pending = previewPending.current;
		if (pending && pending.repo === repo) {
			previewPending.current = null;
			void filesBridge.current.openPath(pending.path).catch(() => undefined);
		}
	}, [repo]);

	function openSession(sessionID: string) {
		if (mode !== "session" || sessionID !== view.sessionID) resetAudioSession();
		setQuery("");
		clearQuestionDraft();
		setView((current) =>
			seedOpencodePrompts(
				{
					...current,
					sessionID,
					turns: current.sessionID === sessionID ? current.turns : [],
				},
				sessionID,
			),
		);
		setMode("session");
		pushCodeNav({ mode: "session", sessionID });
		if (field.current) {
			window.setTimeout(() => field.current?.focus(), 50);
		}
	}

	async function removeSession(sessionID: string) {
		if (!window.confirm(t("code.deleteConfirm"))) {
			return;
		}
		const removed = await run({ repo, op: "delete", sessionID });
		if (!removed) {
			return;
		}
		setView((current) => ({
			...current,
			sessions: current.sessions.filter((item) => item.id !== sessionID),
			sessionID: current.sessionID === sessionID ? "" : current.sessionID,
			turns: current.sessionID === sessionID ? [] : current.turns,
		}));
		if (mode === "session" && view.sessionID === sessionID) {
			setMode("home");
			replaceCodeNav({ mode: "home", sessionID: "" });
		}
	}

	function openDraft() {
		setPrompt("");
		clearQuestionDraft();
		setMode("draft");
		pushCodeNav({ mode: "draft", sessionID: "" });
		window.setTimeout(() => field.current?.focus(), 50);
	}

	function leaveChat() {
		if (codeNavBack()) {
			return;
		}
		setMode("home");
		replaceCodeNav({ mode: "home", sessionID: "" });
	}

	function selectModel(id: string) {
		const next = opencodeStoredModel(id);
		setModel(next);
		try {
			window.localStorage.setItem(OPENCODE_MODEL_KEY, next);
		} catch {
			return;
		}
	}

	function selectEffort(value: string) {
		const next = opencodeStoredEffort(value);
		setEffort(next);
		try {
			window.localStorage.setItem(OPENCODE_EFFORT_KEY, next);
		} catch {
			return;
		}
	}

	function selectPermissionMode(id: string) {
		const next = opencodeStoredPermissionMode(id);
		if (next === permissionMode) {
			return;
		}
		const previous = permissionMode;
		setPermissionMode(next);
		try {
			window.localStorage.setItem(OPENCODE_PERMISSION_MODE_KEY, next);
		} catch {
			return;
		}
		void run({ repo, op: "permission-mode", mode: next }).then((data) => {
			const record = data as { mode?: unknown } | null;
			if (!record || opencodePermissionMode(record.mode) !== next) {
				setPermissionMode(previous);
				try {
					window.localStorage.setItem(OPENCODE_PERMISSION_MODE_KEY, previous);
				} catch {
					return;
				}
				setError(t("code.permissionFailed"));
				return;
			}
			setPermissionMode(next);
		});
	}

	function toggleMenu(id: ChipMenuId) {
		setMenu((current) => (current === id ? "" : id));
	}

	useEffect(() => {
		if (!menu) {
			return;
		}
		if (menu === "project" && mode !== "draft") {
			setMenu("");
			return;
		}
		if (menu === "board" && devices.length < 2) {
			setMenu("");
			return;
		}
		if (
			menu === "effort" &&
			!opencodeModelChoices().find((item) => item.id === model)?.reasoning
		) {
			setMenu("");
			return;
		}
		function onPointer(event: PointerEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenu("");
			}
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setMenu("");
			}
		}
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [menu, mode, model, devices.length]);

	useEffect(() => {
		if (mode !== "session" || !view.sessionID) {
			return;
		}
		if (view.questions.length === 0 && view.permissions.length === 0) {
			return;
		}
		storeOpencodePrompts(view.sessionID, view.questions, view.permissions);
	}, [mode, view.sessionID, view.questions, view.permissions]);

	useEffect(() => {
		const active = view.questions.find(
			(item) => item.sessionID === view.sessionID,
		);
		const pending = active?.prompts ?? [];
		const id = active?.id ?? "";
		setPicks((current) => pruneCodePromptState(current, pending));
		setCustom((current) => pruneCodePromptState(current, pending));
		if (askedId.current !== id) {
			askedId.current = id;
			setSlide(0);
			setShowCustom(false);
			return;
		}
		setSlide((current) =>
			codeQuestionSlideIndex(current, Math.max(pending.length, 1), 0),
		);
	}, [view.questions, view.sessionID]);

	useEffect(() => {
		const active = view.questions.find(
			(item) => item.sessionID === view.sessionID,
		);
		if (!active) {
			return;
		}
		const pending = active.prompts;
		function onKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			const digit = Number.parseInt(event.key, 10);
			if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
				return;
			}
			const count = pending.length;
			const index = codeQuestionSlideIndex(slide, count, 0);
			const current = pending[index];
			const option = current?.options[digit - 1];
			if (!current || option === undefined) {
				return;
			}
			pickChoice(current.question, option);
		}
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
		};
	}, [view.questions, view.sessionID, slide, pickChoice]);

	const boardRef = useRef(selected);
	useEffect(() => {
		if (boardRef.current === selected) {
			return;
		}
		boardRef.current = selected;
		setMode("home");
		replaceCodeNav({ mode: "home", sessionID: "" });
	}, [selected]);

	useEffect(() => {
		function applyNav() {
			const next = readCodeNav(window.location.search);
			setMode(next.mode);
			if (next.sessionID) {
				const stored = readStoredOpencodePrompts(next.sessionID);
				setView((current) => ({
					...current,
					sessionID: next.sessionID,
					questions: current.questions.length
						? current.questions
						: stored.questions,
					permissions: current.permissions.length
						? current.permissions
						: stored.permissions,
					turns: current.sessionID === next.sessionID ? current.turns : [],
				}));
			}
		}
		applyNav();
		window.addEventListener("popstate", applyNav);
		return () => window.removeEventListener("popstate", applyNav);
	}, []);

	useEffect(() => {
		if (!selected || !repo) {
			setSessionsLoading(false);
			return;
		}
		let cancelled = false;
		const sessionID =
			readCodeNav(window.location.search).mode === "session"
				? readCodeNav(window.location.search).sessionID
				: "";
		if (sessionID) {
			setMode("session");
		}
		setView((current) => seedOpencodePrompts(current, sessionID));
		// Wipe any stale list so recovery never shows pre-outage sessions.
		setView((current) => ({ ...current, sessions: [] }));
		setError("");
		setSessionsLoading(true);
		void opencodeCall({ uuid: selected, repo, op: "sessions" })
			.then((data) => {
				if (cancelled) {
					return;
				}
				setSessionsLoading(false);
				const sessions = opencodeSessions(data);
				setView((current) => ({ ...current, sessions }));
			})
			.catch((caught) => {
				if (!cancelled) {
					setSessionsLoading(false);
					setError(caught instanceof Error ? caught.message : "request failed");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selected, repo, sessionsSeq]);

	useEffect(() => {
		if (!selected || !repo || mode !== "session" || !view.sessionID) {
			return;
		}
		let cancelled = false;
		const sessionID = view.sessionID;
		void opencodeCall({ uuid: selected, repo, op: "messages", sessionID })
			.then((data) => {
				if (cancelled) {
					return;
				}
				setView((current) => {
					if (current.sessionID !== sessionID) {
						return current;
					}
					const pending = pendingOpencodeFromMessages(
						data,
						sessionID,
						readStoredOpencodePrompts(sessionID),
					);
					storeOpencodePrompts(
						sessionID,
						pending.questions,
						pending.permissions,
					);
					const turns = settleOpencodeTurns(current.turns, opencodeTurns(data));
					if (
						turns.some(
							(turn) =>
								turn.role === "user" && codeHasSpeechDirective(turn.text),
						)
					) {
						speechDirectiveSentRef.current = sessionID;
					}
					return {
						...current,
						turns,
						questions: mergeOpencodeQuestions(
							current.questions,
							pending.questions,
							sessionID,
						),
						permissions: [
							...current.permissions.filter(
								(item) => item.sessionID !== sessionID,
							),
							...pending.permissions,
						],
					};
				});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selected, repo, mode, view.sessionID]);

	useEffect(() => {
		if (!selected || !repo) {
			return;
		}
		let socket: WebSocket | null = null;
		let lastEventId = "";
		let stopped = false;
		let wasReconnecting = false;
		async function loop() {
			while (!stopped) {
				let opened = false;
				try {
					const signed = await signOpencodeLive(selected, repo);
					if (stopped) {
						return;
					}
					const url = opencodeEventResumeUrl(signed.wsUrl, lastEventId);
					await new Promise<void>((resolve) => {
						const next = new WebSocket(url);
						socket = next;
						next.addEventListener("open", () => {
							opened = true;
							if (!stopped) {
								setReconnecting(false);
								if (wasReconnecting) {
									wasReconnecting = false;
									// Connection recovered: fetch all sessions and
									// wipe/replace the current list.
									setSessionsSeq((seq) => seq + 1);
								}
							}
						});
						next.addEventListener("message", (event) => {
							if (socket !== next) {
								return;
							}
							const frame = parseOpencodeEventFrame(String(event.data ?? ""));
							if (!frame) {
								return;
							}
							if (frame.id) {
								lastEventId = frame.id;
							}
							if (holdOpencodePromptEvent(frame.data, held.current)) {
								return;
							}
							rememberOpencodePrompt(frame.data);
							noteOpencodePrompt(frame.data, prompts.current);
							setView((current) => applyOpencodeEvent(current, frame.data));
						});
						next.addEventListener("close", () => {
							if (socket === next) {
								resolve();
							}
						});
						next.addEventListener("error", () => {
							if (!opened) {
								setError("opencode event stream unavailable");
							}
							next.close();
						});
					});
				} catch (caught) {
					if (stopped) {
						return;
					}
					wasReconnecting = true;
					setReconnecting(true);
					if (caught instanceof Error) {
						setError(caught.message);
					}
				}
				if (stopped) {
					return;
				}
				wasReconnecting = true;
				setReconnecting(true);
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
		}
		void loop();
		return () => {
			stopped = true;
			socket?.close();
		};
	}, [selected, repo]);

	const scrollKey = codeScrollKey(view.turns, view.permissions, view.questions);
	useLayoutEffect(() => {
		if (mode !== "session" || !view.sessionID || scrollKey < 0) {
			return;
		}
		const node = scroller.current;
		if (!node) {
			return;
		}
		const stick = () => {
			node.scrollTop = node.scrollHeight;
		};
		stick();
		const frame = requestAnimationFrame(stick);
		return () => cancelAnimationFrame(frame);
	}, [mode, view.sessionID, scrollKey]);

	async function run(call: Omit<OpencodeClientCall, "uuid">) {
		setError("");
		try {
			return await opencodeCall({ ...call, uuid: selected });
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
			return null;
		}
	}

	function shownError(message: string): string {
		const key = codeComposerErrorKey(message);
		if (key === "fileTooLarge") {
			return t("code.fileTooLarge");
		}
		if (key === "fileType") {
			return t("code.fileType");
		}
		if (key === "updateCompanion") {
			return t("code.updateCompanion");
		}
		if (key === "creditsEmpty") {
			return t("code.creditsEmpty");
		}
		if (key === "contextText") {
			return t("code.contextText");
		}
		return message;
	}

	function addBoardContext(path: string, text: string) {
		const staged = stageBoardContext({ path, text });
		setFiles((current) =>
			current.some(
				(item) => item.source === "board" && item.path === staged.path,
			)
				? current
				: [...current, staged],
		);
		setError("");
	}

	function handleEditorSelection(
		path: string,
		selection: CodeEditorSelection | null,
	) {
		if (!path) {
			return;
		}
		if (selection) {
			try {
				const staged = stageBoardContext({
					path,
					text: selection.text,
					startLine: selection.startLine,
					endLine: selection.endLine,
				});
				setFiles((current) => replaceBoardContext(current, staged));
				setError("");
			} catch {
				// Selection too large for context; keep the previous draft.
			}
			return;
		}
		if (!hasBoardSelectionDraft(files, path)) {
			return;
		}
		void filesBridge.current
			.textFor(path)
			.then((full) => stageBoardContext({ path, text: full }))
			.then((staged) => {
				setFiles((current) => replaceBoardContext(current, staged));
			})
			.catch(() => {
				setFiles((current) =>
					current.filter(
						(item) =>
							!(
								item.source === "board" &&
								item.path === path &&
								typeof item.startLine === "number" &&
								typeof item.endLine === "number"
							),
					),
				);
			});
	}

	async function pickMention(path: string) {
		const node = field.current;
		const value = node?.value ?? prompt;
		const cursor = node?.selectionStart ?? caret;
		const current = codeMentionAt(value, cursor);
		if (current) {
			setPrompt(applyCodeMention(value, current));
			setCaret(current.start);
		}
		setMentionOff("picked");
		try {
			addBoardContext(path, await filesBridge.current.textFor(path));
		} catch (caught) {
			if (current) {
				setPrompt(value);
				setCaret(cursor);
			}
			setError(shownError(caught instanceof Error ? caught.message : ""));
		}
	}

	async function addFiles(list: File[]) {
		const next = [...files];
		const taken = next.map((item) => item.path);
		for (const file of list) {
			try {
				const staged = stageCodeAttach({
					filename: file.name,
					bytes: new Uint8Array(await file.arrayBuffer()),
					taken,
				});
				taken.push(staged.path);
				next.push(staged);
			} catch (caught) {
				setError(
					shownError(caught instanceof Error ? caught.message : "file type"),
				);
				break;
			}
		}
		setFiles(next);
	}

	function startVoiceUtterance() {
		const engine = voiceEngine.current;
		if (!engine || voiceUtter.current) {
			return;
		}
		try {
			const rec = new MediaRecorder(engine.stream);
			const chunks: Blob[] = [];
			let cancelled = false;
			rec.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			rec.onstop = () => {
				voiceUtter.current = null;
				setVoiceListening(false);
				if (cancelled) {
					return;
				}
				const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
				void finishVoiceRef.current(blob);
			};
			voiceUtter.current = {
				recorder: rec,
				started: Date.now(),
				voiceAt: Date.now(),
				source: "ptt",
				cancel() {
					cancelled = true;
					try {
						rec.stop();
					} catch {
						voiceUtter.current = null;
						setVoiceListening(false);
					}
				},
			};
			rec.start();
			setVoiceListening(true);
		} catch {
			setVoiceListening(false);
		}
	}

	function stopVoiceUtterance() {
		const utter = voiceUtter.current;
		if (!utter) {
			return;
		}
		try {
			utter.recorder.stop();
		} catch {
			voiceUtter.current = null;
			setVoiceListening(false);
		}
	}

	function stopVoiceSpeech() {
		speechQueue.current?.cancel();
	}

	function clearSpeechQueue() {
		stopVoiceSpeech();
	}

	function markExistingSpeech() {
		for (const turn of view.turns) {
			if (turn.role !== "assistant") continue;
			if (!turn.pending) voiceSpoken.current.add(turn.id);
			speechSpoken.current.set(turn.id, codeSpeechBlocks(turn.text).length);
		}
	}

	function toggleReadAloud() {
		markExistingSpeech();
		setReadAloud(!readAloud);
		setVoiceReply(!readAloud);
		if (readAloud) clearSpeechQueue();
	}

	function resetAudioSession() {
		speechQueue.current?.reset();
		setReadAloud(false);
		setVoiceReply(false);
		voiceSpoken.current.clear();
		speechSpoken.current.clear();
		voiceQueue.current = [];
		setVoiceQueued(0);
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only on navigation; draft -> newly created session keeps its setting
	useEffect(() => {
		const previous = speechScope.current;
		if (
			previous.uuid !== selected ||
			previous.repo !== repo ||
			(mode === "home" && previous.mode !== "home") ||
			(previous.mode === "session" &&
				(mode !== "session" || previous.sessionID !== view.sessionID))
		) {
			resetAudioSession();
		}
		speechScope.current = {
			uuid: selected,
			repo,
			mode,
			sessionID: view.sessionID,
		};
	}, [selected, repo, mode, view.sessionID]);

	function stopVoiceEngine() {
		const engine = voiceEngine.current;
		voiceEngine.current = null;
		if (engine) {
			window.cancelAnimationFrame(engine.raf);
			for (const track of engine.stream.getTracks()) {
				track.stop();
			}
			void engine.context.close().catch(() => {});
		}
		voiceUtter.current?.cancel();
		voiceUtter.current = null;
		stopVoiceSpeech();
		setVoiceListening(false);
		setVoiceLevel(0);
	}

	function beginPtt() {
		if (voiceUtter.current || pttRef.current) {
			return;
		}
		pttRef.current = true;
		clearSpeechQueue();
		pttParts.current.clear();
		setPttHeld(true);
		if (voiceEngine.current) {
			startVoiceUtterance();
			return;
		}
		void (async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
				});
				const context = new AudioContext();
				await context.resume().catch(() => {});
				const analyser = context.createAnalyser();
				analyser.fftSize = 512;
				context.createMediaStreamSource(stream).connect(analyser);
				const data = new Float32Array(analyser.fftSize);
				const engine = { stream, context, analyser, data, raf: 0 };
				voiceEngine.current = engine;
				if (pttRef.current) {
					startVoiceUtterance();
				}
				const tick = () => {
					if (voiceEngine.current !== engine) {
						return;
					}
					voiceTickRef.current();
					engine.raf = requestAnimationFrame(tick);
				};
				engine.raf = requestAnimationFrame(tick);
			} catch {
				pttRef.current = false;
				setPttHeld(false);
				setError(t("code.micDenied"));
			}
		})();
	}

	function endPtt() {
		pttRef.current = false;
		setPttHeld(false);
		const utter = voiceUtter.current;
		if (utter?.source === "ptt") {
			stopVoiceUtterance();
			return;
		}
		if (pttPending.current > 0) {
			return;
		}
		void flushPttParts();
	}

	beginPttRef.current = beginPtt;
	endPttRef.current = endPtt;

	function pttSortedParts(): string[] {
		return [...pttParts.current.entries()]
			.sort((a, b) => a[0] - b[0])
			.map((entry) => entry[1])
			.filter(Boolean);
	}

	async function flushPttParts() {
		const parts = pttSortedParts();
		pttParts.current.clear();
		const combined = parts.join(" ").trim();
		if (combined) {
			await send(combined);
		}
	}

	async function settlePtt(heard: string, seq: number) {
		if (heard) {
			pttParts.current.set(seq, heard);
		}
		if (pttRef.current) {
			pttPending.current -= 1;
			return;
		}
		pttPending.current -= 1;
		if (pttPending.current > 0) {
			return;
		}
		await flushPttParts();
	}

	async function finishVoice(blob: Blob) {
		clearSpeechQueue();
		setVoiceTranscribing(true);
		const seq = pttSeq.current++;
		pttPending.current += 1;
		try {
			const heard = codeVoiceUtterance(
				(
					await transcribeCode(
						encodeBase64(new Uint8Array(await blob.arrayBuffer())),
						locale,
					)
				).text,
			);
			await settlePtt(heard, seq);
			return;
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
			await settlePtt("", seq);
		} finally {
			setVoiceTranscribing(false);
		}
	}

	finishVoiceRef.current = finishVoice;
	stopVoiceEngineRef.current = stopVoiceEngine;

	// biome-ignore lint/correctness/useExhaustiveDependencies: tears the mic engine down on unmount through refs
	useEffect(() => {
		return () => {
			stopVoiceEngineRef.current();
		};
	}, []);

	function playSpeech(audio: string): CodeSpeechPlayer {
		const player = new Audio(`data:audio/mpeg;base64,${audio}`);
		let finish = () => {};
		let fail = (_error: unknown) => {};
		const finished = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
		let released = false;
		let paused = false;
		const done = (error?: unknown) => {
			if (released) return;
			released = true;
			player.onended = null;
			player.onerror = null;
			player.onplaying = null;
			player.onwaiting = null;
			player.pause();
			if (voiceSpeaking.current === player) voiceSpeaking.current = null;
			if (error) fail(error);
			else finish();
		};
		const failedPlay = (error: unknown) => {
			if (
				paused &&
				error instanceof DOMException &&
				error.name === "AbortError"
			)
				return;
			done(error);
		};
		player.onended = () => done();
		player.onerror = () => done(new Error("speech failed"));
		player.onplaying = () => speechQueue.current?.playback(true);
		player.onwaiting = () => speechQueue.current?.playback(false, true);
		voiceSpeaking.current = player;
		void player.play().catch(failedPlay);
		return {
			finished,
			pause: () => {
				paused = true;
				player.pause();
			},
			resume: () => {
				paused = false;
				void player.play().catch(failedPlay);
			},
			stop: () => done(),
		};
	}

	function enqueueSpeech(text: string) {
		for (const chunk of codeSpeechChunks(text))
			speechQueue.current?.enqueue(chunk);
	}

	function voiceTick() {
		const live = voiceEngine.current;
		if (!live) {
			return;
		}
		live.analyser.getFloatTimeDomainData(live.data);
		let sum = 0;
		for (let i = 0; i < live.data.length; i += 1) {
			const sample = live.data[i] ?? 0;
			sum += sample * sample;
		}
		const rms = Math.sqrt(sum / live.data.length);
		const level = Math.max(0, Math.min(1, rms * 8));
		const bucket = Math.round(level * 12);
		if (bucket !== voiceShown.current) {
			voiceShown.current = bucket;
			setVoiceLevel(level);
		}
		// PTT records until release (or the 60s cap); only the cap can end it.
		const utter = voiceUtter.current;
		if (utter && Date.now() - utter.started > CODE_VOICE_MAX_MS) {
			stopVoiceUtterance();
		}
	}

	voiceTickRef.current = voiceTick;

	// Tear the mic engine down when leaving the chat so the mic light never sticks.
	useEffect(() => {
		if (mode === "home") {
			stopVoiceEngineRef.current();
		}
	}, [mode]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: drains the voice queue through refs and send()
	useEffect(() => {
		if (view.busy || uploading) {
			return;
		}
		if (voiceQueue.current.length === 0) {
			return;
		}
		const next = voiceQueue.current.shift();
		setVoiceQueued(voiceQueue.current.length);
		if (!next) {
			return;
		}
		const timer = window.setTimeout(() => {
			void send(next);
		}, 200);
		return () => {
			window.clearTimeout(timer);
		};
	}, [view.busy, uploading, view.sessionID]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: streams <speech> blocks through refs and enqueueSpeech()
	useEffect(() => {
		if (!voiceReply) {
			return;
		}
		if (voiceUtter.current) {
			return;
		}
		for (const turn of view.turns) {
			if (turn.role !== "assistant") {
				continue;
			}
			const blocks = codeSpeechBlocks(turn.text);
			const spoken = speechSpoken.current.get(turn.id) ?? 0;
			if (blocks.length <= spoken) {
				continue;
			}
			speechSpoken.current.set(turn.id, blocks.length);
			for (let index = spoken; index < blocks.length; index += 1) {
				enqueueSpeech(blocks[index] ?? "");
			}
		}
	}, [voiceReply, view.turns]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: speaks settled turns through refs and enqueueSpeech()
	useEffect(() => {
		if (!voiceReply) {
			return;
		}
		if (voiceUtter.current) {
			return;
		}
		if (view.busy || uploading) {
			return;
		}
		if (
			view.questions.some((item) => item.sessionID === view.sessionID) ||
			view.permissions.some((item) => item.sessionID === view.sessionID)
		) {
			return;
		}
		const turn = [...view.turns]
			.reverse()
			.find(
				(item) =>
					item.role === "assistant" &&
					!item.pending &&
					!voiceSpoken.current.has(item.id),
			);
		if (!turn) {
			return;
		}
		voiceSpoken.current.add(turn.id);
		const blocks = codeSpeechBlocks(turn.text);
		if (blocks.length > 0) {
			const spoken = speechSpoken.current.get(turn.id) ?? 0;
			for (let index = spoken; index < blocks.length; index += 1) {
				enqueueSpeech(blocks[index] ?? "");
			}
			speechSpoken.current.set(turn.id, blocks.length);
			return;
		}
		enqueueSpeech(turn.text);
	}, [
		voiceReply,
		view.busy,
		uploading,
		view.turns,
		view.questions,
		view.permissions,
		view.sessionID,
	]);

	useEffect(() => {
		function typing(event: Event) {
			const target = event.target as HTMLElement | null;
			return Boolean(
				target &&
					(target.tagName === "INPUT" ||
						target.tagName === "TEXTAREA" ||
						target.isContentEditable),
			);
		}
		function onDown(event: KeyboardEvent) {
			if (event.code !== "Space" || mode === "home" || typing(event)) {
				return;
			}
			event.preventDefault();
			if (event.repeat) {
				return;
			}
			beginPttRef.current();
		}
		function onUp(event: KeyboardEvent) {
			if (event.code !== "Space" || !pttRef.current) {
				return;
			}
			endPttRef.current();
		}
		document.addEventListener("keydown", onDown);
		document.addEventListener("keyup", onUp);
		return () => {
			document.removeEventListener("keydown", onDown);
			document.removeEventListener("keyup", onUp);
		};
	}, [mode]);

	useEffect(() => {
		if (!pttHeld) {
			return;
		}
		const release = () => endPttRef.current();
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		return () => {
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
		};
	}, [pttHeld]);

	async function send(override?: string) {
		const typed = (override ?? prompt).trim();
		const staged = files;
		if (!typed && staged.length === 0) {
			return;
		}
		if (!repo) {
			return;
		}
		if (view.busy || uploading) {
			if (override) {
				voiceQueue.current.push(override);
				setVoiceQueued(voiceQueue.current.length);
			}
			return;
		}
		setUploading(true);
		if (!override) {
			setPrompt("");
		}
		setFiles([]);
		if (field.current) {
			field.current.style.height = "24px";
		}
		let text = "";
		// Speech directive is injected once per session: the first voice-directed
		// message carries it, later turns keep it from the transcript.
		const wantsSpeech = readAloud || Boolean(override);
		const existingSessionID = mode === "session" ? view.sessionID : "";
		const injectSpeechDirective =
			wantsSpeech &&
			(!existingSessionID ||
				speechDirectiveSentRef.current !== existingSessionID);
		try {
			text = codeAttachPrompt(typed, staged);
			text = codeAppendSpeechDirective(
				text,
				injectSpeechDirective,
				voiceProvider,
			);
			speechQueue.current?.reset();
			markExistingSpeech();
			setVoiceReply(wantsSpeech);
		} catch (caught) {
			setPrompt(typed);
			setFiles(staged);
			setUploading(false);
			setError(shownError(caught instanceof Error ? caught.message : ""));
			return;
		}
		try {
			for (const file of staged.filter((item) => item.use !== "context")) {
				await uploadBoardFile(selected, repo, file.path, {
					...(file.base64
						? { base64: file.base64 }
						: { text: file.text ?? "" }),
				});
			}
		} catch (caught) {
			setPrompt(typed);
			setFiles(staged);
			setUploading(false);
			setError(shownError(caught instanceof Error ? caught.message : ""));
			return;
		}
		setUploading(false);
		let sessionID = mode === "session" ? view.sessionID : "";
		if (!sessionID) {
			const data = await run({ repo, op: "create" });
			const created = opencodeSessions(data ? [data] : [])[0];
			if (!created) {
				setPrompt(text);
				return;
			}
			sessionID = created.id;
			setView((current) => ({
				...current,
				sessions: [
					created,
					...current.sessions.filter((item) => item.id !== created.id),
				],
				sessionID: created.id,
				turns: [],
				busy: false,
			}));
			setMode("session");
			replaceCodeNav({ mode: "session", sessionID });
		}
		setView((current) => ({
			...current,
			busy: true,
			turns: [...current.turns, pendingOpencodeTurn(text)],
		}));
		const sent = await run({
			repo,
			op: "prompt",
			sessionID,
			text,
			...opencodePromptFields(model, effort),
		});
		if (!sent) {
			setView((current) => ({ ...current, busy: false }));
		}
		if (sent && injectSpeechDirective) {
			speechDirectiveSentRef.current = sessionID;
		}
	}

	async function abort() {
		if (!view.sessionID) {
			return;
		}
		await run({ repo, op: "abort", sessionID: view.sessionID });
		setView((current) => ({ ...current, busy: false }));
	}

	function beginReply() {
		if (replying.current) {
			return false;
		}
		replying.current = true;
		setReplyBusy(true);
		return true;
	}

	function endReply() {
		replying.current = false;
		setReplyBusy(false);
	}

	async function quietOpencode(call: Omit<OpencodeClientCall, "uuid">) {
		try {
			return await opencodeCall({ ...call, uuid: selected });
		} catch {
			return undefined;
		}
	}

	async function recoverPrompts(sessionID: string) {
		if (!selected || !repo || !sessionID) {
			return;
		}
		const [questions, permissions, messages] = await Promise.all([
			quietOpencode({ repo, op: "questions" }),
			quietOpencode({ repo, op: "permissions" }),
			quietOpencode({ repo, op: "messages", sessionID }),
		]);
		setView((current) => {
			if (current.sessionID !== sessionID) {
				return current;
			}
			const next = recoverOpencodePrompts(current, sessionID, {
				...(questions === undefined ? {} : { questions }),
				...(permissions === undefined ? {} : { permissions }),
				...(messages === undefined ? {} : { messages }),
			});
			storeOpencodePrompts(sessionID, next.questions, next.permissions);
			for (const item of [...next.questions, ...next.permissions]) {
				if (item.sessionID !== sessionID) {
					continue;
				}
				held.current.add(item.id);
				if (item.callID) {
					held.current.add(item.callID);
				}
			}
			releaseSettledPromptHolds(held.current, next, sessionID);
			return next;
		});
	}

	async function replyPermission(
		permissionID: string,
		response: OpencodePermissionResponse,
	) {
		if (!beginReply()) {
			return;
		}
		const sessionID = view.sessionID;
		held.current.add(permissionID);
		try {
			const sent = await run({
				repo,
				op: "permission",
				sessionID,
				permissionID,
				response,
			});
			if (!opencodeReplyAccepted(sent)) {
				await recoverPrompts(sessionID);
				return;
			}
			held.current.delete(permissionID);
			setView((current) => ({
				...current,
				permissions: current.permissions.filter(
					(item) => item.id !== permissionID,
				),
			}));
		} finally {
			endReply();
		}
	}

	const needle = query.trim().toLowerCase();
	const matches = needle ? filterCodeSessions(view.sessions, query) : [];
	const visibleSessions = needle
		? filterCodeSessions(view.sessions, query)
		: view.sessions;
	const bucketTitle = {
		today: t("code.today"),
		yesterday: t("code.yesterday"),
		earlier: t("code.earlier"),
	};
	const grouped = (["today", "yesterday", "earlier"] as const)
		.map((id) => ({
			id,
			title: bucketTitle[id],
			sessions: visibleSessions.filter(
				(item) => opencodeSessionBucket(item.updated) === id,
			),
		}))
		.filter((group) => group.sessions.length > 0);
	const title = codeSessionTitle(
		view.sessions,
		view.sessionID,
		t("code.sessions"),
	);
	const permission = view.permissions.find(
		(item) => item.sessionID === view.sessionID,
	);
	const question = activeOpencodeQuestion(view.questions, view.sessionID);
	const lastTurn = view.turns.at(-1)?.id;

	function effortLabel(value: ReasoningEffort) {
		if (value === "low") {
			return t("code.effortLow");
		}
		if (value === "high") {
			return t("code.effortHigh");
		}
		return t("code.effortMedium");
	}

	function modelSelects() {
		const choices = opencodeModelChoices();
		const chosen = choices.find((item) => item.id === model);
		const reasoning = chosen?.reasoning === true;
		return (
			<>
				<ChipMenu
					open={menu === "permission"}
					label={t("code.permissionMode")}
					value={
						permissionMode === "full"
							? t("code.permissionFull")
							: t("code.permissionAsk")
					}
					selected={permissionMode}
					options={OPENCODE_PERMISSION_MODES.map((id) => ({
						id,
						name:
							id === "full"
								? t("code.permissionFull")
								: t("code.permissionAsk"),
						hint: id === "full" ? t("code.permissionFullHint") : undefined,
					}))}
					menuRef={menuRef}
					onOpen={() => toggleMenu("permission")}
					onPick={(id) => {
						selectPermissionMode(id);
						setMenu("");
					}}
				/>
				<ChipMenu
					open={menu === "model"}
					label={t("code.model")}
					value={chosen?.name ?? model}
					hint={chosen?.provider}
					selected={model}
					options={choices.map((item) => ({
						id: item.id,
						name: item.name,
						hint: item.provider,
					}))}
					menuRef={menuRef}
					onOpen={() => toggleMenu("model")}
					onPick={(id) => {
						selectModel(id);
						setMenu("");
					}}
				/>
				{reasoning ? (
					<ChipMenu
						open={menu === "effort"}
						label={t("code.effort")}
						value={effortLabel(effort)}
						selected={effort}
						options={(["low", "medium", "high"] as const).map((id) => ({
							id,
							name: effortLabel(id),
						}))}
						menuRef={menuRef}
						onOpen={() => toggleMenu("effort")}
						onPick={(id) => {
							selectEffort(id);
							setMenu("");
						}}
					/>
				) : null}
			</>
		);
	}

	function selectsSummary() {
		const chosen = opencodeModelChoices().find((item) => item.id === model);
		const parts = [
			chosen?.name ?? model,
			permissionMode === "full"
				? t("code.permissionFull")
				: t("code.permissionAsk"),
		];
		if (chosen?.reasoning === true) {
			parts.push(effortLabel(effort));
		}
		return parts.join(" · ");
	}

	function renderSelects(children: ReactNode) {
		return (
			<div className={`oc-selects${selectsOpen ? " is-open" : ""}`}>
				<button
					type="button"
					className="oc-selects-toggle"
					aria-expanded={selectsOpen}
					aria-label={t("code.model")}
					onClick={() => {
						setMenu("");
						setSelectsOpen((open) => !open);
					}}
				>
					<span className="oc-selects-summary">{selectsSummary()}</span>
					<span aria-hidden="true">{selectsOpen ? "▴" : "▾"}</span>
				</button>
				<div className="oc-chips">{children}</div>
			</div>
		);
	}

	function composer(disabled: boolean, blocked = false) {
		const sendDisabled =
			!view.busy &&
			((!prompt.trim() && files.length === 0) ||
				disabled ||
				blocked ||
				uploading);
		const toolsDisabled = disabled || blocked || uploading;
		const mention = codeMentionAt(prompt, caret);
		const mentionKey = mention ? `${mention.start}:${mention.query}` : "";
		const mentionLive =
			Boolean(mention) && mentionOff !== mentionKey && !toolsDisabled;
		const matches =
			mentionLive && mention
				? filterCodeMentions(boardPaths, mention.query)
				: [];
		// PTT-only voice: the mic lives in the send button when the input is
		// empty. Hold it (or Space) and release to auto-send; the reply is
		// spoken back. No continuous voice mode, no dictate-insert.
		const active = matches.length === 0 ? 0 : mentionIndex % matches.length;
		const micEmpty =
			!view.busy && !prompt.trim() && files.length === 0 && !blocked;
		const voicePhase =
			pttHeld || voiceListening
				? "listening"
				: voiceTranscribing
					? "processing"
					: voiceSpeakingNow
						? "speaking"
						: view.busy || uploading
							? "waiting"
							: "idle";
		const voiceLabel = voiceTranscribing
			? t("code.voiceTranscribing")
			: pttHeld || voiceListening
				? t("code.voiceListening")
				: t("code.voiceUser");
		const agentLabel = speechStatus.paused
			? t("code.voicePaused")
			: speechStatus.preparing
				? t("code.voicePreparing")
				: voiceSpeakingNow
					? t("code.voiceSpeaking")
					: view.busy && voiceReply
						? t("code.voiceThinking")
						: speechStatus.canReplay
							? t("code.voiceReady")
							: t("code.voiceAgent");
		return (
			<div
				className="oc-compose"
				onDragOver={(event) => {
					event.preventDefault();
				}}
				onDrop={(event) => {
					event.preventDefault();
					if (toolsDisabled) {
						return;
					}
					void addFiles([...event.dataTransfer.files]);
				}}
			>
				{mentionLive ? (
					<div
						className="oc-mention"
						role="listbox"
						aria-label={t("code.files")}
					>
						{matches.length === 0 ? (
							<p className="oc-editor-note">{t("code.mentionEmpty")}</p>
						) : (
							matches.map((path, index) => (
								<button
									key={path}
									type="button"
									role="option"
									aria-selected={index === active}
									className={index === active ? "is-on" : undefined}
									onMouseDown={(event) => {
										event.preventDefault();
										void pickMention(path);
									}}
								>
									<span>{path.split("/").pop()}</span>
									<span className="oc-model-provider">{path}</span>
								</button>
							))
						)}
					</div>
				) : null}
				{files.length > 0 ? (
					<div className="oc-file-row">
						{files.map((file) => (
							<span key={file.id} className="oc-file-chip">
								<span title={file.path}>
									{file.source === "board" ? file.path : file.name}
									{file.source === "board" &&
									typeof file.startLine === "number" &&
									typeof file.endLine === "number"
										? ` L${file.startLine}–${file.endLine}`
										: ""}
								</span>
								{file.source === "board" ? null : (
									<button
										type="button"
										className="oc-file-use"
										aria-label={
											file.use === "context"
												? t("code.attachUseBoard", { name: file.name })
												: t("code.attachUseContext", { name: file.name })
										}
										disabled={uploading}
										onClick={() =>
											setFiles((current) =>
												current.map((item) =>
													item.id === file.id
														? {
																...item,
																use:
																	item.use === "context"
																		? "project"
																		: "context",
															}
														: item,
												),
											)
										}
									>
										{file.use === "context"
											? t("code.attachContext")
											: t("code.attachBoard")}
									</button>
								)}
								<button
									type="button"
									aria-label={t("code.removeFile", { name: file.name })}
									disabled={uploading}
									onClick={() =>
										setFiles((current) =>
											current.filter((item) => item.id !== file.id),
										)
									}
								>
									×
								</button>
							</span>
						))}
					</div>
				) : null}
				<div className="oc-audio-toolbar">
					<button
						type="button"
						className="oc-read-aloud"
						role="switch"
						aria-checked={readAloud}
						title={t("code.readAloudHint")}
						disabled={disabled}
						onClick={toggleReadAloud}
					>
						<span className="oc-audio-switch" aria-hidden="true" />
						{t("code.readAloud")}
					</button>
					{speechStatus.canReplay ? (
						<div className="oc-audio-controls">
							{speechStatus.paused ||
							speechStatus.speaking ||
							speechStatus.preparing ? (
								<button
									type="button"
									disabled={pttHeld || voiceTranscribing}
									onClick={() =>
										speechStatus.paused
											? speechQueue.current?.resume()
											: speechQueue.current?.pause()
									}
								>
									{t(
										speechStatus.paused
											? "code.voiceResume"
											: "code.voicePause",
									)}
								</button>
							) : null}
							<button
								type="button"
								disabled={pttHeld || voiceTranscribing}
								onClick={() => speechQueue.current?.replay()}
							>
								{t("code.voiceReplay")}
							</button>
						</div>
					) : null}
				</div>
				{readAloud || voiceTranscribing || pttHeld || speechStatus.canReplay ? (
					<div className="oc-voice oc-audio-strip" aria-live="polite">
						<span
							className={`oc-voice-bars oc-user-wave is-${voicePhase}`}
							aria-hidden="true"
						>
							{[0, 1, 2, 3, 4, 5, 6].map((bar) => (
								<i
									key={bar}
									style={
										voiceTranscribing
											? undefined
											: {
													transform: `scaleY(${(
														0.2 +
															(pttHeld ? voiceLevel : 0) *
																(1 - Math.abs(bar - 3) / 4) *
																0.8
													).toFixed(2)})`,
												}
									}
								/>
							))}
						</span>
						<span className="oc-voice-label">
							{voiceQueued > 0
								? `${t("code.voiceQueued", { n: voiceQueued })} · `
								: ""}
							{voiceLabel}
						</span>
						<span className="oc-voice-label oc-agent-label">{agentLabel}</span>
						<span
							className={`oc-voice-bars oc-agent-wave${voiceSpeakingNow ? " is-playing" : ""}${speechStatus.paused ? " is-paused" : ""}`}
							aria-hidden="true"
						>
							{[0, 1, 2, 3, 4, 5, 6].map((bar) => (
								<i key={bar} style={{ animationDelay: `${bar * -0.13}s` }} />
							))}
						</span>
					</div>
				) : null}
				<div className="oc-composer">
					<input
						ref={picker}
						type="file"
						multiple
						hidden
						accept={CODE_ATTACH_ACCEPT}
						onChange={(event) => {
							const picked = [...(event.target.files ?? [])];
							event.target.value = "";
							void addFiles(picked);
						}}
					/>
					<button
						type="button"
						className="oc-tool"
						aria-label={t("code.attach")}
						disabled={toolsDisabled}
						onClick={() => picker.current?.click()}
					>
						<AttachIcon />
					</button>
					<textarea
						ref={field}
						rows={1}
						value={prompt}
						placeholder={t("code.placeholder")}
						disabled={disabled}
						aria-label={t("code.prompt")}
						onChange={(event) => {
							setPrompt(event.target.value);
							setCaret(
								event.target.selectionStart ?? event.target.value.length,
							);
							event.target.style.height = "0px";
							event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
						}}
						onSelect={(event) =>
							setCaret(event.currentTarget.selectionStart ?? 0)
						}
						onKeyDown={(event) => {
							if (mentionLive && event.key === "Escape") {
								event.preventDefault();
								setMentionOff(mentionKey);
								return;
							}
							if (
								mentionLive &&
								matches.length > 0 &&
								(event.key === "ArrowDown" || event.key === "ArrowUp")
							) {
								event.preventDefault();
								setMentionIndex((index) => {
									const next =
										event.key === "ArrowDown" ? index + 1 : index - 1;
									return (next + matches.length) % matches.length;
								});
								return;
							}
							if (
								mentionLive &&
								matches.length > 0 &&
								(event.key === "Enter" || event.key === "Tab") &&
								!event.shiftKey
							) {
								event.preventDefault();
								const picked = matches[active];
								if (picked) {
									void pickMention(picked);
								}
								return;
							}
							if (event.key === "Escape" && blocked) {
								event.currentTarget.blur();
								return;
							}
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								if (!view.busy && !blocked) {
									void send();
								}
							}
						}}
					/>
					<button
						type="button"
						className={`oc-send${view.busy ? " is-stop" : ""}${micEmpty ? " is-mic" : ""}`}
						aria-label={
							view.busy
								? t("code.stop")
								: micEmpty
									? t("code.ptt")
									: t("code.send")
						}
						disabled={
							view.busy ? false : micEmpty ? toolsDisabled : sendDisabled
						}
						title={
							micEmpty
								? t("code.pttHint")
								: blocked
									? t("code.blockedComposer")
									: undefined
						}
						onPointerDown={
							micEmpty
								? (event) => {
										event.preventDefault();
										beginPttRef.current();
									}
								: undefined
						}
						onClick={() => {
							if (view.busy) {
								void abort();
								return;
							}
							// Mic release is handled by the global pointerup listener
							// (endPtt auto-sends); a plain click does nothing.
							if (!micEmpty) {
								void send();
							}
						}}
					>
						{view.busy ? <StopIcon /> : micEmpty ? <MicIcon /> : <SendIcon />}
					</button>
				</div>
				{micEmpty ? <p className="oc-ptt-hint">{t("code.pttHint")}</p> : null}
			</div>
		);
	}

	async function questionRequestID(current: {
		id: string;
		sessionID: string;
		callID?: string;
		prompts: { question: string }[];
	}) {
		if (current.id.startsWith("que")) {
			return current.id;
		}
		const listed = await run({ repo, op: "questions" });
		if (!listed) {
			return "";
		}
		const requestID = matchOpencodeQuestionID(
			current,
			opencodeQuestions(listed) ?? [],
		);
		if (!requestID) {
			setError(t("code.questionNotReady"));
		}
		return requestID;
	}

	function answerQuestion(reject: boolean) {
		if (!question || replying.current) {
			return;
		}
		const current = question;
		if (!reject && current.prompts.some((item) => !promptAnswer(item))) {
			return;
		}
		if (!beginReply()) {
			return;
		}
		const sessionID = current.sessionID;
		held.current.add(current.id);
		void questionRequestID(current)
			.then(async (requestID) => {
				if (!requestID) {
					held.current.delete(current.id);
					await recoverPrompts(sessionID);
					return;
				}
				held.current.add(requestID);
				const sent = await run({
					repo,
					op: "question",
					requestID,
					...(reject
						? { reject: true }
						: {
								answers: current.prompts.map((item) => [promptAnswer(item)]),
							}),
				});
				if (!opencodeReplyAccepted(sent)) {
					await recoverPrompts(sessionID);
					return;
				}
				held.current.delete(current.id);
				held.current.delete(requestID);
				clearQuestionDraft();
				setView((viewCurrent) => ({
					...viewCurrent,
					questions: viewCurrent.questions.filter(
						(item) => item.id !== current.id && item.id !== requestID,
					),
				}));
			})
			.finally(() => {
				endReply();
			});
	}

	if (!selected) {
		return (
			<div className="oc-shell">
				<div className="oc-card">
					<div className="oc-empty">
						<p>{t("code.pickBoard")}</p>
					</div>
				</div>
			</div>
		);
	}

	const owner = codeRepoOwner(repos, repo);
	return (
		<div className="oc-shell">
			{devices.length > 1 ? (
				<div className="oc-boardbar">
					<ChipMenu
						open={menu === "board"}
						label={t("code.board")}
						value={boardChipName(
							devices.find((item) => item.uuid === selected),
						)}
						hint={boardChipHint(
							devices.find((item) => item.uuid === selected),
							boards.find((item) => item.device.uuid === selected)?.status
								?.model,
						)}
						selected={selected}
						options={devices.map((item) => ({
							id: item.uuid,
							name: boardChipName(item),
							hint: boardChipHint(
								item,
								boards.find((board) => board.device.uuid === item.uuid)?.status
									?.model,
							),
						}))}
						menuRef={menuRef}
						place="down"
						onOpen={() => toggleMenu("board")}
						onPick={(id) => {
							setUuid(id);
							setMenu("");
						}}
					/>
				</div>
			) : null}
			<div className="oc-card">
				<ProjectFiles
					uuid={selected}
					owner={owner}
					name={repo}
					bridge={filesBridge}
					onEntries={rememberEntries}
					onAddContext={addBoardContext}
					onEditorSelection={handleEditorSelection}
					onContextRenamed={(from, to) =>
						setFiles((current) => renameContextDrafts(current, from, to))
					}
					onContextRemoved={(path) =>
						setFiles((current) => removeContextDrafts(current, path))
					}
				>
					{error && mode === "home" ? (
						<p className="oc-error">
							<span>{error}</span>
							<button
								type="button"
								aria-label={t("code.dismiss")}
								onClick={() => setError("")}
							>
								{t("code.dismiss")}
							</button>
						</p>
					) : null}
					{mode === "home" ? (
						<div className="oc-home">
							<aside className="oc-projects" aria-label={t("code.projects")}>
								<div className="oc-label">{t("code.projects")}</div>
								{repos.length === 0 ? (
									<div className="oc-empty">
										<p className="oc-muted">{t("code.noProjects")}</p>
										<button
											type="button"
											className="oc-neutral"
											onClick={() => onOpenProject?.()}
										>
											{t("code.openProject")}
										</button>
									</div>
								) : (
									repos.map((item) => (
										<button
											key={`${item.owner}/${item.name}`}
											type="button"
											className={`oc-row${item.name === repo ? " is-active" : ""}`}
											title={codeRepoLabel(item)}
											aria-current={item.name === repo ? "true" : undefined}
											onClick={() => remember(item.name)}
										>
											<span className="oc-session-title">{item.name}</span>
											{item.owner ? (
												<span className="oc-session-time">{item.owner}</span>
											) : null}
										</button>
									))
								)}
							</aside>
							<section className="oc-sessions" aria-label={t("code.sessions")}>
								<div className="oc-sessions-head">
									<label className="oc-search">
										<SearchIcon />
										<input
											value={query}
											placeholder={t("code.search")}
											aria-label={t("code.search")}
											onFocus={() => setSearching(true)}
											onBlur={() => setSearching(false)}
											onChange={(event) => setQuery(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Escape") {
													setQuery("");
													event.currentTarget.blur();
												}
											}}
										/>
										{query ? (
											<button
												type="button"
												className="oc-session-delete"
												aria-label={t("code.clear")}
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => setQuery("")}
											>
												{t("code.clear")}
											</button>
										) : null}
									</label>
									<button
										type="button"
										className="oc-ghost"
										disabled={!repo}
										onClick={openDraft}
									>
										{t("code.newSession")}
									</button>
									{searching && needle ? (
										<div className="oc-results">
											{matches.length === 0 ? (
												<p className="oc-muted">{t("code.searchEmpty")}</p>
											) : (
												matches.map((session) => (
													<div key={session.id} className="oc-row">
														<button
															type="button"
															className="oc-session-open"
															onMouseDown={(event) => event.preventDefault()}
															onClick={() => openSession(session.id)}
														>
															<span className="oc-session-title">
																{session.title}
															</span>
														</button>
														<button
															type="button"
															className="oc-session-delete"
															aria-label={t("code.deleteSession")}
															onMouseDown={(event) => event.preventDefault()}
															onClick={() => void removeSession(session.id)}
														>
															{t("code.delete")}
														</button>
													</div>
												))
											)}
										</div>
									) : null}
								</div>
								<div className="oc-status">
									<i aria-hidden="true" />
									{reconnecting ? t("code.reconnecting") : t("code.live")}
									{needle ? (
										<span className="oc-session-time">
											{t("code.resultCount", { n: visibleSessions.length })}
										</span>
									) : null}
									{reconnecting || error ? (
										<button
											type="button"
											className="oc-session-delete"
											aria-label={t("code.retry")}
											onClick={() => {
												setError("");
												setReconnecting(false);
												setSessionsSeq((seq) => seq + 1);
											}}
										>
											{t("code.retry")}
										</button>
									) : null}
								</div>
								<div className="oc-session-list">
									{sessionsLoading ? (
										<div className="oc-empty" aria-busy="true">
											<p className="oc-muted">{t("code.sessionLoading")}</p>
											<div className="oc-skel" />
											<div className="oc-skel" />
										</div>
									) : view.sessions.length === 0 ? (
										<div className="oc-empty">
											<strong>{t("code.emptyTitle")}</strong>
											<p className="oc-muted">{t("code.emptyBody")}</p>
											<button
												type="button"
												className="oc-neutral"
												disabled={!repo}
												onClick={openDraft}
											>
												{t("code.newSession")}
											</button>
										</div>
									) : (
										grouped.map((group) => (
											<div key={group.id} className="oc-bucket">
												<div className="oc-group">{group.title}</div>
												{group.sessions.map((session) => (
													<div
														key={session.id}
														className={`oc-row${session.id === view.sessionID ? " is-active" : ""}`}
													>
														<button
															type="button"
															className="oc-session-open"
															onClick={() => openSession(session.id)}
														>
															<span className="oc-session-title">
																{session.title}
															</span>
															{session.updated ? (
																<time
																	className="oc-session-time"
																	dateTime={new Date(
																		session.updated,
																	).toISOString()}
																>
																	{formatSessionTime(session.updated)}
																</time>
															) : null}
														</button>
														<button
															type="button"
															className="oc-session-delete"
															aria-label={t("code.deleteSession")}
															onClick={() => void removeSession(session.id)}
														>
															{t("code.delete")}
														</button>
													</div>
												))}
											</div>
										))
									)}
								</div>
							</section>
						</div>
					) : null}
					{mode === "draft" ? (
						<div className="oc-draft">
							<div className="oc-session-bar">
								<button type="button" className="oc-back" onClick={leaveChat}>
									<BackIcon />
									{t("code.back")}
								</button>
							</div>
							<div className="oc-draft-body">
								{error ? (
									<p className="oc-error">
										<span>{error}</span>
										<button
											type="button"
											aria-label={t("code.dismiss")}
											onClick={() => setError("")}
										>
											{t("code.dismiss")}
										</button>
									</p>
								) : null}
								{composer(!repo)}
								<p className="oc-muted">{t("code.draftHint")}</p>
								{renderSelects(
									<>
										<ChipMenu
											open={menu === "project"}
											label={t("code.project")}
											value={codeRepoLabel(
												repos.find((item) => item.name === repo) ?? {
													owner: "",
													name: repo,
												},
											)}
											selected={repo}
											options={repos.map((item) => ({
												id: item.name,
												name: codeRepoLabel(item),
											}))}
											menuRef={menuRef}
											onOpen={() => toggleMenu("project")}
											onPick={(id) => {
												selectRepo(id);
												setMenu("");
											}}
										/>
										{modelSelects()}
									</>,
								)}
							</div>
						</div>
					) : null}
					{mode === "session" ? (
						<div className="oc-session">
							<div className="oc-session-bar">
								<button type="button" className="oc-back" onClick={leaveChat}>
									<BackIcon />
									{t("code.back")}
								</button>
								<strong title={title}>{title}</strong>
								<span className={`oc-status${reconnecting ? " is-wait" : ""}`}>
									<i aria-hidden="true" />
									{reconnecting ? t("code.reconnecting") : t("code.live")}
								</span>
							</div>
							<div className="oc-transcript" ref={scroller}>
								{view.turns.map((turn) => (
									<TurnView
										key={turn.id}
										turn={turn}
										caret={view.busy && turn.id === lastTurn}
									/>
								))}
								{view.busy && view.turns.length === 0 ? (
									<span className="oc-caret" />
								) : null}
							</div>
							{error ? (
								<p className="oc-error">
									<span>{error}</span>
									<button
										type="button"
										aria-label={t("code.dismiss")}
										onClick={() => setError("")}
									>
										{t("code.dismiss")}
									</button>
								</p>
							) : null}
							{permission ? (
								<div className="oc-decision is-permission">
									<strong>
										{t("code.permission")}: {permission.title}
									</strong>
									{permission.detail ? (
										<p className="oc-muted">{permission.detail}</p>
									) : null}
									<div className="oc-decision-actions">
										<button
											type="button"
											disabled={replyBusy}
											onClick={() =>
												void replyPermission(permission.id, "once")
											}
										>
											{t("code.allowOnce")}
										</button>
										<button
											type="button"
											disabled={replyBusy}
											onClick={() =>
												void replyPermission(permission.id, "always")
											}
										>
											{t("code.allowAlways")}
										</button>
										<button
											type="button"
											disabled={replyBusy}
											onClick={() =>
												void replyPermission(permission.id, "reject")
											}
										>
											{t("code.deny")}
										</button>
									</div>
								</div>
							) : null}
							{!permission && question ? (
								<div className="oc-decision">
									{(() => {
										const count = question.prompts.length;
										const index = codeQuestionSlideIndex(slide, count, 0);
										const item = question.prompts[index];
										if (!item) {
											return null;
										}
										const typed = custom[item.question] ?? "";
										const picked = picks[item.question] ?? "";
										const ready = Boolean(promptAnswer(item));
										return (
											<div className="oc-question-wizard">
												<div className="oc-stepper">
													<span className="oc-stepper-count">
														{t("code.questionOf", {
															current: index + 1,
															total: count,
														})}
													</span>
													<div className="oc-stepper-bars" aria-hidden="true">
														{question.prompts.map((entry, entryIndex) => (
															<i
																key={entry.question}
																className={
																	promptAnswer(entry)
																		? "is-done"
																		: entryIndex === index
																			? "is-now"
																			: undefined
																}
															/>
														))}
													</div>
													<span className="oc-stepper-answered">
														{t("code.questionsAnswered", {
															done: question.prompts.filter((entry) =>
																promptAnswer(entry),
															).length,
															total: count,
														})}
													</span>
												</div>
												<p className="oc-question-title">
													{item.header ? `${item.header}: ` : ""}
													{item.question}
												</p>
												{item.options.length > 0 ? (
													<div className="oc-options-grid">
														{item.options.map((option, optionIndex) => (
															<button
																key={option}
																type="button"
																className={
																	!typed.trim() && picked === option
																		? "is-on"
																		: undefined
																}
																onClick={() =>
																	pickChoice(item.question, option)
																}
															>
																<span className="oc-option-key">
																	{optionIndex + 1}
																</span>
																<span className="oc-option-label">
																	{option}
																</span>
															</button>
														))}
													</div>
												) : null}
												<button
													type="button"
													className="oc-custom-toggle"
													onClick={() => setShowCustom((current) => !current)}
												>
													{showCustom
														? t("code.hideCustomResponse")
														: typed.trim()
															? t("code.customResponseSet")
															: t("code.customResponseToggle")}
												</button>
												{showCustom ? (
													<input
														className="oc-custom-response"
														type="text"
														value={typed}
														placeholder={t("code.customResponse")}
														aria-label={t("code.customResponse")}
														autoComplete="off"
														onChange={(event) =>
															setCustom((current) => ({
																...current,
																[item.question]: event.target.value,
															}))
														}
														onKeyDown={(event) => {
															if (
																event.key !== "Enter" ||
																event.shiftKey ||
																event.nativeEvent.isComposing ||
																!ready
															) {
																return;
															}
															event.preventDefault();
															if (index < count - 1) {
																moveQuestion(1);
																return;
															}
															answerQuestion(false);
														}}
													/>
												) : null}
												<div className="oc-question-foot">
													<button
														type="button"
														aria-label={t("code.previousQuestion")}
														disabled={index === 0}
														onClick={() => moveQuestion(-1)}
													>
														{"‹ "}
														{t("code.stepBack")}
													</button>
													<button
														type="button"
														aria-label={t("code.nextQuestion")}
														disabled={index >= count - 1 || !ready}
														onClick={() => moveQuestion(1)}
													>
														{t("code.stepNext")}
														{" ›"}
													</button>
													<button
														type="button"
														className="is-primary"
														disabled={
															replyBusy ||
															question.prompts.some(
																(entry) => !promptAnswer(entry),
															)
														}
														onClick={() => answerQuestion(false)}
													>
														{t("code.reply")}
													</button>
													<button
														type="button"
														disabled={replyBusy}
														onClick={() => answerQuestion(true)}
													>
														{t("code.reject")}
													</button>
												</div>
											</div>
										);
									})()}
								</div>
							) : null}
							{renderSelects(modelSelects())}
							{permission || question ? (
								<p className="oc-muted oc-blocked">
									{t("code.blockedComposer")}
								</p>
							) : null}
							{composer(false, Boolean(permission || question))}
						</div>
					) : null}
				</ProjectFiles>
			</div>
		</div>
	);
}
