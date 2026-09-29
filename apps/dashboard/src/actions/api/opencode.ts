import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import type { OpencodeClientCall } from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import {
	callOpencode,
	ownedOpencodeDevice,
} from "../../lib/opencode-session.ts";
import { requireIdentity } from "../../lib/session.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export const POST = wrapAction(async function POST(call: OpencodeClientCall) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	const device = await ownedOpencodeDevice(ctx.env, identity, call.uuid);
	return callOpencode(ctx.env, device.deviceUrl, call);
});
