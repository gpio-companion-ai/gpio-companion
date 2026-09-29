export type DashboardMode = "easy" | "expert";

export const DASHBOARD_MODE_STORAGE_KEY = "gpio-companion-dashboard-mode";

export type SectionTab = {
	href: string;
	labelKey:
		| "nav.myBoard"
		| "nav.wifi"
		| "nav.code"
		| "nav.learn"
		| "nav.pair"
		| "nav.requests"
		| "nav.debug"
		| "nav.admin"
		| "nav.account"
		| "nav.github"
		| "nav.credits";
};

export const DEVICE_TABS_EASY: SectionTab[] = [
	{ href: "/devices", labelKey: "nav.myBoard" },
	{ href: "/devices/wifi", labelKey: "nav.wifi" },
	{ href: "/devices/code", labelKey: "nav.code" },
	{ href: "/devices/docs", labelKey: "nav.learn" },
];

export const DEVICE_TABS_EXPERT: SectionTab[] = [
	{ href: "/devices", labelKey: "nav.myBoard" },
	{ href: "/devices/docs", labelKey: "nav.learn" },
	{ href: "/devices/code", labelKey: "nav.code" },
	{ href: "/devices/pair", labelKey: "nav.pair" },
	{ href: "/devices/wifi", labelKey: "nav.wifi" },
	{ href: "/devices/notifications", labelKey: "nav.requests" },
	{ href: "/devices/debug", labelKey: "nav.debug" },
];

export const DEVICE_TAB_ADMIN: SectionTab = {
	href: "/devices/admin",
	labelKey: "nav.admin",
};

export const PROFILE_TABS: SectionTab[] = [
	{ href: "/profile", labelKey: "nav.account" },
	{ href: "/profile/github", labelKey: "nav.github" },
	{ href: "/profile/credits", labelKey: "nav.credits" },
];

const EXPERT_ONLY_PATHS = ["/devices/debug", "/devices/admin"] as const;

export function parseDashboardMode(
	value: string | null | undefined,
): DashboardMode {
	return value === "expert" ? "expert" : "easy";
}

export function deviceTabs(mode: DashboardMode, admin: boolean): SectionTab[] {
	const tabs = mode === "easy" ? DEVICE_TABS_EASY : DEVICE_TABS_EXPERT;
	if (mode === "expert" && admin) {
		return [...tabs, DEVICE_TAB_ADMIN];
	}
	return tabs;
}

export function isExpertOnlyPath(pathname: string): boolean {
	return EXPERT_ONLY_PATHS.some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	);
}

export function withSearch(path: string, search: string): string {
	if (!search || search === "?") {
		return path;
	}
	return `${path}${search.startsWith("?") ? search : `?${search}`}`;
}
