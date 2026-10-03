"no action";

import {
	APP_LIST_PATH,
	APP_PATH,
	APP_START_PATH,
	APP_STOP_PATH,
	type AppStatus,
	type BoardAppList,
	parseBoardAppList,
} from "gpio-companion";
import { resolveAccessibleDeviceUrl } from "../../../lib/debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "../../../lib/device-api.ts";
import {
	asString,
	type MobileContext,
	readJsonBody,
	runMobile,
} from "../../../lib/mobile-http.ts";
import { requireOwnedDevice } from "../../../lib/pairing-store.ts";

export async function onRequestGet(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const url = new URL(ctx.request.url);
		const uuid = asString(url.searchParams.get("uuid")).trim();
		if (!uuid) {
			throw new Error("uuid is required");
		}
		const deviceUrl = await resolveAccessibleDeviceUrl(
			ctx.env.DYNAMIC_PAGE_KV,
			identity,
			uuid,
		);
		if (url.searchParams.get("apps")) {
			return parseBoardAppList(
				await readDeviceJson<BoardAppList>(
					await signedDeviceFetch(ctx.env, deviceUrl, "GET", APP_LIST_PATH),
				),
			);
		}
		return readDeviceJson<AppStatus>(
			await signedDeviceFetch(ctx.env, deviceUrl, "GET", APP_PATH),
		);
	});
}

export async function onRequestPost(ctx: MobileContext) {
	return runMobile(ctx, async (identity) => {
		const body = await readJsonBody(ctx.request);
		const uuid = asString(body.uuid).trim();
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
		if (body.stop === true) {
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
		const repo = asString(body.repo).trim();
		const dir = asString(body.dir).trim();
		if (!repo || !dir) {
			throw new Error("repo and dir are required");
		}
		return readDeviceJson<{ started: boolean; name: string; port: number }>(
			await signedDeviceFetch(
				ctx.env,
				device.deviceUrl,
				"POST",
				APP_START_PATH,
				{
					repo,
					dir,
				},
			),
		);
	});
}
