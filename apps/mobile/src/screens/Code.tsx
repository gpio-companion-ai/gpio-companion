import {
	applyOpencodeEvent,
	emptyOpencodeView,
	type OpencodePermissionResponse,
	type OpencodeView,
	opencodeSessions,
	opencodeTurns,
	readOpencodeEventStream,
} from "gpio-companion-opencode";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import {
	ErrorText,
	Field,
	Muted,
	Paper,
	PrimaryButton,
	TextButton,
	Title,
} from "../components/ui.tsx";
import { listProjects, opencodeCall, openOpencodeEvents } from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useT } from "../lib/locale.tsx";
import { storageGet, storageSet } from "../lib/storage.ts";

const PROJECT_KEY = "gpio-companion-selected-project";

export default function Code() {
	const t = useT();
	const colors = useColors();
	const auth = useAuth();
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
	const selected = uuid || devices[0]?.uuid || "";
	const token = auth.token ?? "";

	useEffect(() => {
		if (!token) return;
		void listProjects(token)
			.then(async (result) => {
				const next = result.repos.map((item) => ({
					owner: item.owner,
					name: item.name,
				}));
				setRepos(next);
				const stored = (await storageGet(PROJECT_KEY)) ?? "";
				const name = stored.includes("/") ? stored.split("/").pop() : stored;
				setRepo(
					next.find((item) => item.name === name)?.name ?? next[0]?.name ?? "",
				);
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			});
	}, [token]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		void opencodeCall(token, { uuid: selected, repo, op: "sessions" })
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
	}, [token, selected, repo]);

	useEffect(() => {
		if (!token || !selected || !repo || !view.sessionID) return;
		let cancelled = false;
		void opencodeCall(token, {
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
	}, [token, selected, repo, view.sessionID]);

	useEffect(() => {
		if (!token || !selected || !repo) return;
		const controller = new AbortController();
		let lastEventId = "";
		let stopped = false;
		async function loop() {
			while (!stopped) {
				try {
					const response = await openOpencodeEvents(
						token,
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
	}, [token, selected, repo]);

	async function run(body: Parameters<typeof opencodeCall>[1]) {
		if (!token) return null;
		setError("");
		setBusy(true);
		try {
			return await opencodeCall(token, body);
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

	if (!selected) {
		return (
			<Paper>
				<Muted>{t("code.pickBoard")}</Muted>
			</Paper>
		);
	}

	const permissions = view.permissions.filter(
		(item) => item.sessionID === view.sessionID,
	);
	const questions = view.questions.filter(
		(item) => item.sessionID === view.sessionID,
	);

	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: colors.bg }}
			contentContainerStyle={{ padding: 12, gap: 10 }}
			keyboardShouldPersistTaps="handled"
		>
			<Title>{t("code.title")}</Title>
			<Muted>{t("code.subtitle")}</Muted>
			<Paper>
				<Muted>{t("code.board")}</Muted>
				{devices.map((device) => (
					<TextButton
						key={device.uuid}
						label={device.label || device.login || device.uuid}
						onPress={() => setUuid(device.uuid)}
					/>
				))}
				<Muted>{t("code.project")}</Muted>
				{repos.map((item) => (
					<TextButton
						key={`${item.owner}/${item.name}`}
						label={item.name === repo ? `● ${item.name}` : item.name}
						onPress={() => {
							setRepo(item.name);
							void storageSet(PROJECT_KEY, `${item.owner}/${item.name}`);
						}}
					/>
				))}
			</Paper>
			<ErrorText>{error}</ErrorText>
			{reconnecting ? <Muted>{t("code.reconnecting")}</Muted> : null}
			{!repo ? <Muted>{t("code.pickProject")}</Muted> : null}
			<Paper>
				<Muted>{t("code.sessions")}</Muted>
				{view.sessions.length === 0 ? (
					<Muted>{t("code.emptySessions")}</Muted>
				) : null}
				{view.sessions.map((session) => (
					<TextButton
						key={session.id}
						label={
							session.id === view.sessionID
								? `● ${session.title}`
								: session.title
						}
						onPress={() =>
							setView((current) => ({ ...current, sessionID: session.id }))
						}
					/>
				))}
				<PrimaryButton
					label={t("code.newSession")}
					disabled={!repo || busy}
					onPress={() => void createSession()}
				/>
			</Paper>
			<Paper>
				{view.turns.map((turn) => (
					<View key={turn.id} style={{ gap: 4 }}>
						<Muted>
							{turn.role === "user" ? t("code.prompt") : "OpenCode"}
						</Muted>
						<Text style={{ color: colors.text, fontFamily: "monospace" }}>
							{turn.text}
						</Text>
					</View>
				))}
				{view.busy ? <Muted>{t("code.working")}</Muted> : null}
				{permissions.map((permission) => (
					<Paper key={permission.id}>
						<Text style={{ color: colors.text }}>
							{t("code.permission")}: {permission.title}
						</Text>
						{permission.detail ? <Muted>{permission.detail}</Muted> : null}
						<TextButton
							label={t("code.allowOnce")}
							onPress={() => void replyPermission(permission.id, "once")}
						/>
						<TextButton
							label={t("code.allowAlways")}
							onPress={() => void replyPermission(permission.id, "always")}
						/>
						<TextButton
							label={t("code.deny")}
							danger
							onPress={() => void replyPermission(permission.id, "reject")}
						/>
					</Paper>
				))}
				{questions.map((question) => (
					<Paper key={question.id}>
						<Muted>{t("code.question")}</Muted>
						{question.prompts.map((item) => (
							<View key={item.question}>
								<Text style={{ color: colors.text }}>{item.question}</Text>
								{item.options.map((option) => (
									<TextButton
										key={option}
										label={
											answers[item.question] === option ? `● ${option}` : option
										}
										onPress={() =>
											setAnswers((current) => ({
												...current,
												[item.question]: option,
											}))
										}
									/>
								))}
							</View>
						))}
						<PrimaryButton
							label={t("code.reply")}
							onPress={() =>
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
						/>
						<TextButton
							label={t("code.reject")}
							danger
							onPress={() =>
								void run({
									uuid: selected,
									repo,
									op: "question",
									requestID: question.id,
									reject: true,
								})
							}
						/>
					</Paper>
				))}
				<Field
					label={t("code.prompt")}
					value={prompt}
					placeholder={t("code.placeholder")}
					onChangeText={setPrompt}
					autoCapitalize="sentences"
				/>
				<PrimaryButton
					label={busy ? t("code.sending") : t("code.send")}
					disabled={!prompt.trim() || !view.sessionID || busy}
					onPress={() => void send()}
				/>
				<TextButton
					label={t("code.abort")}
					danger
					disabled={!view.sessionID || busy}
					onPress={() =>
						void run({
							uuid: selected,
							repo,
							op: "abort",
							sessionID: view.sessionID,
						})
					}
				/>
			</Paper>
		</ScrollView>
	);
}
