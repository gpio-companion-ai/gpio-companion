import { translateError } from "gpio-companion-i18n";
import type {
	SupportChatMessage,
	SupportChatState,
} from "gpio-companion-support";
import { useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { Blocks } from "./OcMarkdown.tsx";
import { listDeviceStatus, supportChat, supportChatSend } from "../lib/api.ts";
import { CACHE_KEYS, useCachedQuery } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useLocale, useT } from "../lib/locale.tsx";

const EMPTY: SupportChatState = { status: "idle", messages: [] };

type ToolNote = {
	id: string;
	name: string;
	text: string;
	status?: "running" | "done" | "error";
};
type TranscriptRow =
	| { kind: "user"; id: string; text: string }
	| { kind: "agent"; id: string; text: string }
	| { kind: "tools"; id: string; tools: ToolNote[] };

function oneLine(text: string): string {
	const line = text.split("\n").find((part) => part.trim()) ?? "";
	return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}

function toolStatus(text: string): "done" | "error" {
	const lower = text.toLowerCase();
	if (lower.startsWith("project lookup") || lower.includes("unavailable")) {
		return "error";
	}
	return "done";
}

function transcriptRows(messages: SupportChatMessage[]): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	for (const message of messages) {
		if (message.role === "tool") {
			const note = {
				id: message.id,
				name: message.tool || "tool",
				text: message.text,
			};
			const last = rows.at(-1);
			if (last?.kind === "tools") {
				last.tools.push(note);
			} else {
				rows.push({ kind: "tools", id: message.id, tools: [note] });
			}
			continue;
		}
		rows.push({
			kind: message.role === "user" ? "user" : "agent",
			id: message.id,
			text: message.text,
		});
	}
	return rows;
}

function Mark({ status }: { status: "done" | "error" | "running" }) {
	const colors = useColors();
	if (status === "running") {
		return <ActivityIndicator size="small" color={colors.primary} />;
	}
	return (
		<Text
			style={{
				fontSize: 12,
				fontWeight: "700",
				color: status === "error" ? colors.warning : colors.success,
			}}
		>
			{status === "error" ? "✕" : "✓"}
		</Text>
	);
}

function noteStatus(tool: ToolNote): "running" | "done" | "error" {
	return tool.status ?? toolStatus(tool.text);
}

function SupportTools({ tools }: { tools: ToolNote[] }) {
	const t = useT();
	const colors = useColors();
	const running = tools.some((tool) => noteStatus(tool) === "running");
	const touched = useRef(false);
	const [open, setOpen] = useState(running);
	const [info, setInfo] = useState("");
	useEffect(() => {
		if (!touched.current) {
			setOpen(running);
		}
	}, [running]);
	const names = [...new Set(tools.map((tool) => tool.name))].join(", ");
	const label =
		tools.length === 1 ? names : t("code.toolStack", { n: tools.length, names });
	const status = running
		? "running"
		: tools.some((tool) => noteStatus(tool) === "error")
			? "error"
			: "done";
	return (
		<View
			style={{
				borderWidth: 1,
				borderColor: colors.border,
				borderRadius: 10,
				backgroundColor: colors.chipBg,
				overflow: "hidden",
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={() => {
					touched.current = true;
					setOpen((value) => !value);
				}}
				style={{
					minHeight: 36,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 10,
					paddingVertical: 6,
				}}
			>
				<Text style={{ color: colors.muted, fontSize: 10 }}>
					{open ? "▾" : "▸"}
				</Text>
				<Text
					numberOfLines={1}
					style={{ flex: 1, color: colors.text, fontWeight: "600" }}
				>
					{label}
				</Text>
				<Mark status={status} />
			</Pressable>
			{open ? (
				<View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
					{tools.map((tool, index) => {
						const rowStatus = noteStatus(tool);
						const summary = oneLine(tool.text);
						return (
							<View
								key={tool.id}
								style={{
									borderTopWidth: index === 0 ? 0 : 1,
									borderTopColor: colors.border,
								}}
							>
								<Pressable
									accessibilityRole="button"
									accessibilityState={{ expanded: info === tool.id }}
									onPress={() =>
										setInfo((current) => (current === tool.id ? "" : tool.id))
									}
									style={{
										minHeight: 34,
										flexDirection: "row",
										alignItems: "center",
										gap: 8,
										paddingLeft: 13,
										paddingRight: 10,
										paddingVertical: 5,
									}}
								>
									<Text style={{ color: colors.muted, fontSize: 10 }}>
										{info === tool.id ? "▾" : "▸"}
									</Text>
									<Text
										numberOfLines={1}
										style={{
											maxWidth: "45%",
											color: colors.text,
											fontWeight: "600",
											textTransform: "capitalize",
										}}
									>
										{tool.name}
									</Text>
									{summary ? (
										<Text
											numberOfLines={1}
											style={{ flex: 1, color: colors.muted, fontSize: 12 }}
										>
											{summary}
										</Text>
									) : (
										<View style={{ flex: 1 }} />
									)}
									<Mark status={rowStatus} />
								</Pressable>
								{info === tool.id && tool.text ? (
									<ScrollView horizontal nestedScrollEnabled>
										<Text
											style={{
												color: colors.text,
												fontFamily: "monospace",
												fontSize: 12,
												backgroundColor: colors.surface,
												marginHorizontal: 10,
												marginBottom: 8,
												padding: 8,
												borderRadius: 8,
											}}
										>
											{tool.text}
										</Text>
									</ScrollView>
								) : null}
							</View>
						);
					})}
				</View>
			) : null}
		</View>
	);
}

export default function SupportChat() {
	const t = useT();
	const colors = useColors();
	const { locale } = useLocale();
	const auth = useAuth();
	const { uuid } = useBoardSelection();
	const token = auth.token;
	const boardsQuery = useCachedQuery(CACHE_KEYS.userBoards, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return listDeviceStatus(token);
	});
	const board = boardsQuery.data?.devices.find(
		(item) => item.device.uuid === uuid,
	);
	const [state, setState] = useState<SupportChatState>(EMPTY);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const requestGen = useRef(0);

	useEffect(() => {
		if (!token) {
			return;
		}
		let cancelled = false;
		void supportChat(token)
			.then((next) => {
				if (!cancelled) {
					setState(next);
				}
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(
						caught instanceof Error
							? caught.message
							: "support agent is not bound",
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [token]);

	async function send(restart = false) {
		if (!token) {
			setError(t("common.signInFirst"));
			return;
		}
		const body = restart ? t("profile.bugNew") : text.trim();
		if (!body && !restart) {
			return;
		}
		const gen = ++requestGen.current;
		setBusy(true);
		setError("");
		const poll = setInterval(() => {
			void supportChat(token)
				.then((next) => {
					if (requestGen.current === gen) {
						setState(next);
					}
				})
				.catch(() => undefined);
		}, 400);
		try {
			const next = await supportChatSend(token, {
				text: body,
				surface: "mobile",
				locale,
				boardUuid: uuid,
				boardModel: board?.status?.model ?? "",
				restart,
			});
			if (requestGen.current !== gen) {
				return;
			}
			setState(next);
			setText("");
		} catch (caught) {
			if (requestGen.current !== gen) {
				return;
			}
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			clearInterval(poll);
			if (requestGen.current === gen) {
				setBusy(false);
			}
		}
	}

	async function cancelReport() {
		if (!token) {
			setError(t("common.signInFirst"));
			return;
		}
		const gen = ++requestGen.current;
		setBusy(true);
		setError("");
		try {
			const next = await supportChatSend(token, {
				text: "",
				surface: "mobile",
				locale,
				cancel: true,
			});
			if (requestGen.current !== gen) {
				return;
			}
			setState(next);
			setText("");
		} catch (caught) {
			if (requestGen.current !== gen) {
				return;
			}
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			if (requestGen.current === gen) {
				setBusy(false);
			}
		}
	}

	const completed = state.status === "completed";

	return (
		<View style={{ flex: 1 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 8,
				}}
			>
				<Text style={{ color: colors.text, fontWeight: "600" }}>
					{t("profile.bugChatTitle")}
				</Text>
				{!completed && (state.status === "chatting" || busy) ? (
					<Pressable onPress={() => void cancelReport()}>
						<Text style={{ color: colors.text }}>{t("profile.bugCancel")}</Text>
					</Pressable>
				) : null}
			</View>
			<ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
				<Blocks text={t("profile.bugGreeting")} color={colors.text} />
				{transcriptRows(state.messages).map((row) => {
					if (row.kind === "user") {
						return (
							<Text
								key={row.id}
								style={{
									alignSelf: "flex-end",
									maxWidth: "85%",
									color: colors.text,
									fontWeight: "600",
									backgroundColor: colors.chipBg,
									borderRadius: 14,
									paddingHorizontal: 14,
									paddingVertical: 8,
								}}
							>
								{row.text}
							</Text>
						);
					}
					if (row.kind === "agent") {
						return <Blocks key={row.id} text={row.text} color={colors.text} />;
					}
					return <SupportTools key={row.id} tools={row.tools} />;
				})}
				{state.live?.tools.length ? (
					<SupportTools tools={state.live.tools} />
				) : null}
				{state.live?.draft ? (
					<Blocks text={state.live.draft} color={colors.text} />
				) : null}
				{busy && !completed && !state.live?.draft ? (
					<View
						style={{
							minHeight: 36,
							flexDirection: "row",
							alignItems: "center",
							gap: 8,
							borderWidth: 1,
							borderColor: colors.border,
							borderRadius: 10,
							paddingHorizontal: 10,
							backgroundColor: colors.chipBg,
						}}
					>
						<Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>
							{t("code.thinking")}
						</Text>
						<Mark status="running" />
					</View>
				) : null}
				{completed ? (
					<Blocks text={t("profile.bugThanks")} color={colors.text} />
				) : null}
				{error ? (
					<Text style={{ color: colors.danger }}>{translateError(t, error)}</Text>
				) : null}
			</ScrollView>
					{completed ? (
						<Pressable
							disabled={busy}
							onPress={() => void send(true)}
							style={{ margin: 16 }}
						>
							<Text style={{ color: colors.text }}>{t("profile.bugNew")}</Text>
						</Pressable>
					) : (
						<View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
							<TextInput
								value={text}
								onChangeText={setText}
								placeholder={t("profile.bugPlaceholder")}
								placeholderTextColor={colors.placeholder}
								editable={!busy}
								multiline
								style={{
									flex: 1,
									color: colors.text,
									borderWidth: 1,
									borderColor: colors.border,
									borderRadius: 10,
									padding: 10,
									maxHeight: 96,
								}}
							/>
							<Pressable
								disabled={busy || !text.trim()}
								onPress={() => void send()}
							>
								<Text style={{ color: colors.text }}>
									{busy ? t("profile.bugSending") : t("profile.bugSend")}
								</Text>
							</Pressable>
						</View>
			)}
		</View>
	);
}
