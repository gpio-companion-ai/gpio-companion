import {
	OPENCODE_PROXY_PATH,
	OPENCODE_REPO_HEADER,
	type OpencodeClientCall,
	opencodeClientRequest,
	opencodeProxyAllows,
	opencodeRepoName,
} from "gpio-companion";
import type { SignedInIdentity } from "./auth/identity.ts";
import {
	type DeviceSigningEnv,
	readDeviceJson,
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

export async function openOpencodeEvents(options: {
	env: DeviceSigningEnv;
	deviceUrl: string;
	repo: string;
	lastEventId?: string;
}): Promise<Response> {
	const path = `${OPENCODE_PROXY_PATH}/event`;
	const headers: Record<string, string> = {
		accept: "text/event-stream",
		[OPENCODE_REPO_HEADER]: opencodeRepoName(options.repo),
	};
	if (options.lastEventId?.trim()) {
		headers["last-event-id"] = options.lastEventId.trim();
	}
	const response = await signedDeviceFetch(
		options.env,
		options.deviceUrl,
		"GET",
		path,
		undefined,
		{ headers },
	);
	if (!response.ok) {
		await readDeviceJson(response);
	}
	if (!response.body) {
		throw new Error("opencode event stream unavailable");
	}
	return new Response(response.body, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			"x-accel-buffering": "no",
		},
	});
}
