import {
	CODE_TTS_XAI_DEFAULT_VOICE,
	CODE_TTS_XAI_VOICES,
	CODE_VOICE_PRICE_WORKERS_AI,
	CODE_VOICE_PRICE_XAI,
	type CodeVoiceSettings,
	codeVoiceSettings,
} from "gpio-companion-attach";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getVoiceSettings, saveVoiceSettings } from "../lib/api.ts";
import { useColors } from "../lib/color-mode.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import { Body, Paper } from "./ui.tsx";

function Pill({
	label,
	selected,
	onPress,
	colors,
}: {
	label: string;
	selected: boolean;
	onPress: () => void;
	colors: ReturnType<typeof useColors>;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={{
				paddingVertical: 8,
				paddingHorizontal: 14,
				borderRadius: 999,
				borderWidth: selected ? 2 : 1,
				borderColor: selected ? colors.primary : colors.border,
				backgroundColor: selected ? colors.primary : colors.surface,
			}}
		>
			<Text
				style={{
					color: selected ? colors.primaryText : colors.text,
					fontWeight: "600",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

export default function VoiceCard({ token }: { token: string }) {
	const t = useT();
	const colors = useColors();
	const [settings, setSettings] = useState<CodeVoiceSettings>(
		codeVoiceSettings(undefined),
	);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		if (!token) {
			return () => {
				cancelled = true;
			};
		}
		void getVoiceSettings(token)
			.then((result) => {
				if (!cancelled) {
					setSettings(codeVoiceSettings(result));
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [token]);

	async function save(next: CodeVoiceSettings) {
		if (!token) {
			return;
		}
		setSettings(next);
		setError("");
		try {
			const result = await saveVoiceSettings(token, next.provider, next.voice);
			setSettings(codeVoiceSettings(result));
		} catch (caught) {
			setError(
				translateError(t, caught instanceof Error ? caught.message : ""),
			);
		}
	}

	return (
		<Paper>
			<Body>{t("voice.title")}</Body>
			{error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				<Pill
					colors={colors}
					label={`${t("voice.providerWorkersAi")} · ${CODE_VOICE_PRICE_WORKERS_AI}`}
					selected={settings.provider === "workers-ai"}
					onPress={() =>
						void save(codeVoiceSettings({ provider: "workers-ai", voice: "" }))
					}
				/>
				<Pill
					colors={colors}
					label={`${t("voice.providerXai")} · ${CODE_VOICE_PRICE_XAI}`}
					selected={settings.provider === "xai"}
					onPress={() =>
						void save(
							codeVoiceSettings({
								provider: "xai",
								voice: CODE_TTS_XAI_DEFAULT_VOICE,
							}),
						)
					}
				/>
			</View>
			{settings.provider === "xai" ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
					{CODE_TTS_XAI_VOICES.map((voice) => (
						<Pill
							key={voice}
							colors={colors}
							label={voice}
							selected={settings.voice === voice}
							onPress={() => void save({ provider: "xai", voice })}
						/>
					))}
				</View>
			) : null}
		</Paper>
	);
}
