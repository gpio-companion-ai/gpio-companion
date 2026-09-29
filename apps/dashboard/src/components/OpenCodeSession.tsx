import { POST as postOpencode } from "@api/opencode";
import { GET as getProjects } from "@api/projects";
import Alert from "@shpaw415/mui-lite/Alert";
import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	applyOpencodeEvent,
	emptyOpencodeView,
	type OpencodeClientCall,
	type OpencodePermissionResponse,
	type OpencodeView,
	opencodeSessions,
	opencodeTurns,
	readOpencodeEventStream,
} from "gpio-companion";
import { useEffect, useRef, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";

const PROJECT_KEY = "gpio-companion-selected-project";

type Repo = { owner: string; name: string };

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
	const [prompt, setPrompt] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [reconnecting, setReconnecting] = useState(false);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const scroller = useRef<HTMLDivElement>(null);
	const viewRef = useRef(view);
	viewRef.current = view;

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

	useEffect(() => {
		if (!uuid || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		void postOpencode({ uuid, repo, op: "sessions" }).then((result) => {
			if (cancelled || !result.ok) {
				if (!cancelled && result && !result.ok) {
					setError(result.error);
				}
				return;
			}
			const sessions = opencodeSessions(result.data);
			setView((current) => ({
				...current,
				sessions,
				sessionID: current.sessionID || sessions[0]?.id || "",
			}));
		});
		return () => {
			cancelled = true;
		};
	}, [uuid, repo]);

	useEffect(() => {
		if (!uuid || !repo || !view.sessionID) {
			return;
		}
		let cancelled = false;
		void postOpencode({
			uuid,
			repo,
			op: "messages",
			sessionID: view.sessionID,
		}).then((result) => {
			if (cancelled || !result.ok) {
				return;
			}
			setView((current) =>
				current.sessionID === view.sessionID
					? { ...current, turns: opencodeTurns(result.data) }
					: current,
			);
		});
		return () => {
			cancelled = true;
		};
	}, [uuid, repo, view.sessionID]);

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
		view.turns.length + view.permissions.length + view.questions.length;
	useEffect(() => {
		if (scrollKey < 0) {
			return;
		}
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [scrollKey]);

	async function run(call: OpencodeClientCall) {
		setError("");
		setBusy(true);
		try {
			const result = await postOpencode(call);
			if (!result.ok) {
				setError(result.error);
				return null;
			}
			return result.data;
		} finally {
			setBusy(false);
		}
	}

	async function createSession() {
		const data = await run({ uuid, repo, op: "create" });
		const created = opencodeSessions(data ? [data] : [])[0];
		if (!created) {
			return;
		}
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
	}

	async function send() {
		const text = prompt.trim();
		if (!text || !view.sessionID) {
			return;
		}
		setPrompt("");
		setView((current) => ({
			...current,
			busy: true,
			turns: [
				...current.turns,
				{ id: `local-${Date.now()}`, role: "user", text },
			],
		}));
		await run({
			uuid,
			repo,
			op: "prompt",
			sessionID: view.sessionID,
			text,
		});
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

	const activeQuestions = view.questions.filter(
		(item) => item.sessionID === view.sessionID,
	);
	const activePermissions = view.permissions.filter(
		(item) => item.sessionID === view.sessionID,
	);

	return (
		<Stack spacing={1.5} className="project-workbench">
			<Typography variant="h5">{t("code.title")}</Typography>
			<Typography color="textSecondary">{t("code.subtitle")}</Typography>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<label>
					<Typography variant="caption">{t("code.project")}</Typography>
					<select
						value={repo}
						onChange={(event) => {
							const name = event.target.value;
							setRepo(name);
							const match = repos.find((item) => item.name === name);
							if (match) {
								window.localStorage.setItem(
									PROJECT_KEY,
									`${match.owner}/${match.name}`,
								);
							}
						}}
						style={{ display: "block", minWidth: 180, marginTop: 4 }}
					>
						{repos.map((item) => (
							<option key={`${item.owner}/${item.name}`} value={item.name}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<Button
					variant="outlined"
					disabled={!repo || busy}
					onClick={() => void createSession()}
				>
					{t("code.newSession")}
				</Button>
				<Button
					variant="outlined"
					color="error"
					disabled={!view.sessionID || busy}
					onClick={() =>
						void run({
							uuid,
							repo,
							op: "abort",
							sessionID: view.sessionID,
						})
					}
				>
					{t("code.abort")}
				</Button>
			</Stack>
			{error ? <Alert severity="error">{error}</Alert> : null}
			{reconnecting ? (
				<Alert severity="info">{t("code.reconnecting")}</Alert>
			) : null}
			{!repo ? <Alert severity="info">{t("code.pickProject")}</Alert> : null}
			<Box
				className="workbench-panel"
				sx={{
					display: "grid",
					gridTemplateColumns: { xs: "1fr", md: "220px 1fr" },
					minHeight: 420,
					overflow: "hidden",
				}}
			>
				<Stack
					spacing={0.5}
					sx={{
						borderRight: { md: "1px solid" },
						borderColor: "divider",
						p: 1,
						overflow: "auto",
					}}
				>
					<Typography variant="overline">{t("code.sessions")}</Typography>
					{view.sessions.length === 0 ? (
						<Typography color="textSecondary" variant="body2">
							{t("code.emptySessions")}
						</Typography>
					) : null}
					{view.sessions.map((session) => (
						<Button
							key={session.id}
							variant={session.id === view.sessionID ? "contained" : "text"}
							size="small"
							onClick={() =>
								setView((current) => ({ ...current, sessionID: session.id }))
							}
							sx={{ justifyContent: "flex-start" }}
						>
							{session.title}
						</Button>
					))}
				</Stack>
				<Stack spacing={1} sx={{ minWidth: 0, p: 1.5 }}>
					<Box
						ref={scroller}
						sx={{ flex: 1, minHeight: 240, overflow: "auto" }}
					>
						{view.turns.map((turn) => (
							<Box key={turn.id} sx={{ mb: 1.5 }}>
								<Typography variant="caption" color="textSecondary">
									{turn.role === "user" ? t("code.prompt") : "OpenCode"}
								</Typography>
								<Typography
									component="pre"
									sx={{
										whiteSpace: "pre-wrap",
										fontFamily: "ui-monospace, monospace",
										fontSize: 13,
										m: 0,
									}}
								>
									{turn.text}
								</Typography>
							</Box>
						))}
						{view.busy ? (
							<Typography color="textSecondary">{t("code.working")}</Typography>
						) : null}
					</Box>
					{activePermissions.map((permission) => (
						<Alert key={permission.id} severity="warning">
							<Typography>
								{t("code.permission")}: {permission.title}
							</Typography>
							{permission.detail ? (
								<Typography variant="body2">{permission.detail}</Typography>
							) : null}
							<Stack direction="row" spacing={1} sx={{ mt: 1 }}>
								<Button
									size="small"
									onClick={() => void replyPermission(permission.id, "once")}
								>
									{t("code.allowOnce")}
								</Button>
								<Button
									size="small"
									onClick={() => void replyPermission(permission.id, "always")}
								>
									{t("code.allowAlways")}
								</Button>
								<Button
									size="small"
									color="error"
									onClick={() => void replyPermission(permission.id, "reject")}
								>
									{t("code.deny")}
								</Button>
							</Stack>
						</Alert>
					))}
					{activeQuestions.map((question) => (
						<Alert key={question.id} severity="info">
							<Typography>{t("code.question")}</Typography>
							{question.prompts.map((item) => (
								<Stack key={item.question} spacing={0.5} sx={{ mt: 1 }}>
									<Typography variant="body2">
										{item.header ? `${item.header}: ` : ""}
										{item.question}
									</Typography>
									<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
										{item.options.map((option) => (
											<Button
												key={option}
												size="small"
												variant={
													answers[item.question] === option
														? "contained"
														: "outlined"
												}
												onClick={() =>
													setAnswers((current) => ({
														...current,
														[item.question]: option,
													}))
												}
											>
												{option}
											</Button>
										))}
									</Stack>
								</Stack>
							))}
							<Stack direction="row" spacing={1} sx={{ mt: 1 }}>
								<Button
									size="small"
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
								</Button>
								<Button
									size="small"
									color="error"
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
								</Button>
							</Stack>
						</Alert>
					))}
					<TextField
						label={t("code.prompt")}
						placeholder={t("code.placeholder")}
						value={prompt}
						multiline
						disabled={!view.sessionID}
						onChange={(event) => setPrompt(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								void send();
							}
						}}
					/>
					<Button
						variant="contained"
						disabled={!prompt.trim() || !view.sessionID || busy}
						onClick={() => void send()}
					>
						{busy ? t("code.sending") : t("code.send")}
					</Button>
				</Stack>
			</Box>
		</Stack>
	);
}

export async function loadCodeRepos() {
	const result = await getProjects();
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.data.repos;
}
