"no action";

import { fetchLatestCompanionRelease } from "../../../lib/companion-release.ts";
import { type MobileContext, runMobile } from "../../../lib/mobile-http.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async () => fetchLatestCompanionRelease(ctx.env));
}
