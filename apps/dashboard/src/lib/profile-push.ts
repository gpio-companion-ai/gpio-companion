import type { UserProfile } from "gpio-companion";
import { CONFIG_PROFILE_PATH } from "gpio-companion";
import { getLiveBoard } from "./debug-live.ts";
import {
	type DeviceSigningEnv,
	type FetchLike,
	signedDeviceFetch,
} from "./device-api.ts";
import { loadDevices, type PairingKv } from "./pairing-store.ts";

export const PROFILE_PUSH_TIMEOUT_MS = 4_000;

export type ProfilePushEnv = DeviceSigningEnv & {
	DYNAMIC_PAGE_KV: PairingKv;
};

export async function pushProfileToLiveBoards(
	env: ProfilePushEnv,
	userId: string,
	profile: UserProfile,
	options?: {
		now?: number;
		timeoutMs?: number;
		fetchImpl?: FetchLike;
	},
): Promise<void> {
	const devices = await loadDevices(env.DYNAMIC_PAGE_KV, userId);
	await Promise.all(
		devices.map(async (device) => {
			const live = await getLiveBoard(
				env.DYNAMIC_PAGE_KV,
				device.uuid,
				options?.now,
			);
			if (!live) {
				return;
			}
			const deviceUrl = device.deviceUrl || live.deviceUrl;
			if (!deviceUrl) {
				return;
			}
			try {
				await signedDeviceFetch(
					env,
					deviceUrl,
					"PUT",
					CONFIG_PROFILE_PATH,
					{ level: profile.level, context: profile.context },
					{
						timeoutMs: options?.timeoutMs ?? PROFILE_PUSH_TIMEOUT_MS,
						fetchImpl: options?.fetchImpl,
					},
				);
			} catch {
				undefined;
			}
		}),
	);
}
