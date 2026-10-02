import { GET as loadProfile, PUT as saveProfile } from "@api/profile";
import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	PROFILE_CONTEXTS,
	PROFILE_LEVELS,
	profileFrom,
	type UserProfile,
} from "gpio-companion";
import type { MessageKey, Messages } from "gpio-companion/i18n";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";

export default function ExperienceCard() {
	const t = useT();
	const [profile, setProfile] = useState<Partial<UserProfile> | null>(null);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const result = await loadProfile();
				if (!cancelled) {
					setProfile(profileFrom(result.ok ? result.data : undefined));
				}
			} catch {
				if (!cancelled) {
					setProfile(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	async function save(next: Partial<UserProfile>) {
		setProfile((current) => ({ ...(current ?? {}), ...next }));
		setError("");
		setSaved(false);
		if (!next.level && !profile?.level) {
			return;
		}
		if (!next.context && !profile?.context) {
			return;
		}
		const level = next.level ?? profile?.level;
		const context = next.context ?? profile?.context;
		if (!level || !context) {
			return;
		}
		try {
			const result = await saveProfile({ level, context });
			if (!result.ok) {
				setError(translateError(t, result.error));
				return;
			}
			setSaved(true);
		} catch (caught) {
			setError(
				translateError(t, caught instanceof Error ? caught.message : ""),
			);
		}
	}

	return (
		<Paper id="experience" className="w-full p-3" elevation={1}>
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
					className="flex-wrap items-center justify-between"
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
						className="w-full max-w-xs"
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
						className="w-full max-w-xs"
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
					<Typography color="secondary">
						{t("profile.experienceSaved")}
					</Typography>
				) : null}
				{error ? <Typography color="error">{error}</Typography> : null}
			</Stack>
		</Paper>
	);
}
