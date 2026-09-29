"no action";

import { opencodeRepoName } from "gpio-companion";
import {
	errorStatus,
	jsonFail,
	type MobileContext,
} from "../../../lib/mobile-http.ts";
import {
	openOpencodeEvents,
	ownedOpencodeDevice,
} from "../../../lib/opencode-session.ts";
import { requireIdentity } from "../../../lib/session.ts";

export async function onRequestGet(ctx: MobileContext) {
	try {
		const identity = await requireIdentity(ctx);
		const url = new URL(ctx.request.url);
		const uuid = url.searchParams.get("uuid")?.trim() ?? "";
		const repo = opencodeRepoName(url.searchParams.get("repo") ?? "");
		const device = await ownedOpencodeDevice(ctx.env, identity, uuid);
		return openOpencodeEvents({
			env: ctx.env,
			deviceUrl: device.deviceUrl,
			repo,
			lastEventId: ctx.request.headers.get("last-event-id") ?? "",
		});
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
