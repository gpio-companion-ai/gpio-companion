import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { APP_PATH, appFrameUrl, isAppName } from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import { resolveAccessibleDeviceUrl } from "../../lib/debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "../../lib/device-api.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export type AppLiveGrant = {
	name: string;
	token: string;
	path: string;
	expiresAt: number;
	url: string;
};

export const POST = wrapAction(async function POST(
	uuid: string,
	appId: string,
): Promise<AppLiveGrant> {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const trimmed = uuid.trim();
	const name = appId.trim();
	if (!trimmed) {
		throw new Error("uuid is required");
	}
	if (!isAppName(name)) {
		throw new Error("app id is invalid");
	}
	const deviceUrl = await resolveAccessibleDeviceUrl(
		ctx.env.DYNAMIC_PAGE_KV,
		identity,
		trimmed,
	);
	const path = `${APP_PATH}/${name}/frame`;
	const response = await signedDeviceFetch(ctx.env, deviceUrl, "POST", path);
	const grant = await readDeviceJson<{
		name: string;
		token: string;
		path: string;
		expiresAt: number;
	}>(response);
	return { ...grant, url: appFrameUrl(deviceUrl, grant.name, grant.token) };
});
