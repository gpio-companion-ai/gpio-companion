import CssBaseline from "@shpaw415/mui-lite/CssBaseline";
import { APP_DATA } from "./common.ts";
import { ColorModeProvider } from "./hooks/useColorMode.tsx";
import { DashboardModeProvider } from "./hooks/useDashboardMode.tsx";
import { LocaleProvider } from "./hooks/useLocale.tsx";

export default function RenderShell({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: blocking pre-hydration theme/locale bootstrap must be inline
					dangerouslySetInnerHTML={{
						__html: `try{var m=localStorage.getItem("gpio-companion-color-mode");if(m!=="light"&&m!=="dark"){m=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=m;document.documentElement.style.colorScheme=m;var l=localStorage.getItem("gpio-companion-locale")||navigator.language||"en";l=String(l).toLowerCase().replace("_","-");document.documentElement.lang=l==="fr"||l.indexOf("fr-")===0?"fr":"en"}catch(e){}`,
					}}
				/>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, viewport-fit=cover"
				/>
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link
					rel="preconnect"
					href="https://fonts.gstatic.com"
					crossOrigin="anonymous"
				/>
				<link
					rel="stylesheet"
					href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap"
				/>
				<link rel="icon" href="/static/favicon.ico" />
				<link rel="stylesheet" href="/static/style.css" />
				<title>{APP_DATA.projectName}</title>
			</head>
			<body id="root">
				<LocaleProvider>
					<ColorModeProvider>
						<DashboardModeProvider>
							<CssBaseline />
							{children}
						</DashboardModeProvider>
					</ColorModeProvider>
				</LocaleProvider>
			</body>
		</html>
	);
}
