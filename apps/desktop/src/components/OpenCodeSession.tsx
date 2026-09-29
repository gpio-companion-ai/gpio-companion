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
} from "gpio-companion-opencode";
import { useEffect, useRef, useState } from "react";
import { listProjects, opencodeCall, openOpencodeEvents } from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useT } from "../locale";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";

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

function Blocks({ text }: { text: string }) {
	const blocks = formatOpencodeBlocks(text);
	if (blocks.length === 0 && text) {
		return <p>{text}</p>;
	}
	return blocks.map((block) => (
		<Block
			key={
				block.type === "list"
					? `list:${block.items.join("\n")}`
					: `${block.type}:${block.text}`
			}
			block={block}
		/>
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
			{turn.role === "user" ? (
				<p className="oc-user">{turn.text}</p>
			) : (
				<Blocks text={turn.text} />
			)}
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
	onOpenProject,
}: {
	onOpenProject?: () => void;
}) {
	const t = useT();
	const { uuid } = useBoardSelection();
	const { devices } = useUserBoards();
	const selected = uuid || devices[0]?.uuid || "";
	const [repos, setRepos] = useState<Repo[]>([]);
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
		if (selected) {
			setMode("home");
		}
	}, [selected]);

	useEffect(() => {
		if (!selected || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		setView(emptyOpencodeView());
		void opencodeCall({ uuid: selected, repo, op: "sessions" })
			.then((data) => {
				if (cancelled) {
					return;
				}
				const sessions = opencodeSessions(data);
				setView((current) => ({ ...current, sessions }));
			})
			.catch((caught) => {
				if (!cancelled) {
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
				setView((current) =>
					current.sessionID === sessionID
						? {
								...current,
								turns: settleOpencodeTurns(current.turns, opencodeTurns(data)),
							}
						: current,
				);
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
		const controller = new AbortController();
		let lastEventId = "";
		let stopped = false;
		async function loop() {
			while (!stopped) {
				try {
					const response = await openOpencodeEvents(
						selected,
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
	}, [selected, repo]);

	const scrollKey =
		view.turns.length +
		(view.turns.at(-1)?.text.length ?? 0) +
		view.permissions.length +
		view.questions.length;
	useEffect(() => {
		if (scrollKey < 0) {
			return;
		}
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [scrollKey]);

	async function run(call: Omit<OpencodeClientCall, "uuid">) {
		setError("");
		try {
			return await opencodeCall({ ...call, uuid: selected });
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
			return null;
		}
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
		}
		setView((current) => ({
			...current,
			busy: true,
			turns: [...current.turns, pendingOpencodeTurn(text)],
		}));
		const sent = await run({ repo, op: "prompt", sessionID, text });
		if (!sent) {
			setView((current) => ({ ...current, busy: false }));
		}
	}

	async function abort() {
		if (!view.sessionID) {
			return;
		}
		await run({ repo, op: "abort", sessionID: view.sessionID });
		setView((current) => ({ ...current, busy: false }));
	}

	async function replyPermission(
		permissionID: string,
		response: OpencodePermissionResponse,
	) {
		await run({
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

	return (
		<div className="oc-shell">
			<div className="oc-card">
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
														setView((current) => ({
															...current,
															sessionID: session.id,
															turns: [],
														}));
														setMode("session");
													}}
												>
													<span className="oc-session-title">
														{session.title}
													</span>
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
													<span className="oc-session-title">
														{session.title}
													</span>
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
							<button
								type="button"
								className="oc-back"
								onClick={() => setMode("home")}
							>
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
										<option
											key={`${item.owner}/${item.name}`}
											value={item.name}
										>
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
							<button
								type="button"
								className="oc-back"
								onClick={() => setMode("home")}
							>
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
						{composer(Boolean(permission || question))}
					</div>
				) : null}
			</div>
		</div>
	);
}
