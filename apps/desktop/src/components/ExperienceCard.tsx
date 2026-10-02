import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	PROFILE_CONTEXTS,
	PROFILE_LEVELS,
	profileFrom,
	type UserProfile,
} from "gpio-companion-config";
import type { MessageKey, Messages } from "gpio-companion-i18n";
import { useEffect, useState } from "react";
import { getProfile, saveProfile } from "../api";
import { useT } from "../locale";

export default function ExperienceCard() {
	const t = useT();
	const [profile, setProfile] = useState<Partial<UserProfile> | null>(null);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void getProfile()
			.then((result) => {
				if (!cancelled) {
					setProfile(profileFrom(result));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProfile(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save(next: Partial<UserProfile>) {
		setProfile((current) => ({ ...(current ?? {}), ...next }));
		setError("");
		setSaved(false);
		const level = next.level ?? profile?.level;
		const context = next.context ?? profile?.context;
		if (!level || !context) {
			return;
		}
		try {
			await saveProfile({ level, context });
			setSaved(true);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		}
	}

	return (
		<Paper sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">
					{t("profile.experienceTitle")}
				</Typography>
				<Typography variant="body2" color="secondary">
					{t("profile.experienceHint")}
				</Typography>
				<Stack
					direction="row"
					spacing={1}
					sx={{ alignItems: "center", flexWrap: "wrap" }}
				>
					<Select
						name="level"
						label={t("profile.experienceLevel")}
						value={profile?.level ?? ""}
						onSelect={(next) => {
							if (next) {
								void save({ level: next as UserProfile["level"] });
							}
						}}
						sx={{ maxWidth: 280 }}
					>
						{PROFILE_LEVELS.map((level) => (
							<option key={level} value={level}>
								{t(`profile.experienceLevel_${level}` as MessageKey<Messages>)}
							</option>
						))}
					</Select>
					<Select
						name="context"
						label={t("profile.experienceContext")}
						value={profile?.context ?? ""}
						onSelect={(next) => {
							if (next) {
								void save({ context: next as UserProfile["context"] });
							}
						}}
						sx={{ maxWidth: 280 }}
					>
						{PROFILE_CONTEXTS.map((context) => (
							<option key={context} value={context}>
								{t(
									`profile.experienceContext_${context}` as MessageKey<Messages>,
								)}
							</option>
						))}
					</Select>
				</Stack>
				{saved ? (
					<Typography variant="body2" color="secondary">
						{t("profile.experienceSaved")}
					</Typography>
				) : null}
				{error ? (
					<Typography variant="body2" color="error">
						{error}
					</Typography>
				) : null}
			</Stack>
		</Paper>
	);
}
