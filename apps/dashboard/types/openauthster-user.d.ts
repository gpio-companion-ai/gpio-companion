// Type surface of "openauthster-shared/client/user" used by the dashboard.
// The package ships raw TS sources that do not typecheck standalone, so the
// typecheck resolves this declaration instead of the package sources.
export type OpenAuthsterUserClient = {
	token: string | null;
	isAuthenticated: boolean;
	getToken(): string | null;
	setTokenFromRequest(request: unknown): Promise<unknown>;
	setTokenToCookie(): void;
	login(options?: {
		autoNavigate?: boolean;
		provider?: string;
		[key: string]: unknown;
	}): Promise<unknown>;
	logout(): void | Promise<void>;
	triggerRefresh(): Promise<boolean>;
	getUserSession(scope?: string): Promise<unknown>;
	updateUserSession(scope?: string, data?: unknown): Promise<unknown>;
	getMetaData(): Promise<{
		data?: unknown;
		id?: unknown;
		identifier?: unknown;
		role?: unknown;
	} | null>;
};

export function createOpenAuthsterClient<
	_PublicSessionData = unknown,
	_PrivateSessionData = unknown,
	_Roles = string,
>(options: {
	issuerURI: string;
	clientID: string;
	redirectURI?: string;
	secret?: string;
	authFlowCallbacks?: {
		onLoginRequired?: (client: { logout(): void }) => void;
	};
	cache_provider?: {
		get(key: string): unknown;
		set(key: string, value: unknown, ttl: Date): unknown;
		delete(key: string): unknown;
	};
}): OpenAuthsterUserClient;
