export type DashboardMode = "easy" | "expert";

export const DASHBOARD_MODE_STORAGE_KEY = "gpio-companion-dashboard-mode";

export type DeviceTabId =
	| "overview"
	| "docs"
	| "code"
	| "pair"
	| "wifi"
	| "requests"
	| "debug"
	| "admin";

export type DeviceTabLabelKey =
	| "nav.myBoard"
	| "nav.wifi"
	| "nav.code"
	| "nav.learn"
	| "nav.pair"
	| "nav.requests"
	| "nav.debug"
	| "nav.admin";

export const DEVICE_TABS_EASY: Array<{
	id: DeviceTabId;
	labelKey: DeviceTabLabelKey;
}> = [
	{ id: "overview", labelKey: "nav.myBoard" },
	{ id: "wifi", labelKey: "nav.wifi" },
	{ id: "docs", labelKey: "nav.learn" },
];

export const DEVICE_TABS_EXPERT: Array<{
	id: DeviceTabId;
	labelKey: DeviceTabLabelKey;
}> = [
	{ id: "overview", labelKey: "nav.myBoard" },
	{ id: "docs", labelKey: "nav.learn" },
	{ id: "pair", labelKey: "nav.pair" },
	{ id: "wifi", labelKey: "nav.wifi" },
	{ id: "requests", labelKey: "nav.requests" },
	{ id: "debug", labelKey: "nav.debug" },
];

export function parseDashboardMode(
	value: string | null | undefined,
): DashboardMode {
	return value === "expert" ? "expert" : "easy";
}

export function deviceTabs(
	mode: DashboardMode,
	admin: boolean,
): Array<{ id: DeviceTabId; labelKey: DeviceTabLabelKey }> {
	const tabs = mode === "easy" ? DEVICE_TABS_EASY : DEVICE_TABS_EXPERT;
	if (mode === "expert" && admin) {
		return [...tabs, { id: "admin", labelKey: "nav.admin" }];
	}
	return tabs;
}

export function isAllowedDeviceTab(
	mode: DashboardMode,
	admin: boolean,
	tab: DeviceTabId,
): boolean {
	if (tab === "pair" || tab === "code") {
		return true;
	}
	return deviceTabs(mode, admin).some((item) => item.id === tab);
}
