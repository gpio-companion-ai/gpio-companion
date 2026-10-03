import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import {
	APP_PATH,
	APP_START_PATH,
	APP_STOP_PATH,
	type AppStatus,
} from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import { resolveAccessibleDeviceUrl } from "../../lib/debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "../../lib/device-api.ts";
import { requireOwnedDevice } from "../../lib/pairing-store.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export const GET = wrapAction(async function GET(uuid: string) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const trimmed = uuid.trim();
	if (!trimmed) {
		throw new Error("uuid is required");
	}
	const deviceUrl = await resolveAccessibleDeviceUrl(
		ctx.env.DYNAMIC_PAGE_KV,
		identity,
		trimmed,
	);
	return readDeviceJson<AppStatus>(
		await signedDeviceFetch(ctx.env, deviceUrl, "GET", APP_PATH),
	);
});

export const POST = wrapAction(async function POST(input: {
	uuid: string;
	repo?: string;
	dir?: string;
	stop?: boolean;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const uuid = input.uuid?.trim() ?? "";
	if (!uuid) {
		throw new Error("uuid is required");
	}
	const device = await requireOwnedDevice(
		ctx.env.DYNAMIC_PAGE_KV,
		identity.id,
		uuid,
	);
	if (!device.deviceUrl) {
		throw new Error("device URL is missing");
	}
	if (input.stop === true) {
		return readDeviceJson<{ stopped: boolean }>(
			await signedDeviceFetch(
				ctx.env,
				device.deviceUrl,
				"POST",
				APP_STOP_PATH,
				{},
			),
		);
	}
	const repo = input.repo?.trim() ?? "";
	const dir = input.dir?.trim() ?? "";
	if (!repo || !dir) {
		throw new Error("repo and dir are required");
	}
	return readDeviceJson<{ started: boolean; name: string; port: number }>(
		await signedDeviceFetch(ctx.env, device.deviceUrl, "POST", APP_START_PATH, {
			repo,
			dir,
		}),
	);
});
