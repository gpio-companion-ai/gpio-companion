import type { ShippingAddress } from "gpio-companion";
import { createOpenAuthsterClient } from "openauthster-shared/client/user";

import type { UserRole } from "./lib/auth/role.ts";

export type { UserRole };

export type PublicSession = {
	id?: string;
	email?: string;
	name?: string;
	role?: UserRole;
	address?: ShippingAddress;
};

export type PrivateSession = Record<string, never>;

const clientCache = new Map<string, unknown>();

function truncateKey(key: string) {
	if (key.length > 100) {
		return key.slice(0, 100);
	}
	return key;
}

export function createClient(
	props: {
		ctx?: EventContext<Env, never, Record<string, never>>;
		onLoginRequired?: (client: { logout(): void }) => void;
	} = {},
) {
	return createOpenAuthsterClient<PublicSession, PrivateSession, UserRole>({
		issuerURI: process.env.PUBLIC_AUTH_ISSUER as string,
		clientID: process.env.PUBLIC_AUTH_CLIENT_ID as string,
		redirectURI:
			(process.env.PUBLIC_AUTH_REDIRECT_URI as string | undefined) ??
			"http://localhost:3000/callback",
		secret: process.env.AUTH_SECRET as string,
		authFlowCallbacks: props.onLoginRequired
			? { onLoginRequired: props.onLoginRequired }
			: undefined,
		cache_provider: {
			async get(key) {
				if (!props.ctx) {
					return clientCache.get(key) ?? null;
				}
				const res = await props.ctx.env.DYNAMIC_PAGE_KV.get(truncateKey(key));
				if (!res) {
					return null;
				}
				return JSON.parse(res);
			},
			async set(key, value, ttl) {
				if (!props.ctx) {
					clientCache.set(key, value);
					return;
				}
				await props.ctx.env.DYNAMIC_PAGE_KV.put(
					truncateKey(key),
					JSON.stringify(value),
					{
						expirationTtl: Math.max(
							60,
							Math.floor((ttl.getTime() - Date.now()) / 1000),
						),
					},
				);
			},
			async delete(key) {
				if (!props.ctx) {
					clientCache.delete(key);
					return;
				}
				await props.ctx.env.DYNAMIC_PAGE_KV.delete(truncateKey(key));
			},
		},
	});
}

export type ClientType = ReturnType<typeof createClient>;
