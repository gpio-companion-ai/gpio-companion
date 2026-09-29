import Alert from "@shpaw415/mui-lite/Alert";
import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	applyOpencodeEvent,
	emptyOpencodeView,
	type OpencodePermissionResponse,
	type OpencodeView,
	opencodeSessions,
	opencodeTurns,
	readOpencodeEventStream,
} from "gpio-companion-opencode";
import { useEffect, useRef, useState } from "react";
import { listProjects, opencodeCall, openOpencodeEvents } from "../api";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useT } from "../locale";

const PROJECT_KEY = "gpio-companion-selected-project";

export default function OpenCodeSession() {
	const t = useT();
	const { uuid, setUuid } = useBoardSelection();
	const { devices } = useUserBoards();
	const [repos, setRepos] = useState<Array<{ owner: string; name: string }>>(
		[],
	);
	const [repo, setRepo] = useState("");
	const [view, setView] = useState<OpencodeView>(emptyOpencodeView);
	const [prompt, setPrompt] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [reconnecting, setReconnecting] = useState(false);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const scroller = useRef<HTMLDivElement>(null);
	const selected = uuid || devices[0]?.uuid || "";

	useEffect(() => {
		void listProjects()
			.then((result) => {
				const next = result.repos.map((item) => ({
					owner: item.owner,
					name: item.name,
				}));
				setRepos(next);
				const stored = window.localStorage.getItem(PROJECT_KEY) ?? "";
				const name = stored.includes("/") ? stored.split("/").pop() : stored;
				setRepo(
					next.find((item) => item.name === name)?.name ?? next[0]?.name ?? "",
				);
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			});
	}, []);

	useEffect(() => {
		if (!selected || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		void opencodeCall({ uuid: selected, repo, op: "sessions" })
			.then((data) => {
				if (cancelled) return;
				const sessions = opencodeSessions(data);
				setView((current) => ({
					...current,
					sessions,
					sessionID: current.sessionID || sessions[0]?.id || "",
				}));
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
		if (!selected || !repo || !view.sessionID) return;
		let cancelled = false;
		void opencodeCall({
			uuid: selected,
			repo,
			op: "messages",
			sessionID: view.sessionID,
		})
			.then((data) => {
				if (cancelled) return;
				setView((current) =>
					current.sessionID === view.sessionID
						? { ...current, turns: opencodeTurns(data) }
						: current,
				);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selected, repo, view.sessionID]);

	useEffect(() => {
		if (!selected || !repo) return;
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
							if (id) lastEventId = id;
							setView((current) => applyOpencodeEvent(current, data));
						},
						controller.signal,
					);
				} catch (caught) {
					if (stopped || controller.signal.aborted) return;
					setReconnecting(true);
					if (caught instanceof Error && caught.name !== "AbortError") {
						setError(caught.message);
					}
				}
				if (stopped) return;
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
		view.turns.length + view.permissions.length + view.questions.length;
	useEffect(() => {
		if (scrollKey < 0) {
			return;
		}
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
	}, [scrollKey]);

	async function run(body: Parameters<typeof opencodeCall>[0]) {
		setError("");
		setBusy(true);
		try {
			return await opencodeCall(body);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
			return null;
		} finally {
			setBusy(false);
		}
	}

	async function createSession() {
		const data = await run({ uuid: selected, repo, op: "create" });
		const created = opencodeSessions(data ? [data] : [])[0];
		if (!created) return;
		setView((current) => ({
			...current,
			sessions: [
				created,
				...current.sessions.filter((item) => item.id !== created.id),
			],
			sessionID: created.id,
			turns: [],
		}));
	}

	async function send() {
		const text = prompt.trim();
		if (!text || !view.sessionID) return;
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
			uuid: selected,
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
			uuid: selected,
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

	const permissions = view.permissions.filter(
		(item) => item.sessionID === view.sessionID,
	);
	const questions = view.questions.filter(
		(item) => item.sessionID === view.sessionID,
	);

	if (!selected) {
		return <Alert severity="info">{t("code.pickBoard")}</Alert>;
	}

	return (
		<Stack spacing={1.5} className="project-workbench">
			<Typography variant="h5">{t("code.title")}</Typography>
			<Typography color="textSecondary">{t("code.subtitle")}</Typography>
			<Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
				<select
					value={selected}
					onChange={(event) => setUuid(event.target.value)}
					aria-label={t("code.board")}
				>
					{devices.map((device) => (
						<option key={device.uuid} value={device.uuid}>
							{device.label || device.login || device.uuid}
						</option>
					))}
				</select>
				<select
					value={repo}
					aria-label={t("code.project")}
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
				>
					{repos.map((item) => (
						<option key={`${item.owner}/${item.name}`} value={item.name}>
							{item.name}
						</option>
					))}
				</select>
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
							uuid: selected,
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
					gridTemplateColumns: "220px 1fr",
					minHeight: 420,
					overflow: "hidden",
				}}
			>
				<Stack spacing={0.5} sx={{ p: 1, overflow: "auto" }}>
					<Typography variant="overline">{t("code.sessions")}</Typography>
					{view.sessions.length === 0 ? (
						<Typography variant="body2" color="textSecondary">
							{t("code.emptySessions")}
						</Typography>
					) : null}
					{view.sessions.map((session) => (
						<Button
							key={session.id}
							size="small"
							variant={session.id === view.sessionID ? "contained" : "text"}
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
					<Box ref={scroller} sx={{ minHeight: 240, overflow: "auto" }}>
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
					{permissions.map((permission) => (
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
					{questions.map((question) => (
						<Alert key={question.id} severity="info">
							{question.prompts.map((item) => (
								<Stack key={item.question} spacing={0.5}>
									<Typography variant="body2">{item.question}</Typography>
									<Stack direction="row" spacing={1}>
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
									onClick={() =>
										void run({
											uuid: selected,
											repo,
											op: "question",
											requestID: question.id,
											answers: question.prompts.map((item) => [
												answers[item.question] ?? "",
											]),
										})
									}
								>
									{t("code.reply")}
								</Button>
								<Button
									size="small"
									color="error"
									onClick={() =>
										void run({
											uuid: selected,
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
