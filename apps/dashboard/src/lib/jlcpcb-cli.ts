import { getLiveBoard } from "./debug-live.ts";
import { readDeviceJson, signedDeviceFetch } from "./device-api.ts";
import { requireOwnedDevice } from "./pairing-store.ts";

const TTL_SECONDS = 300;

export type CliLoginEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

type PendingCli = {
	uuid: string;
	userId: string;
};

export function cliLoginKey(state: string): string {
	return `jlcpcb-cli:${state}`;
}

export async function beginCliLogin(input: {
	env: CliLoginEnv;
	userId: string;
	uuid: string;
}): Promise<{ authorizeUrl: string }> {
	const device = await requireOwnedDevice(
		input.env.DYNAMIC_PAGE_KV,
		input.userId,
		input.uuid,
	);
	const live = await getLiveBoard(input.env.DYNAMIC_PAGE_KV, input.uuid);
	const deviceUrl = device.deviceUrl || live?.deviceUrl || "";
	if (!deviceUrl) {
		throw new Error("device URL is missing");
	}
	const started = await readDeviceJson<{
		authorizeUrl: string;
		state: string;
	}>(await signedDeviceFetch(input.env, deviceUrl, "POST", "/v1/jlcpcb/login"));
	if (!started.authorizeUrl || !started.state) {
		throw new Error("cli login failed");
	}
	const pending: PendingCli = {
		uuid: input.uuid,
		userId: input.userId,
	};
	await input.env.DYNAMIC_PAGE_KV.put(
		cliLoginKey(started.state),
		JSON.stringify(pending),
		{ expirationTtl: TTL_SECONDS },
	);
	return { authorizeUrl: started.authorizeUrl };
}

export async function finishCliLogin(input: {
	env: CliLoginEnv;
	userId: string;
	state: string;
	code: string;
}): Promise<{ ok: true }> {
	const raw = await input.env.DYNAMIC_PAGE_KV.get(cliLoginKey(input.state));
	if (!raw) {
		throw new Error("cli login expired");
	}
	const pending = JSON.parse(raw) as PendingCli;
	if (pending.userId !== input.userId) {
		throw new Error("device is not paired with this account");
	}
	await input.env.DYNAMIC_PAGE_KV.delete(cliLoginKey(input.state));
	const device = await requireOwnedDevice(
		input.env.DYNAMIC_PAGE_KV,
		input.userId,
		pending.uuid,
	);
	const live = await getLiveBoard(input.env.DYNAMIC_PAGE_KV, pending.uuid);
	const deviceUrl = device.deviceUrl || live?.deviceUrl || "";
	if (!deviceUrl) {
		throw new Error("device URL is missing");
	}
	await readDeviceJson(
		await signedDeviceFetch(
			input.env,
			deviceUrl,
			"POST",
			"/v1/jlcpcb/login/code",
			{ code: input.code, state: input.state },
		),
	);
	return { ok: true };
}
