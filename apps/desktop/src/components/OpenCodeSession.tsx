import {
	applyCodeMention,
	CODE_ATTACH_ACCEPT,
	CODE_STT_MAX_MS,
	CODE_VOICE_ARM_MS,
	CODE_VOICE_BARGE_FLOOR,
	CODE_VOICE_BARGE_HITS,
	CODE_VOICE_BARGE_RMS,
	CODE_VOICE_FLOOR_MS,
	CODE_VOICE_MAX_MS,
	CODE_VOICE_MIN_MS,
	CODE_VOICE_RMS,
	CODE_VOICE_SILENCE_MS,
	type CodeAttachDraft,
	type CodeVoiceProvider,
	codeAppendSpeechDirective,
	codeAttachPrompt,
	codeComposerErrorKey,
	codeHasSpeechDirective,
	codeMentionAt,
	codeSpeechBlocks,
	codeSpokenText,
	codeVoiceProvider,
	codeVoiceUtterance,
	encodeBase64,
	filterCodeMentions,
	removeContextDrafts,
	renameContextDrafts,
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
	type OpencodeInline,
	type OpencodeMarkdown,
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
	parseOpencodeMarkdown,
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
	Fragment,
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
	openExternal,
	signOpencodeLive,
	speakCode,
	transcribeCode,
	uploadBoardFile,
} from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useLocale, useT } from "../locale";
import ProjectFiles, { type CodeFilesBridge } from "./ProjectFiles";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";
type ChipMenuId = "model" | "effort" | "permission" | "project" | "board";
type SpeechItem = {
	text: string;
	gen: number;
	state: "queued" | "fetching" | "ready" | "failed";
	promise: Promise<void>;
	audio: string;
};

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

function WaveIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
		</svg>
	);
}

function PttIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
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

function at<T>(
	items: readonly T[],
	render: (item: T, index: number) => ReactNode,
) {
	return items.map((item, index) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: markdown nodes stay in source order
		<Fragment key={index}>{render(item, index)}</Fragment>
	));
}

function Blocks({ text }: { text: string }) {
	const blocks = parseOpencodeMarkdown(text);
	if (blocks.length === 0 && text) {
		return <p>{text}</p>;
	}
	return at(blocks, (block) => <MdBlock block={block} />);
}

function Inlines({ inlines }: { inlines: OpencodeInline[] }) {
	return at(inlines, (node) => <Inline node={node} />);
}

function Inline({ node }: { node: OpencodeInline }) {
	if (node.type === "text") {
		return node.text;
	}
	if (node.type === "break") {
		return <br />;
	}
	if (node.type === "code") {
		return <code>{node.text}</code>;
	}
	if (node.type === "strong") {
		return (
			<strong>
				<Inlines inlines={node.inlines} />
			</strong>
		);
	}
	if (node.type === "em") {
		return (
			<em>
				<Inlines inlines={node.inlines} />
			</em>
		);
	}
	if (node.type === "strike") {
		return (
			<s>
				<Inlines inlines={node.inlines} />
			</s>
		);
	}
	return (
		<a
			href={node.href}
			onClick={(event) => {
				event.preventDefault();
				if (/^https?:\/\//i.test(node.href)) {
					void openExternal(node.href);
				}
			}}
		>
			<Inlines inlines={node.inlines} />
		</a>
	);
}

function MdBlock({ block }: { block: OpencodeMarkdown }) {
	if (block.type === "heading") {
		const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
		return (
			<Tag>
				<Inlines inlines={block.inlines} />
			</Tag>
		);
	}
	if (block.type === "code") {
		return (
			<pre className="oc-code">
				{block.lang ? <span className="oc-code-lang">{block.lang}</span> : null}
				{block.text}
			</pre>
		);
	}
	if (block.type === "list") {
		const Tag = block.ordered ? "ol" : "ul";
		return (
			<Tag start={block.ordered && block.start !== 1 ? block.start : undefined}>
				{at(block.items, (item) => (
					<li>
						<Inlines inlines={item.inlines} />
						{at(item.blocks, (child) => (
							<MdBlock block={child} />
						))}
					</li>
				))}
			</Tag>
		);
	}
	if (block.type === "quote") {
		return (
			<blockquote>
				{at(block.blocks, (child) => (
					<MdBlock block={child} />
				))}
			</blockquote>
		);
	}
	if (block.type === "table") {
		return (
			<div className="oc-table">
				<table>
					<thead>
						<tr>
							{at(block.header, (cell, index) => (
								<th style={{ textAlign: block.aligns[index] ?? undefined }}>
									<Inlines inlines={cell} />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{at(block.rows, (row) => (
							<tr>
								{at(row, (cell, index) => (
									<td style={{ textAlign: block.aligns[index] ?? undefined }}>
										<Inlines inlines={cell} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	if (block.type === "hr") {
		return <hr />;
	}
	return (
		<p>
			<Inlines inlines={block.inlines} />
		</p>
	);
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
	});
	const rememberEntries = useCallback(
		(entries: { type: string; path: string }[]) => {
			setBoardPaths(
				entries.filter((item) => item.type === "file").map((item) => item.path),
			);
		},
		[],
	);
	const [recording, setRecording] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [voiceMode, setVoiceMode] = useState(false);
	const [voiceProvider, setVoiceProvider] =
		useState<CodeVoiceProvider>("workers-ai");
	const [pttHeld, setPttHeld] = useState(false);
	const [voiceLevel, setVoiceLevel] = useState(0);
	const [voiceListening, setVoiceListening] = useState(false);
	const [voiceSpeakingNow, setVoiceSpeakingNow] = useState(false);
	const [voiceQueued, setVoiceQueued] = useState(0);
	const [voiceReply, setVoiceReply] = useState(false);
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [slide, setSlide] = useState(0);
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [showCustom, setShowCustom] = useState(false);
	const [model, setModel] = useState(CODE_DEFAULT_MODEL);
	const [effort, setEffort] = useState<ReasoningEffort>("medium");
	const [permissionMode, setPermissionMode] =
		useState<OpencodePermissionMode>("ask");
	const [menu, setMenu] = useState<ChipMenuId | "">("");
	const [replyBusy, setReplyBusy] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const recordTimer = useRef(0);
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
		source: "auto" | "ptt";
		cancel(): void;
	} | null>(null);
	const voiceSpeaking = useRef<HTMLAudioElement | null>(null);
	const voiceSpeechResolve = useRef<(() => void) | null>(null);
	const speechSpoken = useRef(new Map<string, number>());
	const speechPrefetch = useRef<SpeechItem[]>([]);
	const speechPlaying = useRef(false);
	const speechFetching = useRef(false);
	const speechGen = useRef(0);
	const voiceSpoken = useRef(new Set<string>());
	const voiceQueue = useRef<string[]>([]);
	const voiceBarge = useRef(0);
	const voiceArm = useRef(0);
	const voiceShown = useRef(-1);
	const voiceFloor = useRef(0);
	const voiceFloorAt = useRef(0);
	const voiceModeRef = useRef(false);
	const voiceReplyRef = useRef(false);
	const speechDirectiveSentRef = useRef<string | null>(null);
	const pttRef = useRef(false);
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

	function openSession(sessionID: string) {
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
	}, [selected, repo]);

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
					setReconnecting(true);
					if (caught instanceof Error) {
						setError(caught.message);
					}
				}
				if (stopped) {
					return;
				}
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

	async function finishDictation(blob: Blob) {
		try {
			const heard = (
				await transcribeCode(
					encodeBase64(new Uint8Array(await blob.arrayBuffer())),
					locale,
				)
			).text.trim();
			if (!heard) {
				return;
			}
			setPrompt((current) =>
				current.trim() ? `${current.trim()} ${heard}` : heard,
			);
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
		}
	}

	async function dictate() {
		if (recorder.current && recorder.current.state === "recording") {
			recorder.current.stop();
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
			const rec = new MediaRecorder(stream);
			const chunks: Blob[] = [];
			rec.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			rec.onstop = () => {
				window.clearTimeout(recordTimer.current);
				for (const track of stream.getTracks()) {
					track.stop();
				}
				recorder.current = null;
				setRecording(false);
				void finishDictation(new Blob(chunks, { type: rec.mimeType }));
			};
			recorder.current = rec;
			rec.start();
			setRecording(true);
			recordTimer.current = window.setTimeout(
				() => rec.stop(),
				CODE_STT_MAX_MS,
			);
		} catch {
			setError(t("code.micDenied"));
		}
	}

	function startVoiceUtterance(source: "auto" | "ptt") {
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
				voiceArm.current = 0;
				if (cancelled) {
					return;
				}
				if (source === "auto" && !voiceModeRef.current) {
					return;
				}
				const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
				void finishVoiceRef.current(blob);
			};
			voiceUtter.current = {
				recorder: rec,
				started: Date.now(),
				voiceAt: Date.now(),
				source,
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
		const player = voiceSpeaking.current;
		voiceSpeaking.current = null;
		if (player) {
			player.onended = null;
			player.pause();
		}
		setVoiceSpeakingNow(false);
		const resolve = voiceSpeechResolve.current;
		voiceSpeechResolve.current = null;
		resolve?.();
	}

	function clearSpeechQueue() {
		speechGen.current += 1;
		speechPrefetch.current = [];
		const resolve = voiceSpeechResolve.current;
		voiceSpeechResolve.current = null;
		resolve?.();
		stopVoiceSpeech();
	}

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
		voiceArm.current = 0;
		stopVoiceSpeech();
		setVoiceListening(false);
		setVoiceLevel(0);
	}

	function beginPtt() {
		if (voiceUtter.current || pttRef.current) {
			return;
		}
		pttRef.current = true;
		setPttHeld(true);
		voiceArm.current = 0;
		if (voiceEngine.current) {
			startVoiceUtterance("ptt");
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
					startVoiceUtterance("ptt");
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
		voiceArm.current = 0;
		const utter = voiceUtter.current;
		if (utter?.source === "ptt") {
			stopVoiceUtterance();
		}
	}

	beginPttRef.current = beginPtt;
	endPttRef.current = endPtt;

	async function finishVoice(blob: Blob) {
		clearSpeechQueue();
		try {
			const heard = codeVoiceUtterance(
				(
					await transcribeCode(
						encodeBase64(new Uint8Array(await blob.arrayBuffer())),
						locale,
					)
				).text,
			);
			if (!heard) {
				return;
			}
			if (view.busy || uploading) {
				voiceQueue.current.push(heard);
				setVoiceQueued(voiceQueue.current.length);
				return;
			}
			await send(heard);
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
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

	function makeSpeechItem(text: string, gen: number): SpeechItem {
		return {
			text,
			gen,
			state: "queued",
			promise: Promise.resolve(),
			audio: "",
		};
	}

	async function fetchSpeech(item: SpeechItem): Promise<void> {
		if (item.state !== "queued") {
			return;
		}
		let settle = () => {};
		item.promise = new Promise<void>((resolve) => {
			settle = resolve;
		});
		item.state = "fetching";
		try {
			const audio = (await speakCode(item.text, locale)).audio;
			if (!audio) {
				item.state = "failed";
				return;
			}
			if (item.gen !== speechGen.current) {
				item.state = "failed";
				return;
			}
			item.audio = audio;
			item.state = "ready";
		} catch (caught) {
			setError(shownError(caught instanceof Error ? caught.message : ""));
			item.state = "failed";
		} finally {
			settle();
		}
	}

	async function prefetchSpeechQueue(): Promise<void> {
		if (speechFetching.current) {
			return;
		}
		speechFetching.current = true;
		try {
			while (speechPrefetch.current.length > 0) {
				const item = speechPrefetch.current.find(
					(entry) => entry.state === "queued",
				);
				if (!item) {
					return;
				}
				await fetchSpeech(item);
			}
		} finally {
			speechFetching.current = false;
		}
	}

	function playSpeech(item: SpeechItem): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				const player = new Audio(`data:audio/mpeg;base64,${item.audio}`);
				const done = () => {
					const settle = voiceSpeechResolve.current;
					voiceSpeechResolve.current = null;
					if (voiceSpeaking.current === player) {
						voiceSpeaking.current = null;
						setVoiceSpeakingNow(false);
					}
					settle?.();
					resolve();
				};
				player.onended = done;
				player.addEventListener("error", done);
				voiceSpeaking.current = player;
				voiceSpeechResolve.current = done;
				setVoiceSpeakingNow(true);
				voiceFloor.current = 0;
				voiceFloorAt.current = Date.now();
				voiceBarge.current = 0;
				player.play().catch(() => {
					done();
				});
			} catch (caught) {
				setError(shownError(caught instanceof Error ? caught.message : ""));
				resolve();
			}
		});
	}

	function dropSpeechItem(item: SpeechItem) {
		const index = speechPrefetch.current.indexOf(item);
		if (index !== -1) {
			speechPrefetch.current.splice(index, 1);
		}
	}

	function pumpSpeech() {
		if (speechPlaying.current) {
			void prefetchSpeechQueue();
			return;
		}
		if (speechPrefetch.current.length === 0) {
			return;
		}
		speechPlaying.current = true;
		void (async () => {
			try {
				while (speechPrefetch.current.length > 0) {
					const item = speechPrefetch.current[0];
					if (!item) {
						break;
					}
					if (
						item.gen !== speechGen.current ||
						item.state === "failed" ||
						(!voiceModeRef.current && !voiceReplyRef.current)
					) {
						dropSpeechItem(item);
						continue;
					}
					if (item.state === "queued") {
						await fetchSpeech(item);
					} else if (item.state === "fetching") {
						await item.promise;
					}
					if (
						item.gen !== speechGen.current ||
						item.state !== "ready" ||
						(!voiceModeRef.current && !voiceReplyRef.current)
					) {
						dropSpeechItem(item);
						continue;
					}
					void prefetchSpeechQueue();
					await playSpeech(item);
					dropSpeechItem(item);
				}
			} finally {
				speechPlaying.current = false;
			}
		})();
	}

	function enqueueSpeech(text: string) {
		const clean = codeSpokenText(text).trim();
		if (!clean) {
			return;
		}
		speechPrefetch.current.push(makeSpeechItem(clean, speechGen.current));
		pumpSpeech();
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
		const now = Date.now();
		const utter = voiceUtter.current;
		if (utter) {
			if (rms >= CODE_VOICE_RMS) {
				utter.voiceAt = now;
				voiceArm.current = 0;
			}
			const elapsed = now - utter.started;
			const quiet = now - utter.voiceAt;
			if (
				elapsed > CODE_VOICE_MAX_MS ||
				(elapsed > CODE_VOICE_MIN_MS && quiet > CODE_VOICE_SILENCE_MS)
			) {
				stopVoiceUtterance();
			}
		} else if (voiceSpeaking.current && voiceModeRef.current) {
			if (now - voiceFloorAt.current < CODE_VOICE_FLOOR_MS) {
				if (rms > voiceFloor.current) {
					voiceFloor.current = rms;
				}
				voiceBarge.current = 0;
			} else {
				const gate = Math.max(
					CODE_VOICE_BARGE_RMS,
					voiceFloor.current * CODE_VOICE_BARGE_FLOOR,
				);
				if (rms >= gate) {
					voiceBarge.current += 1;
					if (voiceBarge.current >= CODE_VOICE_BARGE_HITS) {
						voiceBarge.current = 0;
						clearSpeechQueue();
					}
				} else {
					voiceBarge.current = 0;
				}
			}
		} else if (pttRef.current || voiceModeRef.current) {
			if (rms >= CODE_VOICE_RMS) {
				if (!voiceArm.current) {
					voiceArm.current = now;
				} else if (now - voiceArm.current >= CODE_VOICE_ARM_MS) {
					startVoiceUtterance(pttRef.current ? "ptt" : "auto");
				}
			} else {
				voiceArm.current = 0;
			}
		}
	}

	voiceTickRef.current = voiceTick;

	// biome-ignore lint/correctness/useExhaustiveDependencies: voice engine is ref-driven and reads the latest render through refs
	useEffect(() => {
		voiceModeRef.current = voiceMode;
		if (!voiceMode || mode === "home") {
			if (!pttRef.current) {
				stopVoiceEngine();
			}
			return;
		}
		for (const turn of view.turns) {
			if (turn.role === "assistant") {
				voiceSpoken.current.add(turn.id);
				speechSpoken.current.set(turn.id, codeSpeechBlocks(turn.text).length);
			}
		}
		let cancelled = false;
		void (async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
				});
				if (cancelled) {
					for (const track of stream.getTracks()) {
						track.stop();
					}
					return;
				}
				const context = new AudioContext();
				await context.resume().catch(() => {});
				const analyser = context.createAnalyser();
				analyser.fftSize = 512;
				context.createMediaStreamSource(stream).connect(analyser);
				const data = new Float32Array(analyser.fftSize);
				const engine = { stream, context, analyser, data, raf: 0 };
				voiceEngine.current = engine;
				const tick = () => {
					if (voiceEngine.current !== engine || cancelled) {
						return;
					}
					voiceTickRef.current();
					engine.raf = requestAnimationFrame(tick);
				};
				engine.raf = requestAnimationFrame(tick);
			} catch {
				if (!cancelled) {
					setError(t("code.micDenied"));
					setVoiceMode(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [voiceMode, mode]);

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
		if (!voiceMode && !voiceReply) {
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
	}, [voiceMode, view.turns]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: speaks settled turns through refs and enqueueSpeech()
	useEffect(() => {
		if (!voiceMode && !voiceReply) {
			clearSpeechQueue();
			return;
		}
		if (voiceSpeaking.current || voiceUtter.current) {
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
		voiceMode,
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
		const wantsSpeech = Boolean(override) || voiceModeRef.current;
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
			if (override && !voiceModeRef.current) {
				voiceReplyRef.current = true;
				setVoiceReply(true);
				for (const turn of view.turns) {
					if (turn.role === "assistant") {
						voiceSpoken.current.add(turn.id);
						speechSpoken.current.set(
							turn.id,
							codeSpeechBlocks(turn.text).length,
						);
					}
				}
			} else if (!override && !voiceModeRef.current) {
				voiceReplyRef.current = false;
				setVoiceReply(false);
			}
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
		const active = matches.length === 0 ? 0 : mentionIndex % matches.length;
		const voicePhase =
			pttHeld || voiceListening
				? "listening"
				: voiceSpeakingNow
					? "speaking"
					: view.busy || uploading
						? "waiting"
						: "idle";
		const voiceLabel = voiceSpeakingNow
			? t("code.voiceSpeaking")
			: voiceListening || voicePhase === "idle"
				? t("code.voiceListening")
				: t("code.voiceThinking");
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
				{voiceMode ? (
					<div className={`oc-voice is-${voicePhase}`} aria-live="polite">
						<span className="oc-voice-bars" aria-hidden="true">
							{[0, 1, 2, 3, 4, 5, 6].map((bar) => (
								<i
									key={bar}
									style={
										voicePhase === "waiting"
											? undefined
											: {
													transform: `scaleY(${(
														0.2 + voiceLevel * (1 - Math.abs(bar - 3) / 4) * 0.8
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
						<button
							type="button"
							className="oc-voice-stop"
							aria-label={t("code.voiceStop")}
							onClick={() => setVoiceMode(false)}
						>
							×
						</button>
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
					<button
						type="button"
						className={`oc-tool${recording ? " is-on" : ""}`}
						aria-label={recording ? t("code.dictating") : t("code.dictate")}
						disabled={toolsDisabled}
						onClick={() => void dictate()}
					>
						<MicIcon />
					</button>
					<button
						type="button"
						className={`oc-tool${voiceMode ? " is-on" : ""}`}
						aria-label={voiceMode ? t("code.voiceStop") : t("code.voiceMode")}
						aria-pressed={voiceMode}
						disabled={toolsDisabled}
						onClick={() => setVoiceMode((current) => !current)}
					>
						<WaveIcon />
					</button>
					<button
						type="button"
						className={`oc-tool${pttHeld ? " is-on" : ""}`}
						aria-label={t("code.ptt")}
						title={t("code.pttHint")}
						disabled={toolsDisabled}
						onPointerDown={(event) => {
							event.preventDefault();
							beginPttRef.current();
						}}
					>
						<PttIcon />
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
						className={`oc-send${view.busy ? " is-stop" : ""}`}
						aria-label={view.busy ? t("code.stop") : t("code.send")}
						disabled={sendDisabled}
						title={blocked ? t("code.blockedComposer") : undefined}
						onClick={() => void (view.busy ? abort() : send())}
					>
						{view.busy ? <StopIcon /> : <SendIcon />}
					</button>
				</div>
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
								<div className="oc-chips">
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
								</div>
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
							<div className="oc-chips">{modelSelects()}</div>
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
