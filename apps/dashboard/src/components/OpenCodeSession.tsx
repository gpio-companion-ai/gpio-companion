import { POST as postOpencode } from "@api/opencode";
import { GET as getProjects } from "@api/projects";
import {
	applyOpencodeEvent,
	emptyOpencodeView,
	formatOpencodeBlocks,
	type OpencodeBlock,
	type OpencodeClientCall,
	type OpencodePermissionResponse,
	type OpencodeTurn,
	type OpencodeView,
	opencodeSessionBucket,
	opencodeSessions,
	opencodeTurns,
	pendingOpencodeTurn,
	readOpencodeEventStream,
	settleOpencodeTurns,
} from "gpio-companion";
import { useEffect, useRef, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";

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
			<rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" />
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

function Blocks({ text }: { text: string }) {
	const blocks = formatOpencodeBlocks(text);
	if (blocks.length === 0 && text) {
		return <p>{text}</p>;
	}
	return blocks.map((block, index) => (
		<Block key={`${block.type}-${index}`} block={block} />
	));
}

function Block({ block }: { block: OpencodeBlock }) {
	if (block.type === "code") {
		return <pre className="oc-code">{block.text}</pre>;
	}
	if (block.type === "list") {
		return (
			<ul>
				{block.items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		);
	}
	return <p>{block.text}</p>;
}

function TurnView({ turn, caret }: { turn: OpencodeTurn; caret: boolean }) {
	return (
		<article className="oc-turn">
			{turn.role === "user" ? <p className="oc-user">{turn.text}</p> : <Blocks text={turn.text} />}
			{turn.parts
				.filter((part) => part.type === "tool")
				.map((part) => (
					<div
						key={part.id}
						className={`oc-tool is-${part.status === "error" ? "error" : part.status}`}
					>
						<i className="oc-mark" />
						<strong>{part.tool}</strong>
						{part.text ? <span>{part.text}</span> : null}
					</div>
				))}
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
	const scroller = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);

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
		setMode("home");
		setQuery("");
	}

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
			setView({ ...emptyOpencodeView(), sessions: opencodeSessions(result.data) });
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
		void postOpencode({ uuid, repo, op: "messages", sessionID }).then((result) => {
			if (cancelled || !result.ok) {
				return;
			}
			setView((current) =>
				current.sessionID === sessionID
					? {
							...current,
							turns: settleOpencodeTurns(current.turns, opencodeTurns(result.data)),
						}
					: current,
			);
		});
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
					const response = await openEvents(uuid, repo, lastEventId, controller.signal);
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

	const scrollKey = view.turns.length + view.permissions.length + view.questions.length;
	useEffect(() => {
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [scrollKey]);

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
				sessions: [created, ...current.sessions.filter((item) => item.id !== created.id)],
				sessionID: created.id,
				turns: [],
				busy: false,
			}));
			setMode("session");
		}
		setView((current) => ({
			...current,
			busy: true,
			turns: [...current.turns, pendingOpencodeTurn(text)],
		}));
		const sent = await run({ uuid, repo, op: "prompt", sessionID, text });
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
			permissions: current.permissions.filter((item) => item.id !== permissionID),
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
		view.sessions.find((item) => item.id === view.sessionID)?.title || t("code.sessions");
	const permission = view.permissions.find((item) => item.sessionID === view.sessionID);
	const question = view.questions.find((item) => item.sessionID === view.sessionID);
	const lastTurn = view.turns.at(-1)?.id;

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
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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

	return (
		<div className="oc-card">
			{error && mode === "home" ? (
				<p className="oc-error">
					<span>{error}</span>
					<button type="button" aria-label={t("code.dismiss")} onClick={() => setError("")}>
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
								onClick={() => {
									setPrompt("");
									setMode("draft");
								}}
							>
								{t("code.newSession")}
							</button>
							{searching && needle ? (
								<div className="oc-results">
									{matches.length === 0 ? (
										<p className="oc-muted">{t("code.searchEmpty")}</p>
									) : (
										matches.map((session) => (
											<button
												key={session.id}
												type="button"
												className="oc-row"
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => {
													setQuery("");
													setView((current) => ({ ...current, sessionID: session.id, turns: [] }));
													setMode("session");
												}}
											>
												<span className="oc-session-title">{session.title}</span>
											</button>
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
										onClick={() => setMode("draft")}
									>
										{t("code.newSession")}
									</button>
								</div>
							) : (
								grouped.map((group) => (
									<div key={group.id}>
										<div className="oc-group">{group.title}</div>
										{group.sessions.map((session) => (
											<button
												key={session.id}
												type="button"
												className={`oc-row${session.id === view.sessionID ? " is-active" : ""}`}
												onClick={() => {
													setView((current) => ({
														...current,
														sessionID: session.id,
														turns: [],
													}));
													setMode("session");
												}}
											>
												<span className="oc-session-title">{session.title}</span>
											</button>
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
						<button type="button" className="oc-back" onClick={() => setMode("home")}>
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
						<label className="oc-chip">
							{t("code.project")}
							<select
								value={repo}
								aria-label={t("code.project")}
								onChange={(event) => selectRepo(event.target.value)}
							>
								{repos.map((item) => (
									<option key={`${item.owner}/${item.name}`} value={item.name}>
										{item.name}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>
			) : null}
			{mode === "session" ? (
				<div className="oc-session">
					<div className="oc-session-bar">
						<button type="button" className="oc-back" onClick={() => setMode("home")}>
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
						{view.busy && view.turns.length === 0 ? <span className="oc-caret" /> : null}
					</div>
					{error ? (
						<p className="oc-error">
							<span>{error}</span>
							<button type="button" aria-label={t("code.dismiss")} onClick={() => setError("")}>
								{t("code.dismiss")}
							</button>
						</p>
					) : null}
					{permission ? (
						<div className="oc-decision is-permission">
							<strong>
								{t("code.permission")}: {permission.title}
							</strong>
							{permission.detail ? <p className="oc-muted">{permission.detail}</p> : null}
							<div className="oc-decision-actions">
								<button type="button" onClick={() => void replyPermission(permission.id, "once")}>
									{t("code.allowOnce")}
								</button>
								<button type="button" onClick={() => void replyPermission(permission.id, "always")}>
									{t("code.allowAlways")}
								</button>
								<button type="button" onClick={() => void replyPermission(permission.id, "reject")}>
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
												className={answers[item.question] === option ? "is-on" : undefined}
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
									disabled={question.prompts.some((item) => !answers[item.question])}
									onClick={() =>
										void run({
											uuid,
											repo,
											op: "question",
											requestID: question.id,
											answers: question.prompts.map((item) => [answers[item.question] ?? ""]),
										}).then(() =>
											setView((current) => ({
												...current,
												questions: current.questions.filter((item) => item.id !== question.id),
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
					{composer(Boolean(permission))}
				</div>
			) : null}
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
