import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { UI_PATH, uiWsConnectUrl } from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import { resolveAccessibleDeviceUrl } from "../../lib/debug-live.ts";
import { signDeviceHeaders } from "../../lib/device-api.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export const POST = wrapAction(async function POST(uuid: string) {
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
	const headers = await signDeviceHeaders(ctx.env, "GET", UI_PATH);
	return { wsUrl: uiWsConnectUrl(deviceUrl, headers) };
});
