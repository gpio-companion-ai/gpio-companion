import {
	parseUserProfile,
	profileFrom,
	type UserProfile,
} from "gpio-companion";
import type { PairingKv } from "./pairing-store.ts";

export async function getUserProfile(
	kv: PairingKv,
	userId: string,
): Promise<UserProfile | null> {
	if (!userId) {
		return null;
	}
	const raw = await kv.get(`profile:${userId}`);
	if (!raw) {
		return null;
	}
	try {
		return profileFrom(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function setUserProfile(
	kv: PairingKv,
	userId: string,
	input: unknown,
): Promise<UserProfile> {
	const next = parseUserProfile(input);
	await kv.put(`profile:${userId}`, JSON.stringify({ v: 1, ...next }));
	return next;
}
