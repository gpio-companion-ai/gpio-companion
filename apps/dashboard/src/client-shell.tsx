import {
	RouterHost,
	type router,
} from "frame-master-plugin-apply-react/router";
import { SSRPropsProvider } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/context";
import type { PropsData } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/provider/utils";
import { isEmbedPath } from "gpio-companion";
import {
	type JSX,
	StrictMode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createClient, type PublicSession } from "./auth.ts";
import LoginDialog from "./components/LoginDialog.tsx";
import { AuthCtx, AuthSessionCtx } from "./hooks/useAuth.ts";
import { BoardSelectionProvider } from "./hooks/useBoardSelection.tsx";
import { ColorModeProvider } from "./hooks/useColorMode.tsx";
import { DashboardModeProvider } from "./hooks/useDashboardMode.tsx";
import { LocaleProvider } from "./hooks/useLocale.tsx";
import { PathnameProvider, usePathname } from "./hooks/usePathname.tsx";
import {
	identityToPublicSession,
	resolveUserIdentity,
} from "./lib/auth/identity.ts";
import {
	attachAccessCookieSync,
	installAuthAwareFetch,
	LOGIN_REQUIRED_EVENT,
	requireLogin,
	syncAccessCookie,
} from "./lib/auth/refresh.ts";
import { stashGithubAppCallbackFromLocation } from "./lib/github-app-callback.ts";

export default function ClientWrapper({ children }: { children: JSX.Element }) {
	const routeChangePromiseRef = useRef<
		ReturnType<typeof Promise.withResolvers<Array<PropsData> | null>>
	>(Promise.withResolvers<Array<PropsData> | null>());
	const resetRouteChangePromise = useCallback(
		(ref: typeof routeChangePromiseRef) => {
			ref.current.resolve?.(null);
			ref.current = Promise.withResolvers<Array<PropsData> | null>();
		},
		[],
	);
	const [pathname, setPathname] = useState(window.location.pathname);
	const [devKey, setDevKey] = useState(0);
	const matched = useRef<ReturnType<typeof router.match>>(null);

	return (
		<StrictMode>
			<SSRPropsProvider
				pathname={pathname}
				afterFetchCallback={() =>
					resetRouteChangePromise(routeChangePromiseRef)
				}
				devKey={devKey}
				fetchCallback={(_, dynamicEndpoints) => {
					const res = Boolean(
						matched.current?.name &&
							dynamicEndpoints.includes(matched.current.name),
					);
					if (!res) resetRouteChangePromise(routeChangePromiseRef);
					return res;
				}}
			>
				<PathnameProvider pathname={pathname}>
					<LocaleProvider>
						<ColorModeProvider>
							<DashboardModeProvider>
								<AuthProvider>
									<BoardSelectionProvider>
										<RouterHost
											onRouteChange={async (match) => {
												const samePath = match.pathname === pathname;
												matched.current = match;
												setPathname(match.pathname);
												if (process.env.NODE_ENV === "development") {
													setDevKey((prev) => prev + 1);
												}
												if (samePath) {
													return;
												}
												await routeChangePromiseRef.current.promise;
											}}
										>
											{children}
										</RouterHost>
									</BoardSelectionProvider>
								</AuthProvider>
							</DashboardModeProvider>
						</ColorModeProvider>
					</LocaleProvider>
				</PathnameProvider>
			</SSRPropsProvider>
		</StrictMode>
	);
}

function AuthProvider({ children }: { children: JSX.Element }) {
	const [session, setSession] = useState<PublicSession | null>(null);
	const [ready, setReady] = useState(false);
	const pathname = usePathname();
	const auth = useRef(
		createClient({
			onLoginRequired(client) {
				requireLogin(client);
				setSession(null);
			},
		}),
	);

	useEffect(() => {
		const client = auth.current;
		const onLoginRequired = () => setSession(null);
		window.addEventListener(LOGIN_REQUIRED_EVENT, onLoginRequired);
		attachAccessCookieSync(client);
		const uninstallFetch = installAuthAwareFetch(client);
		let cancelled = false;
		stashGithubAppCallbackFromLocation();
		client
			.init()
			.then(async (readyClient) => {
				if (cancelled) {
					return;
				}
				syncAccessCookie(readyClient);
				const identity = await resolveUserIdentity(readyClient);
				if (cancelled) {
					return;
				}
				if (!readyClient.getToken() || (!identity.id && !identity.email)) {
					setSession(null);
				} else {
					setSession(identityToPublicSession(identity));
				}
				setReady(true);
			})
			.catch(() => {
				if (!cancelled) {
					setSession(null);
					setReady(true);
				}
			});
		return () => {
			cancelled = true;
			uninstallFetch();
			window.removeEventListener(LOGIN_REQUIRED_EVENT, onLoginRequired);
		};
	}, []);

	// Blocking sign-in modal instead of a /login page: shown once auth init
	// finished with no session (signed out, or refresh token unrecoverable).
	// Embed routes stay clean for iframe/WebView hosts.
	const showLogin =
		ready && !session && !isEmbedPath(pathname) && !isAuthFlowPath(pathname);

	return (
		<AuthCtx.Provider value={auth.current}>
			<AuthSessionCtx.Provider value={session}>
				<div inert={showLogin} style={{ display: "contents" }}>
					{children}
				</div>
				<LoginDialog open={showLogin} />
			</AuthSessionCtx.Provider>
		</AuthCtx.Provider>
	);
}

function isAuthFlowPath(pathname: string): boolean {
	return (
		pathname === "/callback" ||
		pathname.startsWith("/callback/") ||
		pathname.startsWith("/auth/")
	);
}
