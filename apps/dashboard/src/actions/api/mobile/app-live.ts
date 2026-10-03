"no action";

import { APP_PATH, appFrameUrl, isAppName } from "gpio-companion";
import { resolveAccessibleDeviceUrl } from "../../../lib/debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "../../../lib/device-api.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const uuid = asString(body.uuid).trim();
		const name = asString(body.appId).trim();
		if (!uuid) {
			throw new Error("uuid is required");
		}
		if (!isAppName(name)) {
			throw new Error("app id is invalid");
		}
		const deviceUrl = await resolveAccessibleDeviceUrl(
			ctx.env.DYNAMIC_PAGE_KV,
			identity,
			uuid,
		);
		const path = `${APP_PATH}/${name}/frame`;
		const response = await signedDeviceFetch(ctx.env, deviceUrl, "POST", path);
		const grant = await readDeviceJson<{
			name: string;
			token: string;
			path: string;
			expiresAt: number;
		}>(response);
		return {
			...grant,
			url: appFrameUrl(deviceUrl, grant.name, grant.token),
		};
	});
}
