import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { ARDUINO_PROXY_PATH, type ArduinoProxyStatus } from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import { resolveAccessibleDeviceUrl } from "../../lib/debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "../../lib/device-api.ts";
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
	return readDeviceJson<ArduinoProxyStatus>(
		await signedDeviceFetch(ctx.env, deviceUrl, "GET", ARDUINO_PROXY_PATH),
	);
});
