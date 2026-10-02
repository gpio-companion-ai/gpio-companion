import {
	type DeviceConfig,
	profileFrom,
	type UserProfile,
} from "gpio-companion";
import {
	dashboardOrigin,
	type FetchLike,
	fetchAiCredentials,
} from "./ai-credentials.ts";
import type { ConfigStore } from "./store.ts";

export const PROFILE_DEVICE_PATH = "/api/profile/device";

export function profileSyncMessage(error: unknown): string {
	return error instanceof Error ? error.message : "profile sync failed";
}

export async function fetchDashboardProfile(options: {
	uuid: string;
	key: string;
	origin?: string;
	fetchImpl?: FetchLike;
}): Promise<UserProfile | null> {
	const creds = await fetchAiCredentials({
		uuid: options.uuid,
		key: options.key,
		origin: options.origin,
		fetchImpl: options.fetchImpl,
	});
	const fetcher = options.fetchImpl ?? fetch;
	const response = await fetcher(
		`${dashboardOrigin(options.origin)}${PROFILE_DEVICE_PATH}`,
		{
			headers: { authorization: `Bearer ${creds.token}` },
		},
	);
	if (!response.ok) {
		return null;
	}
	const body = (await response.json()) as { profile?: unknown };
	return profileFrom(body.profile);
}

export async function syncProfile(options: {
	store: ConfigStore;
	uuid: string;
	key: string;
	origin?: string;
	fetchImpl?: FetchLike;
}): Promise<UserProfile | null> {
	const profile = await fetchDashboardProfile({
		uuid: options.uuid,
		key: options.key,
		origin: options.origin,
		fetchImpl: options.fetchImpl,
	});
	if (!profile) {
		return null;
	}
	const current: DeviceConfig = await options.store.read();
	if (
		current.profile &&
		current.profile.level === profile.level &&
		current.profile.context === profile.context
	) {
		return profile;
	}
	await options.store.write({ ...current, profile });
	return profile;
}
