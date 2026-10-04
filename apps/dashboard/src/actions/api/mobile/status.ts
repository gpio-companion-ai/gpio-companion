"no action";

import { type MobileContext, runMobile } from "../../../lib/mobile-http.ts";
import { publicPairing } from "../../../lib/pairing-store.ts";
import { listDevicesWithStatus } from "../device.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const listed = await listDevicesWithStatus(ctx.env, identity.id);
		return {
			paired: listed.paired,
			devices: listed.devices.map((item) => ({
				device: publicPairing(item.device),
				status: item.status,
			})),
		};
	});
}
