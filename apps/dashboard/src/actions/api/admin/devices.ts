import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import { loginFromEmail } from "gpio-companion";
import { wrapAction } from "../../../lib/action.ts";
import { readDeviceJson, signedDeviceFetch } from "../../../lib/device-api.ts";
import {
	clearPendingForUuid,
	findDeviceByUuid,
	listAllDevices,
	type PublicPairing,
	publicPairing,
	transferDeviceRecord,
	updateDeviceFieldsByUuid,
} from "../../../lib/pairing-store.ts";
import { requireAdmin, requireIdentity } from "../../../lib/session.ts";
import { unpairDevice } from "../pair.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export type AdminDeviceItem = {
	device: PublicPairing;
	status: Record<string, unknown> | null;
};

export const GET = wrapAction(async function GET() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	requireAdmin(await requireIdentity(ctx));
	const paired = await listAllDevices(ctx.env.DYNAMIC_PAGE_KV);
	const devices: AdminDeviceItem[] = await Promise.all(
		paired.map(async (device) => {
			let status: Record<string, unknown> | null = null;
			if (device.deviceUrl) {
				try {
					status = await readDeviceJson<Record<string, unknown>>(
						await signedDeviceFetch(
							ctx.env,
							device.deviceUrl,
							"GET",
							"/v1/status",
						),
					);
				} catch {
					status = null;
				}
			}
			return { device: publicPairing(device), status };
		}),
	);
	return { devices };
});

export const PATCH = wrapAction(async function PATCH(input: {
	uuid: string;
	label?: string;
	bleMac?: string;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	requireAdmin(await requireIdentity(ctx));
	const device = await updateDeviceFieldsByUuid(
		ctx.env.DYNAMIC_PAGE_KV,
		input.uuid,
		{
			label: input.label,
			bleMac: input.bleMac,
		},
	);
	return { ok: true as const, device: publicPairing(device) };
});

export const DELETE = wrapAction(async function DELETE(uuid: string) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	requireAdmin(await requireIdentity(ctx));
	const device = await findDeviceByUuid(ctx.env.DYNAMIC_PAGE_KV, uuid);
	await clearPendingForUuid(
		ctx.env.DYNAMIC_PAGE_KV,
		device.uuid,
		device.userId,
	);
	return unpairDevice(ctx.env, device.userId, device.uuid);
});

export const POST = wrapAction(async function POST(input: {
	uuid: string;
	toUserId?: string;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = requireAdmin(await requireIdentity(ctx));
	const device = await findDeviceByUuid(ctx.env.DYNAMIC_PAGE_KV, input.uuid);
	const toUserId = input.toUserId?.trim() || identity.id;
	if (!toUserId) {
		throw new Error("toUserId is required");
	}
	if (device.userId === toUserId) {
		return { ok: true as const, device: publicPairing(device) };
	}
	const login =
		toUserId === identity.id
			? loginFromEmail(identity.email ?? "") || identity.id
			: toUserId;
	const email = toUserId === identity.id ? (identity.email ?? "") : "";
	if (device.deviceUrl) {
		await readDeviceJson(
			await signedDeviceFetch(
				ctx.env,
				device.deviceUrl,
				"POST",
				"/v1/pairing/transfer",
				{
					uuid: device.uuid,
					key: device.key,
					userId: toUserId,
					email,
					login,
				},
			),
		).catch(() => undefined);
	}
	const next = await transferDeviceRecord(ctx.env.DYNAMIC_PAGE_KV, device, {
		userId: toUserId,
		email,
		login,
	});
	return { ok: true as const, device: publicPairing(next) };
});
