import {
	OPENCODE_PROXY_PATH,
	OPENCODE_REPO_HEADER,
	type OpencodeClientCall,
	opencodeClientRequest,
	opencodeEventPath,
	opencodeEventWsConnectUrl,
	opencodeProxyAllows,
	opencodeRepoName,
} from "gpio-companion";
import type { SignedInIdentity } from "./auth/identity.ts";
import {
	type DeviceSigningEnv,
	readDeviceJson,
	signDeviceHeaders,
	signedDeviceFetch,
} from "./device-api.ts";
import { requireAccessibleDevice } from "./pairing-store.ts";

type PagesEnv = DeviceSigningEnv & {
	DYNAMIC_PAGE_KV: KVNamespace;
};

export async function ownedOpencodeDevice(
	env: PagesEnv,
	identity: SignedInIdentity,
	uuid: string,
) {
	if (!identity.id) {
		throw new Error("sign in first");
	}
	const device = await requireAccessibleDevice(
		env.DYNAMIC_PAGE_KV,
		identity,
		uuid,
	);
	if (!device.deviceUrl) {
		throw new Error("device URL is missing");
	}
	return device;
}

export async function callOpencode(
	env: DeviceSigningEnv,
	deviceUrl: string,
	call: OpencodeClientCall,
): Promise<unknown> {
	const request = opencodeClientRequest(call);
	const path = `${OPENCODE_PROXY_PATH}${request.path}`;
	if (!opencodeProxyAllows(path)) {
		throw new Error("opencode route is not available");
	}
	const response = await signedDeviceFetch(
		env,
		deviceUrl,
		request.method,
		path,
		request.body,
		{
			timeoutMs: 20_000,
			headers: {
				accept: "application/json",
				[OPENCODE_REPO_HEADER]: opencodeRepoName(call.repo),
			},
		},
	);
	if (response.status === 204) {
		return { accepted: true };
	}
	return readDeviceJson(response);
}

export async function signOpencodeEventLive(
	env: PagesEnv,
	identity: SignedInIdentity,
	input: { uuid: string; repo: string },
): Promise<{ wsUrl: string }> {
	const device = await ownedOpencodeDevice(env, identity, input.uuid);
	const path = opencodeEventPath(input.repo);
	const headers = await signDeviceHeaders(env, "GET", path);
	return {
		wsUrl: opencodeEventWsConnectUrl(device.deviceUrl, input.repo, headers),
	};
}
