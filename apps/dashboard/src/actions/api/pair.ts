import { getContext } from "frame-master-plugin-cloudflare-pages-functions-action/context";
import {
	loginFromEmail,
	publicDeviceUrl,
	tunnelHostnames,
} from "gpio-companion";
import { wrapAction } from "../../lib/action.ts";
import {
	readDeviceJson,
	signDeviceEnvelope,
	signedDeviceFetch,
} from "../../lib/device-api.ts";
import {
	loadDevices,
	parseStoredBleMac,
	removeDevice,
	updateDeviceFields,
	upsertDevice,
} from "../../lib/pairing-store.ts";
import { requireIdentity } from "../../lib/session.ts";

export {
	parseStoredPairing,
	type StoredPairing,
} from "../../lib/pairing-store.ts";

export type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

const UNPAIR_DEVICE_TIMEOUT_MS = 4_000;

export type PendingPairing = {
	uuid: string;
	key: string;
	requesterId: string;
	requesterEmail: string;
	login: string;
	createdAt: string;
};

export type ClaimInput = {
	deviceUrl?: string;
	uuid: string;
	key: string;
	bleMac?: string;
};

export function parsePendingPairing(raw: string): PendingPairing {
	const parsed = JSON.parse(raw) as PendingPairing & { giteaLogin?: string };
	return { ...parsed, login: parsed.login || parsed.giteaLogin || "" };
}

export async function listPairing(
	env: PagesEnv,
	userId: string,
): Promise<{
	paired: boolean;
	devices: Awaited<ReturnType<typeof loadDevices>>;
}> {
	const devices = await loadDevices(env.DYNAMIC_PAGE_KV, userId);
	return { paired: devices.length > 0, devices };
}

export async function signPairingCredentials(env: PagesEnv) {
	return signDeviceEnvelope(env, "GET", "/v1/pairing/credentials");
}

export async function claimDevice(
	env: PagesEnv,
	identity: { id: string; email: string | null },
	input: ClaimInput,
) {
	if (!identity.id || !input.uuid || !input.key) {
		throw new Error("uuid and key are required");
	}
	const hosts = tunnelHostnames(input.uuid.trim());
	const typedOrigin = (input.deviceUrl ?? "").replace(/\/+$/, "");
	const origin = typedOrigin || publicDeviceUrl(hosts.apiHostname);
	const login = loginFromEmail(identity.email ?? "") || identity.id;
	const ownerId = await env.DYNAMIC_PAGE_KV.get(`pair:${input.uuid.trim()}`);
	if (ownerId && ownerId !== identity.id) {
		const pending: PendingPairing = {
			uuid: input.uuid.trim(),
			key: input.key,
			requesterId: identity.id,
			requesterEmail: identity.email ?? "",
			login,
			createdAt: new Date().toISOString(),
		};
		await env.DYNAMIC_PAGE_KV.put(
			`pending:${pending.uuid}`,
			JSON.stringify(pending),
		);
		const inboxKey = `inbox:${ownerId}`;
		const inboxRaw = await env.DYNAMIC_PAGE_KV.get(inboxKey);
		const inbox = inboxRaw ? (JSON.parse(inboxRaw) as string[]) : [];
		if (!inbox.includes(pending.uuid)) {
			inbox.push(pending.uuid);
			await env.DYNAMIC_PAGE_KV.put(inboxKey, JSON.stringify(inbox));
		}
		return {
			pending: true as const,
			alreadyPaired: "other" as const,
			uuid: pending.uuid,
		};
	}
	if (ownerId === identity.id) {
		const trimmed = input.uuid.trim();
		const existing = (await loadDevices(env.DYNAMIC_PAGE_KV, identity.id)).find(
			(device) => device.uuid === trimmed,
		);
		await upsertDevice(env.DYNAMIC_PAGE_KV, {
			userId: identity.id,
			uuid: trimmed,
			key: input.key,
			deviceUrl: origin || existing?.deviceUrl || "",
			login,
			email: identity.email ?? existing?.email ?? "",
			claimedAt: existing?.claimedAt ?? new Date().toISOString(),
			label: existing?.label ?? "",
			bleMac: parseStoredBleMac(input.bleMac) || existing?.bleMac || "",
		});
		return {
			alreadyYours: true as const,
			pending: false as const,
			uuid: trimmed,
		};
	}
	let needsBle = false;
	if (origin) {
		try {
			await readDeviceJson(
				await signedDeviceFetch(env, origin, "POST", "/v1/pairing/claim", {
					uuid: input.uuid,
					key: input.key,
					userId: identity.id,
					email: identity.email ?? "",
					login,
				}),
			);
		} catch (error) {
			if (error instanceof Error && error.message === "already paired") {
				return {
					alreadyPaired: "other" as const,
					pending: false as const,
					uuid: input.uuid.trim(),
				};
			}
			if (typedOrigin) {
				throw error;
			}
			needsBle = true;
		}
	} else {
		needsBle = true;
	}
	const existing = (await loadDevices(env.DYNAMIC_PAGE_KV, identity.id)).find(
		(device) => device.uuid === input.uuid.trim(),
	);
	const pairing = {
		userId: identity.id,
		uuid: input.uuid.trim(),
		key: input.key,
		deviceUrl: origin,
		login,
		email: identity.email ?? "",
		claimedAt: new Date().toISOString(),
		label: existing?.label ?? "",
		bleMac: parseStoredBleMac(input.bleMac) || existing?.bleMac || "",
	};
	await upsertDevice(env.DYNAMIC_PAGE_KV, pairing);
	if (needsBle) {
		const envelope = await signDeviceEnvelope(
			env,
			"POST",
			"/v1/pairing/claim",
			{
				uuid: pairing.uuid,
				key: input.key,
				userId: identity.id,
				email: identity.email ?? "",
				login,
			},
		);
		return {
			ok: true as const,
			pending: false as const,
			needsBle: true as const,
			login: pairing.login,
			deviceUrl: origin,
			uuid: pairing.uuid,
			t3Hostname: hosts.t3Hostname,
			envelope,
		};
	}
	return {
		ok: true as const,
		pending: false as const,
		needsBle: false as const,
		login: pairing.login,
		deviceUrl: origin,
		uuid: pairing.uuid,
		t3Hostname: hosts.t3Hostname,
	};
}

export async function unpairDevice(
	env: PagesEnv,
	userId: string,
	uuid: string,
) {
	const trimmed = uuid?.trim() ?? "";
	if (!trimmed) {
		throw new Error("uuid is required");
	}
	const devices = await loadDevices(env.DYNAMIC_PAGE_KV, userId);
	const device = devices.find((item) => item.uuid === trimmed);
	if (!device) {
		return { ok: true as const };
	}
	if (device.deviceUrl) {
		try {
			await readDeviceJson(
				await signedDeviceFetch(
					env,
					device.deviceUrl,
					"POST",
					"/v1/pairing/unpair",
					{ uuid: device.uuid, key: device.key },
					{ timeoutMs: UNPAIR_DEVICE_TIMEOUT_MS },
				),
			);
		} catch {
			// Offline or rejected boards still lose the dashboard claim.
		}
	}
	await removeDevice(env.DYNAMIC_PAGE_KV, userId, device.uuid);
	return { ok: true as const };
}

export const GET = wrapAction(async function GET() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return listPairing(ctx.env, identity.id);
});

export const PUT = wrapAction(async function PUT() {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	await requireIdentity(ctx);
	return signPairingCredentials(ctx.env);
});

export const POST = wrapAction(async function POST(input: ClaimInput) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return claimDevice(
		ctx.env,
		{ id: identity.id, email: identity.email },
		input,
	);
});

export const PATCH = wrapAction(async function PATCH(input: {
	uuid: string;
	label?: string;
	bleMac?: string;
}) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const device = await updateDeviceFields(
		ctx.env.DYNAMIC_PAGE_KV,
		identity.id,
		input.uuid,
		{
			label: input.label,
			bleMac: input.bleMac,
		},
	);
	return { ok: true as const, device };
});

export const DELETE = wrapAction(async function DELETE(uuid: string) {
	const ctx = getContext<PagesEnv, never, never>(arguments);
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return unpairDevice(ctx.env, identity.id, uuid);
});
