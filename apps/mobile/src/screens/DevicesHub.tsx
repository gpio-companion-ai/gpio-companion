import { useEffect } from "react";
import { View } from "react-native";
import { Paper, PrimaryButton, Title } from "../components/ui.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { isAllowedDeviceTab } from "../lib/dashboard-mode.ts";
import { useDashboardMode } from "../lib/dashboard-mode.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { useT } from "../lib/locale.tsx";
import Admin from "./Admin.tsx";
import Code from "./Code.tsx";
import Debug from "./Debug.tsx";
import Docs from "./Docs.tsx";
import Overview from "./Overview.tsx";
import Pair from "./Pair.tsx";
import Requests from "./Requests.tsx";
import Wifi from "./Wifi.tsx";

export default function DevicesHub() {
	const colors = useColors();
	const auth = useAuth();
	const { tab, setTab } = useDeviceHub();
	const { mode, isEasy, setMode } = useDashboardMode();
	const t = useT();
	const admin = auth.session?.role === "admin";
	const allowed = isAllowedDeviceTab(mode, admin, tab);
	const expertOnly = tab === "debug" || tab === "admin";

	useEffect(() => {
		if (!allowed) {
			setTab("overview");
		}
	}, [allowed, setTab]);

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<View style={{ flex: 1, minHeight: 0 }}>
				{isEasy && expertOnly ? (
					<Paper>
						<Title>{t("mode.expertTitle")}</Title>
						<PrimaryButton
							label={t("mode.switchToExpertShort")}
							onPress={() => setMode("expert")}
						/>
					</Paper>
				) : (
					<>
						{tab === "overview" ? <Overview /> : null}
						{tab === "docs" ? <Docs /> : null}
						{tab === "code" ? <Code /> : null}
						{tab === "pair" ? <Pair /> : null}
						{tab === "wifi" ? <Wifi /> : null}
						{tab === "requests" ? <Requests /> : null}
						{tab === "debug" ? <Debug /> : null}
						{tab === "admin" && admin ? <Admin /> : null}
					</>
				)}
			</View>
		</View>
	);
}
