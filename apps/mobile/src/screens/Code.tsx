import { router } from "expo-router";
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
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { listProjects, opencodeCall, openOpencodeEvents } from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { useT } from "../lib/locale.tsx";
import { storageGet, storageSet } from "../lib/storage.ts";

const PROJECT_KEY = "gpio-companion-selected-project";

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

type Repo = { owner: string; name: string };
type Mode = "home" | "draft" | "session";

function Blocks({ text, color }: { text: string; color: string }) {
	const blocks = formatOpencodeBlocks(text);
	if (blocks.length === 0 && text) {
		return <Text style={{ color }}>{text}</Text>;
	}
	return blocks.map((block) => (
		<Block
			key={
				block.type === "list"
					? `list:${block.items.join("\n")}`
					: `${block.type}:${block.text}`
			}
			block={block}
			color={color}
		/>
	));
}

function Block({ block, color }: { block: OpencodeBlock; color: string }) {
	if (block.type === "code") {
		return (
			<Text
				style={{
					color,
					fontFamily: "monospace",
					fontSize: 12,
					backgroundColor: "rgba(127,127,127,0.12)",
					padding: 8,
					borderRadius: 8,
				}}
			>
				{block.text}
			</Text>
		);
	}
	if (block.type === "list") {
		return (
			<View>
				{block.items.map((item) => (
					<Text key={item} style={{ color }}>
						{"• "}
						{item}
					</Text>
				))}
			</View>
		);
	}
	return <Text style={{ color, marginBottom: 8 }}>{block.text}</Text>;
}

export default function Code() {
	const t = useT();
	const colors = useColors();
	const auth = useAuth();
	const { setTab } = useDeviceHub();
	const { uuid } = useBoardSelection();
	const { devices } = useUserBoards();
	const token = auth.token ?? "";
	const selected = uuid || devices[0]?.uuid || "";
	const [repos, setRepos] = useState<Repo[]>([]);
	const [repo, setRepo] = useState("");
	const [view, setView] = useState<OpencodeView>(emptyOpencodeView);
	const [mode, setMode] = useState<Mode>("home");
	const [prompt, setPrompt] = useState("");
	const [query, setQuery] = useState("");
	const [error, setError] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [answers, setAnswers] = useState<Record<string, string>>({});

	useEffect(() => {
		if (!token) {
			return;
		}
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

	function selectRepo(name: string) {
		setRepo(name);
		const match = repos.find((item) => item.name === name);
		if (match) {
			void storageSet(PROJECT_KEY, `${match.owner}/${match.name}`);
		}
	}

	useEffect(() => {
		if (selected) {
			setMode("home");
		}
	}, [selected]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			setView(emptyOpencodeView());
			return;
		}
		let cancelled = false;
		setView(emptyOpencodeView());
		void opencodeCall(token, { uuid: selected, repo, op: "sessions" })
			.then((data) => {
				if (!cancelled) {
					const sessions = opencodeSessions(data);
					setView((current) => ({ ...current, sessions }));
				}
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
		if (!token || !selected || !repo || mode !== "session" || !view.sessionID) {
			return;
		}
		let cancelled = false;
		const sessionID = view.sessionID;
		void opencodeCall(token, {
			uuid: selected,
			repo,
			op: "messages",
			sessionID,
		})
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
	}, [token, selected, repo, mode, view.sessionID]);

	useEffect(() => {
		if (!token || !selected || !repo) {
			return;
		}
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
	}, [token, selected, repo]);

	async function run(call: Omit<OpencodeClientCall, "uuid">) {
		setError("");
		try {
			return await opencodeCall(token, { ...call, uuid: selected });
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
			}));
			setMode("session");
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
		});
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

	const ink = { color: colors.text };
	const muted = { color: colors.muted };
	const row = {
		height: 40,
		justifyContent: "center" as const,
		paddingHorizontal: 12,
		borderRadius: 6,
	};
	const needle = query.trim().toLowerCase();
	const visible = needle
		? view.sessions.filter((item) => item.title.toLowerCase().includes(needle))
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
			sessions: visible.filter(
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

	function composer(disabled: boolean) {
		return (
			<View
				style={{
					flexDirection: "row",
					alignItems: "flex-end",
					gap: 8,
					margin: 12,
					borderRadius: 12,
					padding: 8,
					backgroundColor: colors.chipBg,
				}}
			>
				<TextInput
					value={prompt}
					placeholder={t("code.placeholder")}
					placeholderTextColor={colors.placeholder}
					editable={!disabled}
					multiline
					onChangeText={setPrompt}
					style={{ flex: 1, color: colors.text, maxHeight: 120, fontSize: 13 }}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={view.busy ? t("code.stop") : t("code.send")}
					disabled={!view.busy && (!prompt.trim() || disabled)}
					onPress={() => void (view.busy ? abort() : send())}
					style={{
						width: 28,
						height: 28,
						borderRadius: 8,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: view.busy ? "transparent" : colors.text,
						borderWidth: view.busy ? 1.5 : 0,
						borderColor: colors.text,
						opacity: !view.busy && (!prompt.trim() || disabled) ? 0.35 : 1,
					}}
				>
					<Text
						style={{
							color: view.busy ? colors.text : colors.surface,
							fontSize: 12,
						}}
					>
						{view.busy ? "■" : "↑"}
					</Text>
				</Pressable>
			</View>
		);
	}

	if (!selected) {
		return (
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					gap: 8,
				}}
			>
				<Text style={muted}>{t("code.pickBoard")}</Text>
				<Pressable onPress={() => setTab("pair")}>
					<Text style={{ color: colors.text, fontWeight: "600" }}>
						{t("code.pairBoard")}
					</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<View
				style={{
					flex: 1,
					margin: 8,
					borderRadius: 10,
					backgroundColor: colors.surface,
					overflow: "hidden",
				}}
			>
				{mode === "home" ? (
					<ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
						<Text style={[muted, { padding: 12, fontSize: 13 }]}>
							{t("code.projects")}
						</Text>
						{repos.length === 0 ? (
							<View style={{ alignItems: "center", gap: 8, padding: 16 }}>
								<Text style={muted}>{t("code.noProjects")}</Text>
								<Pressable onPress={() => router.push("/project")}>
									<Text style={{ color: colors.text, fontWeight: "600" }}>
										{t("code.openProject")}
									</Text>
								</Pressable>
							</View>
						) : (
							repos.map((item) => (
								<Pressable
									key={`${item.owner}/${item.name}`}
									onPress={() => {
										selectRepo(item.name);
										setMode("home");
									}}
									style={[
										row,
										item.name === repo
											? { borderLeftWidth: 2, borderLeftColor: colors.text }
											: null,
									]}
								>
									<Text style={ink} numberOfLines={1}>
										{item.name}
									</Text>
								</Pressable>
							))
						)}
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 8,
								padding: 12,
							}}
						>
							<TextInput
								value={query}
								placeholder={t("code.search")}
								placeholderTextColor={colors.placeholder}
								onChangeText={setQuery}
								style={{
									flex: 1,
									height: 36,
									borderRadius: 6,
									paddingHorizontal: 10,
									color: colors.text,
									backgroundColor: colors.chipBg,
								}}
							/>
							<Pressable disabled={!repo} onPress={() => setMode("draft")}>
								<Text style={{ color: colors.muted, fontWeight: "600" }}>
									{t("code.newSession")}
								</Text>
							</Pressable>
						</View>
						<Text style={[muted, { paddingHorizontal: 12, fontSize: 12 }]}>
							{reconnecting ? t("code.reconnecting") : t("code.live")}
						</Text>
						{error ? (
							<Text style={{ color: colors.danger, padding: 12 }}>{error}</Text>
						) : null}
						{visible.length === 0 ? (
							<View style={{ alignItems: "center", gap: 8, padding: 32 }}>
								<Text style={{ color: colors.text, fontWeight: "600" }}>
									{needle ? t("code.searchEmpty") : t("code.emptyTitle")}
								</Text>
								<Text style={[muted, { textAlign: "center" }]}>
									{t("code.emptyBody")}
								</Text>
								<Pressable disabled={!repo} onPress={() => setMode("draft")}>
									<Text style={{ color: colors.text, fontWeight: "600" }}>
										{t("code.newSession")}
									</Text>
								</Pressable>
							</View>
						) : (
							grouped.map((group) => (
								<View key={group.id}>
									<Text
										style={[muted, { paddingHorizontal: 12, paddingTop: 12 }]}
									>
										{group.title}
									</Text>
									{group.sessions.map((session) => (
										<Pressable
											key={session.id}
											onPress={() => {
												setView((current) => ({
													...current,
													sessionID: session.id,
													turns: [],
												}));
												setMode("session");
											}}
											style={[
												row,
												{
													flexDirection: "row",
													alignItems: "center",
													justifyContent: "space-between",
													gap: 8,
												},
											]}
										>
											<Text style={[ink, { flex: 1 }]} numberOfLines={1}>
												{session.title}
											</Text>
											{session.updated ? (
												<Text style={[muted, { fontSize: 11 }]}>
													{formatSessionTime(session.updated)}
												</Text>
											) : null}
										</Pressable>
									))}
								</View>
							))
						)}
					</ScrollView>
				) : null}
				{mode !== "home" ? (
					<View style={{ flex: 1 }}>
						<View
							style={{
								height: 44,
								flexDirection: "row",
								alignItems: "center",
								paddingHorizontal: 8,
								borderBottomWidth: 1,
								borderBottomColor: colors.border,
							}}
						>
							<Pressable onPress={() => setMode("home")}>
								<Text style={{ color: colors.muted, fontWeight: "600" }}>
									{t("code.back")}
								</Text>
							</Pressable>
							<Text
								style={[ink, { flex: 1, marginLeft: 8, fontWeight: "600" }]}
								numberOfLines={1}
							>
								{mode === "session" ? title : ""}
							</Text>
							<Text style={[muted, { fontSize: 12 }]}>
								{reconnecting ? t("code.reconnecting") : t("code.live")}
							</Text>
						</View>
						<ScrollView
							style={{ flex: 1 }}
							contentContainerStyle={{ padding: 16, gap: 12 }}
						>
							{mode === "session"
								? view.turns.map((turn) => (
										<Turn
											key={turn.id}
											turn={turn}
											color={colors.text}
											muted={colors.muted}
										/>
									))
								: null}
						</ScrollView>
						{error ? (
							<Pressable
								onPress={() => setError("")}
								style={{ paddingHorizontal: 16 }}
							>
								<Text style={{ color: colors.danger }}>{error}</Text>
							</Pressable>
						) : null}
						{permission ? (
							<View
								style={{
									margin: 12,
									padding: 12,
									borderRadius: 10,
									backgroundColor: colors.chipBg,
								}}
							>
								<Text style={ink}>
									{t("code.permission")}: {permission.title}
								</Text>
								{permission.detail ? (
									<Text style={muted}>{permission.detail}</Text>
								) : null}
								<Pressable
									onPress={() => void replyPermission(permission.id, "once")}
								>
									<Text style={ink}>{t("code.allowOnce")}</Text>
								</Pressable>
								<Pressable
									onPress={() => void replyPermission(permission.id, "always")}
								>
									<Text style={ink}>{t("code.allowAlways")}</Text>
								</Pressable>
								<Pressable
									onPress={() => void replyPermission(permission.id, "reject")}
								>
									<Text style={{ color: colors.danger }}>{t("code.deny")}</Text>
								</Pressable>
							</View>
						) : null}
						{!permission && question ? (
							<View
								style={{
									margin: 12,
									padding: 12,
									borderRadius: 10,
									backgroundColor: colors.chipBg,
								}}
							>
								{question.prompts.map((item) => (
									<View key={item.question}>
										<Text style={ink}>{item.question}</Text>
										{item.options.map((option) => (
											<Pressable
												key={option}
												onPress={() =>
													setAnswers((current) => ({
														...current,
														[item.question]: option,
													}))
												}
											>
												<Text
													style={
														answers[item.question] === option ? ink : muted
													}
												>
													{option}
												</Text>
											</Pressable>
										))}
									</View>
								))}
								<Pressable
									disabled={question.prompts.some(
										(item) => !answers[item.question],
									)}
									onPress={() =>
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
									<Text style={ink}>{t("code.reply")}</Text>
								</Pressable>
								<Pressable
									onPress={() =>
										void run({
											repo,
											op: "question",
											requestID: question.id,
											reject: true,
										})
									}
								>
									<Text style={{ color: colors.danger }}>
										{t("code.reject")}
									</Text>
								</Pressable>
							</View>
						) : null}
						{mode === "draft" ? (
							<Text style={[muted, { paddingHorizontal: 16 }]}>{repo}</Text>
						) : null}
						{composer(Boolean(permission || question) || !repo)}
					</View>
				) : null}
			</View>
		</View>
	);
}

function Turn({
	turn,
	color,
	muted,
}: {
	turn: OpencodeTurn;
	color: string;
	muted: string;
}) {
	return (
		<View style={{ gap: 6 }}>
			{turn.role === "user" ? (
				<Text style={{ color, fontWeight: "600" }}>{turn.text}</Text>
			) : (
				<Blocks text={turn.text} color={color} />
			)}
			{turn.parts
				.filter((part) => part.type === "tool")
				.map((part) => (
					<Text key={part.id} style={{ color: muted }}>
						{part.tool}
						{part.text ? `  ${part.text}` : ""}
					</Text>
				))}
		</View>
	);
}
