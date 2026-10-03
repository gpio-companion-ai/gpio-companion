import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { type AppLiveGrant, mintAppFrame } from "../lib/api.ts";
import { useColors } from "../lib/color-mode.tsx";
import { useT } from "../lib/locale.tsx";

type Props = {
	token: string;
	uuid: string;
	appId: string;
	title: string;
	onClose?: () => void;
};

const RENEW_CHECK_MS = 30_000;
const RENEW_AHEAD_MS = 60_000;

export default function AppWebView({
	token,
	uuid,
	appId,
	title,
	onClose,
}: Props) {
	const t = useT();
	const colors = useColors();
	const [grant, setGrant] = useState<AppLiveGrant | null>(null);
	const [error, setError] = useState("");
	const [reloadKey, setReloadKey] = useState(0);
	const grantRef = useRef<AppLiveGrant | null>(null);
	grantRef.current = grant;

	useEffect(() => {
		let cancelled = false;
		async function mint(reload: boolean) {
			try {
				const next = await mintAppFrame(token, uuid, appId);
				if (cancelled) {
					return;
				}
				setGrant(next);
				setError("");
				if (reload) {
					setReloadKey((key) => key + 1);
				}
			} catch (caught) {
				if (!cancelled) {
					setError(
						caught instanceof Error ? caught.message : t("code.appError"),
					);
				}
			}
		}
		void mint(false);
		const timer = setInterval(() => {
			const current = grantRef.current;
			if (!current || Date.now() >= current.expiresAt - RENEW_AHEAD_MS) {
				void mint(true);
			}
		}, RENEW_CHECK_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [token, uuid, appId, t]);

	function reload() {
		const current = grantRef.current;
		if (current && Date.now() < current.expiresAt - RENEW_AHEAD_MS) {
			setReloadKey((key) => key + 1);
			return;
		}
		void (async () => {
			try {
				const next = await mintAppFrame(token, uuid, appId);
				setGrant(next);
				setError("");
				setReloadKey((key) => key + 1);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : t("code.appError"));
			}
		})();
	}

	return (
		<View style={{ flex: 1, minHeight: 0 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 8,
					paddingVertical: 6,
					borderBottomWidth: 1,
					borderBottomColor: colors.border,
				}}
			>
				<Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
					{title}
				</Text>
				<Pressable
					onPress={reload}
					disabled={Boolean(error) || !grant}
					style={{ minHeight: 40, justifyContent: "center" }}
					accessibilityLabel={t("code.appReload")}
				>
					<Text
						style={{
							color: error || !grant ? colors.muted : colors.primary,
						}}
					>
						{t("code.appReload")}
					</Text>
				</Pressable>
				{onClose ? (
					<Pressable
						onPress={onClose}
						style={{ minHeight: 40, justifyContent: "center" }}
						accessibilityLabel={t("code.appClose")}
					>
						<Text style={{ color: colors.primary }}>{t("code.appClose")}</Text>
					</Pressable>
				) : null}
			</View>
			{error ? (
				<Text style={{ color: colors.text, padding: 12 }}>{error}</Text>
			) : grant ? (
				<WebView
					key={`${appId}-${grant.token.slice(0, 8)}-${reloadKey}`}
					source={{ uri: grant.url }}
					startInLoadingState
					renderLoading={() => (
						<View
							style={{
								flex: 1,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<ActivityIndicator size="large" color={colors.primary} />
						</View>
					)}
				/>
			) : (
				<View
					style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
				>
					<ActivityIndicator size="large" color={colors.primary} />
				</View>
			)}
		</View>
	);
}
