import {
	RouterHost,
	type router,
} from "frame-master-plugin-apply-react/router";
import { SSRPropsProvider } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/client/context";
import type { PropsData } from "frame-master-plugin-cloudflare-pages-dynamic-ssr/provider/utils";
import {
	type JSX,
	StrictMode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createClient, type PublicSession } from "./auth.ts";
import { AuthCtx, AuthSessionCtx } from "./hooks/useAuth.ts";
import { BoardSelectionProvider } from "./hooks/useBoardSelection.tsx";
import { ColorModeProvider } from "./hooks/useColorMode.tsx";
import { DashboardModeProvider } from "./hooks/useDashboardMode.tsx";
import { LocaleProvider } from "./hooks/useLocale.tsx";
import { PathnameProvider } from "./hooks/usePathname.tsx";
import {
	identityToPublicSession,
	resolveUserIdentity,
} from "./lib/auth/identity.ts";
import {
	attachAccessCookieSync,
	installAuthAwareFetch,
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
	const auth = useRef(createClient());
	const [session, setSession] = useState<PublicSession | null>(null);

	useEffect(() => {
		const client = auth.current;
		attachAccessCookieSync(client);
		const uninstallFetch = installAuthAwareFetch(client);
		let cancelled = false;
		stashGithubAppCallbackFromLocation();
		client
			.init()
			.then(async (ready) => {
				if (cancelled) {
					return;
				}
				syncAccessCookie(ready);
				const identity = await resolveUserIdentity(ready);
				if (cancelled) {
					return;
				}
				if (!identity.id && !identity.email) {
					setSession(null);
					return;
				}
				setSession(identityToPublicSession(identity));
			})
			.catch(() => {
				if (!cancelled) {
					setSession(null);
				}
			});
		return () => {
			cancelled = true;
			uninstallFetch();
		};
	}, []);

	return (
		<AuthCtx.Provider value={auth.current}>
			<AuthSessionCtx.Provider value={session}>
				{children}
			</AuthSessionCtx.Provider>
		</AuthCtx.Provider>
	);
}
