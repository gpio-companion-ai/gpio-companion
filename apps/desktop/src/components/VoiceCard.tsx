import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	CODE_TTS_XAI_DEFAULT_VOICE,
	CODE_TTS_XAI_VOICES,
	CODE_VOICE_PRICE_WORKERS_AI,
	CODE_VOICE_PRICE_XAI,
	type CodeVoiceProvider,
	type CodeVoiceSettings,
	codeVoiceProvider,
	codeVoiceSettings,
} from "gpio-companion-attach";
import { useEffect, useState } from "react";
import { getVoiceSettings, saveVoiceSettings } from "../api";
import { useT } from "../locale";

export default function VoiceCard() {
	const t = useT();
	const [settings, setSettings] = useState<CodeVoiceSettings | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		void getVoiceSettings()
			.then((result) => {
				if (!cancelled) {
					setSettings(codeVoiceSettings(result));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSettings(codeVoiceSettings(undefined));
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save(next: CodeVoiceSettings) {
		setSettings(next);
		setError("");
		try {
			const result = await saveVoiceSettings(next.provider, next.voice);
			setSettings(codeVoiceSettings(result));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		}
	}

	const provider = codeVoiceProvider(settings?.provider);
	return (
		<Paper sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Stack
					direction="row"
					spacing={1}
					sx={{ alignItems: "center", justifyContent: "space-between" }}
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
						sx={{ maxWidth: 280 }}
					>
						<option value="workers-ai">
							{`${t("voice.providerWorkersAi")} · ${CODE_VOICE_PRICE_WORKERS_AI}`}
						</option>
						<option value="xai">
							{`${t("voice.providerXai")} · ${CODE_VOICE_PRICE_XAI}`}
						</option>
					</Select>
				</Stack>
				{provider === "xai" ? (
					<Select
						name="voice"
						label={t("voice.voiceType")}
						value={settings?.voice || CODE_TTS_XAI_DEFAULT_VOICE}
						onSelect={(next) => {
							void save({
								provider: "xai" satisfies CodeVoiceProvider,
								voice: next,
							});
						}}
						sx={{ maxWidth: 280 }}
					>
						{CODE_TTS_XAI_VOICES.map((voice) => (
							<option key={voice} value={voice}>
								{voice}
							</option>
						))}
					</Select>
				) : null}
				<Typography variant="body2" color="secondary">
					{t("voice.hint")}
				</Typography>
				{error ? <Typography color="error">{error}</Typography> : null}
			</Stack>
		</Paper>
	);
}
