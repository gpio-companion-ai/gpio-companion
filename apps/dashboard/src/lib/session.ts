import { createClient } from "../auth.ts";
import {
	errorMessage,
	formatIdentityFailure,
	formatJwtInspect,
	inspectJwt,
	probeUserIdentity,
	type SignedInIdentity,
	type UserIdentity,
} from "./auth/identity.ts";
import { isAdmin } from "./auth/role.ts";

type SessionContext = {
	request: { headers: { get(name: string): string | null } };
	env: unknown;
};

type TokenClient = {
	token: string | null;
	isAuthenticated: boolean;
};

function bearerToken(ctx: SessionContext): string | null {
	const header = ctx.request.headers.get("authorization") ?? "";
	if (!header.toLowerCase().startsWith("bearer ")) {
		return null;
	}
	const token = header.slice("Bearer ".length).trim();
	return token || null;
}

function acceptBearer(auth: ReturnType<typeof createClient>, token: string) {
	const client = auth as ReturnType<typeof createClient> & TokenClient;
	client.token = token;
	client.isAuthenticated = true;
}

export async function requireSession(ctx: SessionContext): Promise<{
	auth: ReturnType<typeof createClient>;
	identity: SignedInIdentity;
}> {
	const auth = createClient({
		ctx: ctx as never,
	});
	const token = bearerToken(ctx);
	const jwt = token ? inspectJwt(token) : null;
	const jwtText = jwt ? formatJwtInspect(jwt) : null;
	let verifyError: string | null = null;
	try {
		await auth.setTokenFromRequest(ctx.request as Request);
	} catch (caught) {
		verifyError = errorMessage(caught);
		if (token) {
			acceptBearer(auth, token);
		} else {
			const message = formatIdentityFailure({
				hasToken: false,
				tokenBytes: 0,
				sessionError: verifyError,
				metaError: null,
				id: null,
				jwt: jwtText,
			});
			console.error("gpio-companion identity", {
				stage: "token",
				error: message,
			});
			throw new Error(message);
		}
	}
	if (!auth.getToken()) {
		throw new Error("sign in first");
	}
	const probe = await probeUserIdentity(auth);
	if (!probe.identity.id) {
		const message = formatIdentityFailure({
			hasToken: true,
			tokenBytes: token?.length ?? probe.tokenBytes,
			sessionError: probe.sessionError ?? verifyError,
			metaError: probe.metaError,
			id: probe.identity.id,
			jwt: jwtText,
		});
		console.error("gpio-companion identity", {
			stage: verifyError ? "token+profile" : "profile",
			tokenBytes: token?.length ?? probe.tokenBytes,
			jwt,
			expectedIss: process.env.PUBLIC_AUTH_ISSUER,
			expectedAud: process.env.PUBLIC_AUTH_CLIENT_ID,
			sessionError: probe.sessionError,
			metaError: probe.metaError,
			verifyError,
			error: message,
		});
		throw new Error(message);
	}
	return { auth, identity: probe.identity as SignedInIdentity };
}

export async function requireAuthedClient(
	ctx: SessionContext,
): Promise<ReturnType<typeof createClient>> {
	return (await requireSession(ctx)).auth;
}

export async function requireIdentity(
	ctx: SessionContext,
): Promise<SignedInIdentity> {
	return (await requireSession(ctx)).identity;
}

export function requireAdmin(identity: UserIdentity): SignedInIdentity {
	if (!identity.id) {
		throw new Error("sign in first");
	}
	if (!isAdmin(identity.role)) {
		throw new Error("admin only");
	}
	return identity as SignedInIdentity;
}
