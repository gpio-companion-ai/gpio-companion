import {
	createSignedEnvelope,
	DEFAULT_DEVICE_KEY_ID,
	type DeviceAuthHeaders,
	mintOfflineGrant,
	type OfflineGrantBundle,
	type SignedDeviceEnvelope,
	signDeviceRequest,
} from "gpio-companion";

export type DeviceSigningEnv = {
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export async function mintDeviceOfflineGrant(
	env: DeviceSigningEnv,
	uuid: string,
	userId: string,
): Promise<OfflineGrantBundle> {
	const privateKeyPem = env.GPIO_COMPANION_DEVICE_PRIVATE_KEY ?? "";
	if (!privateKeyPem.trim()) {
		throw new Error("GPIO_COMPANION_DEVICE_PRIVATE_KEY is not set");
	}
	return mintOfflineGrant({
		masterPrivateKeyPem: privateKeyPem,
		uuid,
		userId,
	});
}

export async function signDeviceEnvelope(
	env: DeviceSigningEnv,
	method: string,
	path: string,
	body?: unknown,
): Promise<SignedDeviceEnvelope> {
	const privateKeyPem = env.GPIO_COMPANION_DEVICE_PRIVATE_KEY ?? "";
	if (!privateKeyPem.trim()) {
		throw new Error("GPIO_COMPANION_DEVICE_PRIVATE_KEY is not set");
	}
	const bodyText = body === undefined ? "" : JSON.stringify(body);
	return createSignedEnvelope({
		privateKeyPem,
		keyId: env.GPIO_COMPANION_DEVICE_KEY_ID ?? DEFAULT_DEVICE_KEY_ID,
		method,
		path,
		body: bodyText,
	});
}

export async function signDeviceHeaders(
	env: DeviceSigningEnv,
	method: string,
	path: string,
	body?: unknown,
): Promise<DeviceAuthHeaders> {
	const privateKeyPem = env.GPIO_COMPANION_DEVICE_PRIVATE_KEY ?? "";
	if (!privateKeyPem.trim()) {
		throw new Error("GPIO_COMPANION_DEVICE_PRIVATE_KEY is not set");
	}
	const bodyText = body === undefined ? "" : JSON.stringify(body);
	return signDeviceRequest({
		privateKeyPem,
		keyId: env.GPIO_COMPANION_DEVICE_KEY_ID ?? DEFAULT_DEVICE_KEY_ID,
		method,
		path,
		body: bodyText,
	});
}

export async function signedDeviceFetch(
	env: DeviceSigningEnv,
	deviceUrl: string,
	method: string,
	path: string,
	body?: unknown,
	init?: {
		timeoutMs?: number;
		fetchImpl?: FetchLike;
		headers?: Record<string, string>;
	},
): Promise<Response> {
	const origin = deviceUrl.replace(/\/+$/, "");
	const bodyText = body === undefined ? "" : JSON.stringify(body);
	const headers = await signDeviceHeaders(env, method, path, body);
	const fetcher: FetchLike = init?.fetchImpl ?? fetch;
	return fetcher(`${origin}${path}`, {
		method,
		headers: {
			...(bodyText ? { "content-type": "application/json" } : {}),
			...(init?.headers ?? {}),
			...headers,
		},
		body: bodyText || undefined,
		signal:
			init?.timeoutMs !== undefined
				? AbortSignal.timeout(init.timeoutMs)
				: undefined,
	});
}

const DEVICE_GATEWAY = new Set([502, 521, 522, 523, 524]);

export const DEVICE_GATEWAY_ERROR =
	"board did not respond in time. If it is online, wait a few seconds and mint again.";

export async function readDeviceJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let detail = DEVICE_GATEWAY.has(response.status)
			? DEVICE_GATEWAY_ERROR
			: `device ${response.status}`;
		try {
			const errorBody = (await response.json()) as {
				error?: string;
				message?: string;
				data?: { message?: string };
			};
			detail =
				errorBody.error ||
				errorBody.data?.message ||
				errorBody.message ||
				detail;
		} catch {
			// keep status text
		}
		throw new Error(detail);
	}
	return (await response.json()) as T;
}
