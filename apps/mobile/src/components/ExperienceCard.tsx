import {
	PROFILE_CONTEXTS,
	PROFILE_LEVELS,
	type ProfileContext,
	type ProfileLevel,
	profileFrom,
	type UserProfile,
} from "gpio-companion-config";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getProfile, saveProfile } from "../lib/api.ts";
import { useColors } from "../lib/color-mode.tsx";
import {
	type MessageKey,
	type Messages,
	translateError,
	useT,
} from "../lib/locale.tsx";
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

export default function ExperienceCard({ token }: { token: string }) {
	const t = useT();
	const colors = useColors();
	const [profile, setProfile] = useState<Partial<UserProfile> | null>(null);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		if (!token) {
			return () => {
				cancelled = true;
			};
		}
		void getProfile(token)
			.then((result) => {
				if (!cancelled) {
					setProfile(profileFrom(result));
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [token]);

	async function save(next: Partial<UserProfile>) {
		if (!token) {
			return;
		}
		const merged = { ...(profile ?? {}), ...next };
		setProfile(merged);
		setError("");
		setSaved(false);
		if (!merged.level || !merged.context) {
			return;
		}
		try {
			await saveProfile(token, {
				level: merged.level,
				context: merged.context,
			});
			setSaved(true);
		} catch (caught) {
			setError(
				translateError(t, caught instanceof Error ? caught.message : ""),
			);
		}
	}

	return (
		<Paper>
			<Body>{t("profile.experienceTitle")}</Body>
			{error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{PROFILE_LEVELS.map((level: ProfileLevel) => (
					<Pill
						key={level}
						colors={colors}
						label={t(
							`profile.experienceLevel_${level}` as MessageKey<Messages>,
						)}
						selected={profile?.level === level}
						onPress={() => void save({ level })}
					/>
				))}
			</View>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{PROFILE_CONTEXTS.map((context: ProfileContext) => (
					<Pill
						key={context}
						colors={colors}
						label={t(
							`profile.experienceContext_${context}` as MessageKey<Messages>,
						)}
						selected={profile?.context === context}
						onPress={() => void save({ context })}
					/>
				))}
			</View>
			{saved ? <Body>{t("profile.experienceSaved")}</Body> : null}
		</Paper>
	);
}
