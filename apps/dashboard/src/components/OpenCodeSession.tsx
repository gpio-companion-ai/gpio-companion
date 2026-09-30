import { POST as postOpencode } from "@api/opencode";
import { POST as signOpencodeLive } from "@api/opencode/live";
import { GET as getProjects } from "@api/projects";
import {
	activeOpencodeQuestion,
	applyOpencodeEvent,
	CODE_DEFAULT_MODEL,
	codeQuestionAnswer,
	codeQuestionSlideIndex,
	codeRepoLabel,
	codeRepoOwner,
	codeScrollKey,
	codeSessionTitle,
	emptyOpencodeView,
	filterCodeSessions,
	matchCodeRepo,
	matchOpencodeQuestionID,
	mergeOpencodeQuestions,
	noteOpencodePrompt,
	OPENCODE_EFFORT_KEY,
	OPENCODE_MODEL_KEY,
	type OpencodeClientCall,
	type OpencodeInline,
	type OpencodeMarkdown,
	type OpencodePart,
	type OpencodePermissionResponse,
	type OpencodePromptEpoch,
	type OpencodeTurn,
	type OpencodeView,
	opencodeEventResumeUrl,
	opencodeModelChoices,
	opencodePromptFields,
	opencodeQuestions,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeStoredEffort,
	opencodeStoredModel,
	opencodeToolStacks,
	opencodeTurns,
	parseOpencodeEventFrame,
	parseOpencodeMarkdown,
	pendingOpencodeFromMessages,
	pendingOpencodeTurn,
	pruneCodePromptState,
	type ReasoningEffort,
	readCodeNav,
	readStoredOpencodePrompts,
	rememberOpencodePrompt,
	replaceCodeNav,
	seedOpencodePrompts,
	settleOpencodeTurns,
	storeOpencodePrompts,
} from "gpio-companion";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useT } from "../hooks/useLocale.tsx";
import { unwrapAction } from "../lib/action.ts";
import ProjectFiles from "./ProjectFiles.tsx";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";
type ChipMenuId = "model" | "effort" | "project";

export function ChipMenu({
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

function SearchIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="11" cy="11" r="6" />
			<path d="M16 16l4 4" />
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
		<a href={node.href} target="_blank" rel="noopener noreferrer">
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
	uuid,
	repos,
}: {
	uuid: string;
	repos: Repo[];
}) {
	const t = useT();
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
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [slide, setSlide] = useState(0);
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [model, setModel] = useState(CODE_DEFAULT_MODEL);
	const [effort, setEffort] = useState<ReasoningEffort>("medium");
	const [menu, setMenu] = useState<ChipMenuId | "">("");
	const scroller = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const prompts = useRef<OpencodePromptEpoch>({
		epoch: 0,
		dropped: new Set(),
	});

	useEffect(() => {
		try {
			setModel(
				opencodeStoredModel(window.localStorage.getItem(OPENCODE_MODEL_KEY)),
			);
			setEffort(
				opencodeStoredEffort(window.localStorage.getItem(OPENCODE_EFFORT_KEY)),
			);
		} catch {
			setModel(CODE_DEFAULT_MODEL);
			setEffort("medium");
		}
	}, []);

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
	}

	function promptAnswer(item: { question: string }) {
		return codeQuestionAnswer(
			picks[item.question],
			custom[item.question] ?? "",
		);
	}

	function pickChoice(prompt: string, option: string) {
		setPicks((current) => ({ ...current, [prompt]: option }));
		setCustom((current) => ({ ...current, [prompt]: "" }));
	}

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
		replaceCodeNav({ mode: "session", sessionID });
		if (field.current) {
			window.setTimeout(() => field.current?.focus(), 50);
		}
	}

	async function removeSession(sessionID: string) {
		if (!window.confirm(t("code.deleteConfirm"))) {
			return;
		}
		const removed = await run({ uuid, repo, op: "delete", sessionID });
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
		replaceCodeNav({ mode: "draft", sessionID: "" });
		window.setTimeout(() => field.current?.focus(), 50);
	}

	function leaveChat() {
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
	}, [menu, mode, model]);

	useEffect(() => {
		if (mode !== "session" || !view.sessionID) {
			return;
		}
		if (view.questions.length === 0 && view.permissions.length === 0) {
			return;
		}
		storeOpencodePrompts(view.sessionID, view.questions, view.permissions);
	}, [mode, view.sessionID, view.questions, view.permissions]);

	const askedId = useRef("");
	useEffect(() => {
		const active = view.questions.find(
			(item) => item.sessionID === view.sessionID,
		);
		const prompts = active?.prompts ?? [];
		const id = active?.id ?? "";
		setPicks((current) => pruneCodePromptState(current, prompts));
		setCustom((current) => pruneCodePromptState(current, prompts));
		if (askedId.current !== id) {
			askedId.current = id;
			setSlide(0);
			return;
		}
		setSlide((current) =>
			codeQuestionSlideIndex(current, Math.max(prompts.length, 1), 0),
		);
	}, [view.questions, view.sessionID]);

	const boardRef = useRef(uuid);
	useEffect(() => {
		if (boardRef.current === uuid) {
			return;
		}
		boardRef.current = uuid;
		setMode("home");
		replaceCodeNav({ mode: "home", sessionID: "" });
	}, [uuid]);

	useEffect(() => {
		function applyNav() {
			const next = readCodeNav(window.location.search);
			setMode(next.mode);
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
				turns:
					next.sessionID && current.sessionID === next.sessionID
						? current.turns
						: [],
			}));
		}
		applyNav();
		window.addEventListener("popstate", applyNav);
		return () => window.removeEventListener("popstate", applyNav);
	}, []);

	useEffect(() => {
		if (!uuid || !repo) {
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
		void postOpencode({ uuid, repo, op: "sessions" }).then((result) => {
			if (cancelled) {
				return;
			}
			setSessionsLoading(false);
			if (!result.ok) {
				setError(result.error);
				return;
			}
			const sessions = opencodeSessions(result.data);
			setView((current) => ({ ...current, sessions }));
		});
		return () => {
			cancelled = true;
		};
	}, [uuid, repo]);

	useEffect(() => {
		if (!uuid || !repo || mode !== "session" || !view.sessionID) {
			return;
		}
		let cancelled = false;
		const sessionID = view.sessionID;
		void postOpencode({ uuid, repo, op: "messages", sessionID }).then(
			(result) => {
				if (cancelled || !result.ok) {
					return;
				}
				setView((current) => {
					if (current.sessionID !== sessionID) {
						return current;
					}
					const turns = settleOpencodeTurns(
						current.turns,
						opencodeTurns(result.data),
					);
					const pending = pendingOpencodeFromMessages(
						result.data,
						sessionID,
						readStoredOpencodePrompts(sessionID),
					);
					storeOpencodePrompts(
						sessionID,
						pending.questions,
						pending.permissions,
					);
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
			},
		);
		return () => {
			cancelled = true;
		};
	}, [uuid, repo, mode, view.sessionID]);

	useEffect(() => {
		if (!uuid || !repo) {
			return;
		}
		let socket: WebSocket | null = null;
		let lastEventId = "";
		let stopped = false;
		async function loop() {
			while (!stopped) {
				let opened = false;
				try {
					const signed = unwrapAction(await signOpencodeLive({ uuid, repo }));
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
	}, [uuid, repo]);

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

	async function run(call: OpencodeClientCall) {
		setError("");
		const result = await postOpencode(call);
		if (!result.ok) {
			setError(result.error);
			return null;
		}
		return result.data;
	}

	async function send() {
		const text = prompt.trim();
		if (!text || !repo || view.busy) {
			return;
		}
		setPrompt("");
		if (field.current) {
			field.current.style.height = "24px";
		}
		let sessionID = mode === "session" ? view.sessionID : "";
		if (!sessionID) {
			const data = await run({ uuid, repo, op: "create" });
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
			uuid,
			repo,
			op: "prompt",
			sessionID,
			text,
			...opencodePromptFields(model, effort),
		});
		if (!sent) {
			setView((current) => ({ ...current, busy: false }));
		}
	}

	async function abort() {
		if (!view.sessionID) {
			return;
		}
		await run({ uuid, repo, op: "abort", sessionID: view.sessionID });
		setView((current) => ({ ...current, busy: false }));
	}

	async function replyPermission(
		permissionID: string,
		response: OpencodePermissionResponse,
	) {
		await run({
			uuid,
			repo,
			op: "permission",
			sessionID: view.sessionID,
			permissionID,
			response,
		});
		setView((current) => ({
			...current,
			permissions: current.permissions.filter(
				(item) => item.id !== permissionID,
			),
		}));
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
		const sendDisabled = !view.busy && (!prompt.trim() || disabled || blocked);
		return (
			<div className="oc-composer">
				<textarea
					ref={field}
					rows={1}
					value={prompt}
					placeholder={t("code.placeholder")}
					disabled={disabled}
					aria-label={t("code.prompt")}
					onChange={(event) => {
						setPrompt(event.target.value);
						event.target.style.height = "0px";
						event.target.style.height = `${Math.min(160, event.target.scrollHeight)}px`;
					}}
					onKeyDown={(event) => {
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
		const listed = await run({ uuid, repo, op: "questions" });
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
		if (!question) {
			return;
		}
		const current = question;
		if (!reject && current.prompts.some((item) => !promptAnswer(item))) {
			return;
		}
		void questionRequestID(current).then((requestID) => {
			if (!requestID) {
				return;
			}
			void run({
				uuid,
				repo,
				op: "question",
				requestID,
				...(reject
					? { reject: true }
					: {
							answers: current.prompts.map((item) => [promptAnswer(item)]),
						}),
			}).then((sent) => {
				if (!sent) {
					return;
				}
				clearQuestionDraft();
				setView((viewCurrent) => ({
					...viewCurrent,
					questions: viewCurrent.questions.filter(
						(item) => item.id !== current.id && item.id !== requestID,
					),
				}));
			});
		});
	}

	const owner = codeRepoOwner(repos, repo);
	return (
		<div className="oc-card">
			<ProjectFiles uuid={uuid} owner={owner} name={repo}>
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
									<a className="oc-neutral" href="/project">
										{t("code.openProject")}
									</a>
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
										onClick={() => void replyPermission(permission.id, "once")}
									>
										{t("code.allowOnce")}
									</button>
									<button
										type="button"
										onClick={() =>
											void replyPermission(permission.id, "always")
										}
									>
										{t("code.allowAlways")}
									</button>
									<button
										type="button"
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
										<div className="oc-question-slide">
											{count > 1 ? (
												<button
													type="button"
													className="oc-option-nav"
													aria-label={t("code.previousQuestion")}
													disabled={index === 0}
													onClick={() => moveQuestion(-1)}
												>
													{"<"}
												</button>
											) : null}
											<div className="oc-question-panel">
												<p>
													{item.header ? `${item.header}: ` : ""}
													{item.question}
												</p>
												{item.options.length > 0 ? (
													<div className="oc-options">
														{item.options.map((option) => (
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
																{option}
															</button>
														))}
													</div>
												) : null}
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
											</div>
											{count > 1 ? (
												<button
													type="button"
													className="oc-option-nav"
													aria-label={t("code.nextQuestion")}
													disabled={index >= count - 1 || !ready}
													onClick={() => moveQuestion(1)}
												>
													{">"}
												</button>
											) : null}
										</div>
									);
								})()}
								<div className="oc-decision-actions">
									<button
										type="button"
										disabled={question.prompts.some(
											(item) => !promptAnswer(item),
										)}
										onClick={() => answerQuestion(false)}
									>
										{t("code.reply")}
									</button>
									<button type="button" onClick={() => answerQuestion(true)}>
										{t("code.reject")}
									</button>
								</div>
							</div>
						) : null}
						<div className="oc-chips">{modelSelects()}</div>
						{permission || question ? (
							<p className="oc-muted oc-blocked">{t("code.blockedComposer")}</p>
						) : null}
						{composer(false, Boolean(permission || question))}
					</div>
				) : null}
			</ProjectFiles>
		</div>
	);
}

export async function loadCodeRepos() {
	const result = await getProjects();
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.data.repos;
}
