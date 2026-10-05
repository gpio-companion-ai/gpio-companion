import { translateError } from "gpio-companion-i18n";
import {
	onOpenSupportChat,
	type SupportChatState,
} from "gpio-companion-support";
import { useEffect, useState } from "react";
import {
	Modal,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listDeviceStatus, supportChat, supportChatSend } from "../lib/api.ts";
import { CACHE_KEYS, useCachedQuery } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useLocale, useT } from "../lib/locale.tsx";

const EMPTY: SupportChatState = { status: "idle", messages: [] };

export default function SupportChat() {
	const t = useT();
	const colors = useColors();
	const insets = useSafeAreaInsets();
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
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<SupportChatState>(EMPTY);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => onOpenSupportChat(() => setOpen(true)), []);

	useEffect(() => {
		if (!open || !token) {
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
	}, [open, token]);

	async function send(restart = false) {
		if (!token) {
			setError(t("common.signInFirst"));
			return;
		}
		const body = restart ? t("profile.bugNew") : text.trim();
		if (!body && !restart) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			const next = await supportChatSend(token, {
				text: body,
				surface: "mobile",
				locale,
				boardUuid: uuid,
				boardModel: board?.status?.model ?? "",
				restart,
			});
			setState(next);
			setText("");
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			setBusy(false);
		}
	}

	const completed = state.status === "completed";

	return (
		<>
			<Pressable
				accessibilityRole="button"
				onPress={() => setOpen(true)}
				style={{
					position: "absolute",
					right: 16,
					bottom: insets.bottom + 72,
					zIndex: 20,
					backgroundColor: colors.surface,
					borderColor: colors.border,
					borderWidth: 1,
					borderRadius: 999,
					paddingHorizontal: 14,
					paddingVertical: 10,
				}}
			>
				<Text style={{ color: colors.text }}>{t("profile.bugTitle")}</Text>
			</Pressable>
			<Modal
				visible={open}
				animationType="slide"
				onRequestClose={() => setOpen(false)}
			>
				<View
					style={{
						flex: 1,
						backgroundColor: colors.bg,
						paddingTop: insets.top + 8,
						paddingBottom: insets.bottom + 8,
					}}
				>
					<View
						style={{
							flexDirection: "row",
							justifyContent: "space-between",
							paddingHorizontal: 16,
							paddingBottom: 8,
						}}
					>
						<Text style={{ color: colors.text, fontWeight: "600" }}>
							{t("profile.bugChatTitle")}
						</Text>
						<Pressable onPress={() => setOpen(false)}>
							<Text style={{ color: colors.muted }}>
								{t("profile.bugClose")}
							</Text>
						</Pressable>
					</View>
					<ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
						<Text style={{ color: colors.text }}>
							{t("profile.bugGreeting")}
						</Text>
						{state.messages.map((message) => (
							<Text
								key={message.id}
								style={{
									color: colors.text,
									alignSelf:
										message.role === "user" ? "flex-end" : "flex-start",
								}}
							>
								{message.tool ? `${message.tool}: ` : ""}
								{message.text}
							</Text>
						))}
						{completed ? (
							<Text style={{ color: colors.text }}>
								{t("profile.bugThanks")}
							</Text>
						) : null}
						{error ? (
							<Text style={{ color: colors.danger ?? colors.text }}>
								{translateError(t, error)}
							</Text>
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
			</Modal>
		</>
	);
}
