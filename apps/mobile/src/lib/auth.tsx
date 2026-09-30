import {
	configureAuth,
	getAccessToken,
	handleAuthCallback,
	isAuthenticated,
	isNativeAuthAvailable,
	loginWithGithub,
	logout as nativeLogout,
} from "openauthster";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	getSession,
	type Session,
	setSessionLostHandler,
	setTokenProvider,
} from "./api.ts";
import { authClientId, authRedirectUri, issuerUrl } from "./config.ts";

const authOptions = {
	issuer: issuerUrl,
	clientId: authClientId,
	redirectUri: authRedirectUri,
};

type AuthState = {
	ready: boolean;
	token: string | null;
	session: Session | null;
	error: string | null;
	login: () => Promise<void>;
	logout: () => Promise<void>;
	completeAuthCallback: (url: string) => Promise<void>;
};

const AuthContext = createContext<AuthState>({
	ready: false,
	token: null,
	session: null,
	error: null,
	login: async () => undefined,
	logout: async () => undefined,
	completeAuthCallback: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
	const [ready, setReady] = useState(false);
	const [token, setToken] = useState<string | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isNativeAuthAvailable()) {
			setError(
				"OpenAuthster native module is missing. Use a dev build: npx expo run:android or npx expo run:ios (not Expo Go).",
			);
			setReady(true);
			return;
		}
		void configureAuth(authOptions)
			.then(() => isAuthenticated())
			.then(async (ok) => {
				if (!ok) {
					return;
				}
				const next = await getAccessToken();
				if (next) {
					setToken(next);
				}
			})
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "auth failed");
			})
			.finally(() => setReady(true));
	}, []);

	useEffect(() => {
		setTokenProvider(async () => {
			try {
				const next = await getAccessToken();
				if (next) {
					setToken(next);
				} else {
					setToken(null);
					setSession(null);
				}
				return next;
			} catch {
				setToken(null);
				setSession(null);
				return null;
			}
		});
		setSessionLostHandler(() => {
			setToken(null);
			setSession(null);
			void nativeLogout().catch(() => undefined);
		});
		return () => {
			setTokenProvider(null);
			setSessionLostHandler(null);
		};
	}, []);

	useEffect(() => {
		if (!token) {
			setSession(null);
			return;
		}
		void getSession(token)
			.then(setSession)
			.catch(() => setSession(null));
	}, [token]);

	return (
		<AuthContext.Provider
			value={{
				ready,
				token,
				session,
				error,
				login: async () => {
					try {
						await configureAuth(authOptions);
						const next = await loginWithGithub();
						setError(null);
						if (next) {
							setToken(next);
						}
					} catch (caught) {
						setError(caught instanceof Error ? caught.message : "login failed");
					}
				},
				logout: async () => {
					await nativeLogout();
					const { clearOfflineKeys } = await import("./offline-keys.ts");
					await clearOfflineKeys().catch(() => undefined);
					setToken(null);
					setSession(null);
					setError(null);
				},
				completeAuthCallback: async (url: string) => {
					await configureAuth(authOptions);
					const next = await handleAuthCallback(url);
					setToken(next);
					setError(null);
				},
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	return useContext(AuthContext);
}
