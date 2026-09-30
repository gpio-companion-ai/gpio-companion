import {
	type BoardFileList,
	type BoardFileRead,
	type BoardFileWrite,
	boardFileWatchPath,
	FILES_LIST_PATH,
	FILES_READ_PATH,
	FILES_RENAME_PATH,
	FILES_WRITE_PATH,
	filesWsConnectUrl,
	parseBoardFileListPut,
	parseBoardFileReadPut,
	parseBoardFileRenamePut,
	parseBoardFileWritePut,
	parseGithubRepoName,
} from "gpio-companion";
import {
	readDeviceJson,
	signDeviceHeaders,
	signedDeviceFetch,
} from "./device-api.ts";
import { requireOwnedDevice } from "./pairing-store.ts";

type SigningEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
};

export async function boardFileDevice(
	env: SigningEnv,
	userId: string,
	uuid: string,
) {
	const trimmed = uuid.trim();
	if (!trimmed) {
		throw new Error("uuid is required");
	}
	const device = await requireOwnedDevice(env.DYNAMIC_PAGE_KV, userId, trimmed);
	if (!device.deviceUrl) {
		throw new Error("device URL is missing");
	}
	return device;
}

export async function listSignedBoardFiles(
	env: SigningEnv,
	userId: string,
	input: { uuid: string; name: string },
): Promise<BoardFileList> {
	const device = await boardFileDevice(env, userId, input.uuid);
	const put = parseBoardFileListPut(input);
	return readDeviceJson<BoardFileList>(
		await signedDeviceFetch(
			env,
			device.deviceUrl,
			"POST",
			FILES_LIST_PATH,
			put,
			{
				timeoutMs: 15_000,
			},
		),
	);
}

export async function readSignedBoardFile(
	env: SigningEnv,
	userId: string,
	input: { uuid: string; name: string; path: string },
): Promise<BoardFileRead> {
	const device = await boardFileDevice(env, userId, input.uuid);
	const put = parseBoardFileReadPut(input);
	return readDeviceJson<BoardFileRead>(
		await signedDeviceFetch(
			env,
			device.deviceUrl,
			"POST",
			FILES_READ_PATH,
			put,
			{
				timeoutMs: 15_000,
			},
		),
	);
}

export async function writeSignedBoardFile(
	env: SigningEnv,
	userId: string,
	input: {
		uuid: string;
		name: string;
		path: string;
		text?: string;
		base64?: string;
	},
): Promise<BoardFileWrite> {
	const device = await boardFileDevice(env, userId, input.uuid);
	const put = parseBoardFileWritePut(input);
	return readDeviceJson<BoardFileWrite>(
		await signedDeviceFetch(
			env,
			device.deviceUrl,
			"PUT",
			FILES_WRITE_PATH,
			put,
			{
				timeoutMs: 15_000,
			},
		),
	);
}

export async function renameSignedBoardFile(
	env: SigningEnv,
	userId: string,
	input: { uuid: string; name: string; from: string; to: string },
): Promise<BoardFileWrite> {
	const device = await boardFileDevice(env, userId, input.uuid);
	const put = parseBoardFileRenamePut(input);
	return readDeviceJson<BoardFileWrite>(
		await signedDeviceFetch(
			env,
			device.deviceUrl,
			"POST",
			FILES_RENAME_PATH,
			put,
			{ timeoutMs: 15_000 },
		),
	);
}

export async function signBoardFileLive(
	env: SigningEnv,
	userId: string,
	input: { uuid: string; name: string },
): Promise<{ wsUrl: string }> {
	const device = await boardFileDevice(env, userId, input.uuid);
	const name = parseGithubRepoName(input.name);
	const path = boardFileWatchPath(name);
	const headers = await signDeviceHeaders(env, "GET", path);
	return { wsUrl: filesWsConnectUrl(device.deviceUrl, name, headers) };
}
