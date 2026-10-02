import { useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useT } from "../lib/locale.tsx";
import LanguageCard from "./LanguageCard.tsx";

export default function Login() {
	const auth = useAuth();
	const colors = useColors();
	const t = useT();
	const insets = useSafeAreaInsets();
	const [busy, setBusy] = useState(false);

	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
			contentContainerStyle={{
				flexGrow: 1,
				justifyContent: "center",
				alignItems: "center",
				paddingHorizontal: 20,
				paddingTop: Math.max(24, insets.top),
				paddingBottom: Math.max(24, insets.bottom),
			}}
		>
			<View
				accessibilityViewIsModal
				style={{
					width: "100%",
					maxWidth: 448,
					borderRadius: 20,
					backgroundColor: colors.bg,
					padding: 24,
					justifyContent: "center",
					gap: 12,
				}}
			>
				{!auth.ready ? (
					<ActivityIndicator color={colors.primary} />
				) : (
					<>
						<Text
							accessibilityRole="header"
							style={{
								fontSize: 22,
								fontWeight: "600",
								color: colors.text,
								textAlign: "center",
							}}
						>
							{t("auth.signInWithGithub")}
						</Text>
						<Text style={{ color: colors.muted, textAlign: "center" }}>
							{t("auth.helperMobile")}
						</Text>
						{auth.error ? (
							<Text style={{ color: colors.danger }}>{auth.error}</Text>
						) : null}
						<Pressable
							accessibilityRole="button"
							disabled={busy}
							style={{
								backgroundColor: colors.primary,
								padding: 14,
								borderRadius: 999,
								alignItems: "center",
							}}
							onPress={() => {
								setBusy(true);
								void auth.login().finally(() => setBusy(false));
							}}
						>
							<Text style={{ color: colors.primaryText, fontWeight: "600" }}>
								{busy ? t("auth.waitingGithub") : t("auth.continueWithGithub")}
							</Text>
						</Pressable>
						<LanguageCard />
					</>
				)}
			</View>
		</ScrollView>
	);
}
