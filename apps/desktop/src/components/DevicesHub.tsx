import Alert from "@shpaw415/mui-lite/Alert";
import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import { useEffect } from "react";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { type DeviceTabId, isAllowedDeviceTab } from "../lib/dashboard-mode";
import { useT } from "../locale";
import Admin from "./Admin";
import Debug from "./Debug";
import Docs from "./Docs";
import Overview from "./Overview";
import Pair from "./Pair";
import Requests from "./Requests";
import OpenCodeSession from "./OpenCodeSession";
import Wifi from "./Wifi";

export type DeviceTab = DeviceTabId;

export default function DevicesHub({
	tab,
	onTab,
	admin,
}: {
	tab: DeviceTab;
	onTab: (tab: DeviceTab) => void;
	admin: boolean;
}) {
	const { mode, isEasy, setMode } = useDashboardMode();
	const t = useT();
	const allowed = isAllowedDeviceTab(mode, admin, tab);

	useEffect(() => {
		if (!allowed) {
			onTab("overview");
		}
	}, [allowed, onTab]);

	const expertOnly = tab === "debug" || tab === "admin";

	return (
		<Box
			sx={{
				minWidth: 0,
				width: "100%",
			}}
		>
			<Box>
				{isEasy && expertOnly ? (
					<Alert severity="info">
						{t("mode.expertPage")}{" "}
						<Button
							type="button"
							variant="text"
							onClick={() => setMode("expert")}
						>
							{t("mode.switchToExpertShort")}
						</Button>
					</Alert>
				) : (
					<>
						{tab === "overview" ? (
							<Overview onAddBoard={() => onTab("pair")} />
						) : null}
						{tab === "docs" ? <Docs /> : null}
						{tab === "code" ? <OpenCodeSession /> : null}
						{tab === "pair" ? <Pair onBack={() => onTab("overview")} /> : null}
						{tab === "wifi" ? <Wifi onBack={() => onTab("overview")} /> : null}
						{tab === "requests" ? <Requests /> : null}
						{tab === "debug" ? <Debug /> : null}
						{tab === "admin" && admin ? <Admin /> : null}
					</>
				)}
			</Box>
		</Box>
	);
}
