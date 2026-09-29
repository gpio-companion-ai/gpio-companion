"no action";

import type { OpencodeClientCall } from "gpio-companion";
import { opencodeRepoName } from "gpio-companion";
import {
	asString,
	errorStatus,
	jsonFail,
	jsonOk,
	type MobileContext,
	readJsonBody,
	requireMobileIdentity,
} from "../../../lib/mobile-http.ts";
import {
	callOpencode,
	ownedOpencodeDevice,
} from "../../../lib/opencode-session.ts";

export async function onRequestPost(ctx: MobileContext) {
	try {
		const identity = await requireMobileIdentity(ctx);
		const body = await readJsonBody(ctx.request);
		const call: OpencodeClientCall = {
			uuid: asString(body.uuid),
			repo: opencodeRepoName(asString(body.repo)),
			op: asString(body.op) as OpencodeClientCall["op"],
			sessionID: asString(body.sessionID) || undefined,
			permissionID: asString(body.permissionID) || undefined,
			requestID: asString(body.requestID) || undefined,
			text: asString(body.text) || undefined,
			response:
				body.response === "once" ||
				body.response === "always" ||
				body.response === "reject"
					? body.response
					: undefined,
			answers: Array.isArray(body.answers)
				? (body.answers as string[][])
				: undefined,
			reject: body.reject === true,
		};
		const device = await ownedOpencodeDevice(ctx.env, identity, call.uuid);
		return jsonOk(await callOpencode(ctx.env, device.deviceUrl, call));
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
