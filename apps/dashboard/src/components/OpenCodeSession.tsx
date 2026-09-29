import { POST as postOpencode } from "@api/opencode";
import { GET as getProjects } from "@api/projects";
import {
	applyOpencodeEvent,
	CODE_DEFAULT_MODEL,
	codeNavBack,
	emptyOpencodeView,
	OPENCODE_EFFORT_KEY,
	OPENCODE_MODEL_KEY,
	type OpencodeClientCall,
	type OpencodeInline,
	type OpencodeMarkdown,
	type OpencodePart,
	type OpencodePermissionResponse,
	type OpencodeTurn,
	type OpencodeView,
	opencodeModelChoices,
	opencodePromptFields,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeStoredEffort,
	opencodeStoredModel,
	opencodeToolStacks,
	opencodeTurns,
	parseOpencodeMarkdown,
	pendingOpencodeTurn,
	pushCodeNav,
	type ReasoningEffort,
	readCodeNav,
	readOpencodeEventStream,
	replaceCodeNav,
	settleOpencodeTurns,
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
import ProjectFiles from "./ProjectFiles.tsx";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";

async function openEvents(
	uuid: string,
	repo: string,
	lastEventId: string,
	signal: AbortSignal,
) {
	const params = new URLSearchParams({ uuid, repo });
	const response = await fetch(`/api/opencode/event?${params}`, {
		headers: {
			accept: "text/event-stream",
			...(lastEventId ? { "last-event-id": lastEventId } : {}),
		},
		credentials: "same-origin",
		signal,
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error || "opencode event stream unavailable");
	}
	return response;
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
	const [view, setView] = useState<OpencodeView>(emptyOpencodeView);
	const [mode, setMode] = useState<Mode>("home");
	const [prompt, setPrompt] = useState("");
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [model, setModel] = useState(CODE_DEFAULT_MODEL);
	const [effort, setEffort] = useState<ReasoningEffort>("medium");
	const [modelMenu, setModelMenu] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);

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
		const fromStore = stored.includes("/")
			? (stored.split("/").pop() ?? "")
			: stored;
		const match = repos.find((item) => item.name === fromStore) ?? repos[0];
		setRepo(match?.name ?? "");
	}, [repos]);

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
		leaveChat();
	}

	function openSession(sessionID: string) {
		setQuery("");
		setView((current) => ({
			...current,
			sessionID,
			turns: [],
		}));
		setMode("session");
		pushCodeNav({ mode: "session", sessionID });
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
		setMode("draft");
		pushCodeNav({ mode: "draft", sessionID: "" });
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
			if (next.sessionID) {
				setView((current) => ({
					...current,
					sessionID: next.sessionID,
					turns: current.sessionID === next.sessionID ? current.turns : [],
				}));
			}
		}
		applyNav();
		window.addEventListener("popstate", applyNav);
		return () => window.removeEventListener("popstate", applyNav);
	}, []);

	useEffect(() => {
		if (!uuid || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		setView(emptyOpencodeView());
		void postOpencode({ uuid, repo, op: "sessions" }).then((result) => {
			if (cancelled) {
				return;
			}
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
				setView((current) =>
					current.sessionID === sessionID
						? {
								...current,
								turns: settleOpencodeTurns(
									current.turns,
									opencodeTurns(result.data),
								),
							}
						: current,
				);
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
		const controller = new AbortController();
		let lastEventId = "";
		let stopped = false;
		async function loop() {
			while (!stopped) {
				try {
					const response = await openEvents(
						uuid,
						repo,
						lastEventId,
						controller.signal,
					);
					setReconnecting(false);
					await readOpencodeEventStream(
						response,
						(data, id) => {
							if (id) {
								lastEventId = id;
							}
							setView((current) => applyOpencodeEvent(current, data));
						},
						controller.signal,
					);
				} catch (caught) {
					if (stopped || controller.signal.aborted) {
						return;
					}
					setReconnecting(true);
					if (caught instanceof Error && caught.name !== "AbortError") {
						setError(caught.message);
					}
				}
				if (stopped) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
		}
		void loop();
		return () => {
			stopped = true;
			controller.abort();
		};
	}, [uuid, repo]);

	const scrollKey =
		view.turns.length +
		(view.turns.at(-1)?.text.length ?? 0) +
		view.permissions.length +
		view.questions.length;
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
	const matches = needle
		? view.sessions.filter((item) => item.title.toLowerCase().includes(needle))
		: [];
	const bucketTitle = {
		today: t("code.today"),
		yesterday: t("code.yesterday"),
		earlier: t("code.earlier"),
	};
	const grouped = (["today", "yesterday", "earlier"] as const)
		.map((id) => ({
			id,
			title: bucketTitle[id],
			sessions: view.sessions.filter(
				(item) => opencodeSessionBucket(item.updated) === id,
			),
		}))
		.filter((group) => group.sessions.length > 0);
	const title =
		view.sessions.find((item) => item.id === view.sessionID)?.title ||
		t("code.sessions");
	const permission = view.permissions.find(
		(item) => item.sessionID === view.sessionID,
	);
	const question = view.questions.find(
		(item) => item.sessionID === view.sessionID,
	);
	const lastTurn = view.turns.at(-1)?.id;

	function modelSelects() {
		const choices = opencodeModelChoices();
		const chosen = choices.find((item) => item.id === model);
		const reasoning = chosen?.reasoning === true;
		return (
			<>
				<div className={`oc-model${modelMenu ? " is-open" : ""}`}>
					<button
						type="button"
						className="oc-chip"
						aria-label={t("code.model")}
						aria-expanded={modelMenu}
						onClick={() => setModelMenu((open) => !open)}
					>
						<span>{t("code.model")}</span>
						<span>{chosen?.name ?? model}</span>
						<span className="oc-model-provider">{chosen?.provider}</span>
					</button>
					{modelMenu ? (
						<div
							className="oc-model-menu"
							role="listbox"
							aria-label={t("code.model")}
						>
							{choices.map((item) => (
								<button
									key={item.id}
									type="button"
									role="option"
									aria-selected={item.id === model}
									className={item.id === model ? "is-on" : undefined}
									onClick={() => {
										selectModel(item.id);
										setModelMenu(false);
									}}
								>
									<span>{item.name}</span>
									<span className="oc-model-provider">{item.provider}</span>
								</button>
							))}
						</div>
					) : null}
				</div>
				{reasoning ? (
					<label className="oc-chip">
						{t("code.effort")}
						<select
							value={effort}
							aria-label={t("code.effort")}
							onChange={(event) => selectEffort(event.target.value)}
						>
							<option value="low">{t("code.effortLow")}</option>
							<option value="medium">{t("code.effortMedium")}</option>
							<option value="high">{t("code.effortHigh")}</option>
						</select>
					</label>
				) : null}
			</>
		);
	}

	function composer(disabled: boolean) {
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
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							if (!view.busy) {
								void send();
							}
						}
					}}
				/>
				<button
					type="button"
					className={`oc-send${view.busy ? " is-stop" : ""}`}
					aria-label={view.busy ? t("code.stop") : t("code.send")}
					disabled={!view.busy && (!prompt.trim() || disabled)}
					onClick={() => void (view.busy ? abort() : send())}
				>
					{view.busy ? <StopIcon /> : <SendIcon />}
				</button>
			</div>
		);
	}

	const owner = repos.find((item) => item.name === repo)?.owner ?? "";
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
									onClick={() => remember(item.name)}
								>
									<span>{item.name}</span>
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
								/>
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
							<i />
							{reconnecting ? t("code.reconnecting") : t("code.live")}
						</div>
						<div className="oc-session-list">
							{view.sessions.length === 0 ? (
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
															dateTime={new Date(session.updated).toISOString()}
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
						<div className="oc-chips">
							<label className="oc-chip">
								{t("code.project")}
								<select
									value={repo}
									aria-label={t("code.project")}
									onChange={(event) => selectRepo(event.target.value)}
								>
									{repos.map((item) => (
										<option
											key={`${item.owner}/${item.name}`}
											value={item.name}
										>
											{item.name}
										</option>
									))}
								</select>
							</label>
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
						<strong>{title}</strong>
						<span className={`oc-status${reconnecting ? " is-wait" : ""}`}>
							<i />
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
									onClick={() => void replyPermission(permission.id, "always")}
								>
									{t("code.allowAlways")}
								</button>
								<button
									type="button"
									onClick={() => void replyPermission(permission.id, "reject")}
								>
									{t("code.deny")}
								</button>
							</div>
						</div>
					) : null}
					{!permission && question ? (
						<div className="oc-decision">
							{question.prompts.map((item) => (
								<div key={item.question}>
									<p>
										{item.header ? `${item.header}: ` : ""}
										{item.question}
									</p>
									<div className="oc-options">
										{item.options.map((option) => (
											<button
												key={option}
												type="button"
												className={
													answers[item.question] === option
														? "is-on"
														: undefined
												}
												onClick={() =>
													setAnswers((current) => ({
														...current,
														[item.question]: option,
													}))
												}
											>
												{option}
											</button>
										))}
									</div>
								</div>
							))}
							<div className="oc-decision-actions">
								<button
									type="button"
									disabled={question.prompts.some(
										(item) => !answers[item.question],
									)}
									onClick={() =>
										void run({
											uuid,
											repo,
											op: "question",
											requestID: question.id,
											answers: question.prompts.map((item) => [
												answers[item.question] ?? "",
											]),
										}).then(() =>
											setView((current) => ({
												...current,
												questions: current.questions.filter(
													(item) => item.id !== question.id,
												),
											})),
										)
									}
								>
									{t("code.reply")}
								</button>
								<button
									type="button"
									onClick={() =>
										void run({
											uuid,
											repo,
											op: "question",
											requestID: question.id,
											reject: true,
										})
									}
								>
									{t("code.reject")}
								</button>
							</div>
						</div>
					) : null}
					<div className="oc-chips">{modelSelects()}</div>
					{composer(Boolean(permission || question))}
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
