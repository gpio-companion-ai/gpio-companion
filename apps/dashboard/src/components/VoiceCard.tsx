import {
	GET as loadVoiceSettings,
	PUT as saveVoiceSettings,
} from "@api/voice-settings";
import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	CODE_TTS_XAI_DEFAULT_VOICE,
	CODE_TTS_XAI_VOICES,
	CODE_VOICE_PRICE_WORKERS_AI,
	CODE_VOICE_PRICE_XAI,
	type CodeVoiceSettings,
	codeVoiceSettings,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";

export default function VoiceCard() {
	const t = useT();
	const [settings, setSettings] = useState<CodeVoiceSettings | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const result = await loadVoiceSettings();
				if (!cancelled) {
					setSettings(codeVoiceSettings(result.ok ? result.data : undefined));
				}
			} catch {
				if (!cancelled) {
					setSettings(codeVoiceSettings(undefined));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	async function save(next: CodeVoiceSettings) {
		setSettings(next);
		setError("");
		try {
			const result = await saveVoiceSettings({
				provider: next.provider,
				voice: next.voice,
			});
			if (!result.ok) {
				setError(translateError(t, result.error));
			}
		} catch (caught) {
			setError(
				translateError(t, caught instanceof Error ? caught.message : ""),
			);
		}
	}

	const provider = settings?.provider ?? "workers-ai";
	return (
		<Paper className="w-full p-3" elevation={1}>
			<Stack spacing={1}>
				<Stack
					direction="row"
					spacing={1}
					className="flex-wrap items-center justify-between"
				>
					<Typography variant="subtitle1">{t("voice.title")}</Typography>
					<Select
						name="provider"
						label={t("voice.provider")}
						value={provider}
						onSelect={(next) => {
							void save(
								codeVoiceSettings({
									provider: next,
									voice: next === "xai" ? CODE_TTS_XAI_DEFAULT_VOICE : "",
								}),
							);
						}}
						className="w-full max-w-xs"
					>
						<option value="workers-ai">
							{`${t("voice.providerWorkersAi")} · ${CODE_VOICE_PRICE_WORKERS_AI}`}
						</option>
						<option value="xai">
							{`${t("voice.providerXai")} · ${CODE_VOICE_PRICE_XAI}`}
						</option>
					</Select>
					{provider === "xai" ? (
						<Select
							name="voice"
							label={t("voice.voiceType")}
							value={settings?.voice || CODE_TTS_XAI_DEFAULT_VOICE}
							onSelect={(next) => {
								void save({
									provider: "xai",
									voice: next,
								});
							}}
							className="w-full max-w-xs"
						>
							{CODE_TTS_XAI_VOICES.map((voice) => (
								<option key={voice} value={voice}>
									{voice}
								</option>
							))}
						</Select>
					) : null}
				</Stack>
				<Typography variant="body2" color="secondary">
					{t("voice.hint")}
				</Typography>
				{error ? <Typography color="error">{error}</Typography> : null}
			</Stack>
		</Paper>
	);
}
