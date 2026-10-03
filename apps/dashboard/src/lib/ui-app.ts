import { navigate } from "@next/client";

export type BoardAppDetail = {
	appId: string;
	title: string;
};

function isCodePath(pathname: string): boolean {
	return pathname === "/devices/code" || pathname.startsWith("/devices/code/");
}

/**
 * Jump to the Code view (keeping any active ?session=) and open the given
 * board app in the middle preview pane. Mirrors the gpio-ui `app` split flow:
 * a sticky request covers the navigation race, otherwise the live event is
 * handled by the mounted OpenCodeSession.
 */
export function openBoardAppInCode(appId: string, title: string): void {
	const detail: BoardAppDetail = { appId, title };
	try {
		if (!isCodePath(window.location.pathname)) {
			const session = new URLSearchParams(window.location.search).get(
				"session",
			);
			navigate(
				session
					? `/devices/code?session=${encodeURIComponent(session)}`
					: "/devices/code",
			);
		}
		(
			window as unknown as { __gpioUiApp?: BoardAppDetail | undefined }
		).__gpioUiApp = detail;
		window.dispatchEvent(new CustomEvent("gpio-ui-app", { detail }));
	} catch {
		undefined;
	}
}
