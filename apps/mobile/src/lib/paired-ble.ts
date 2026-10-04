import { patchDeviceBleMac } from "./api.ts";
import {
	type BleInfo,
	type BoardLoss,
	type BoardSession,
	connectById,
	createBoardLoss,
	openBoardSession,
	readInfo,
	scanBoard,
} from "./ble.ts";
import { looksLikeMac } from "./ble-frame.ts";
import { loadLocalBleId, saveLocalBleId } from "./ble-ids.ts";

function normalizeBleMac(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || !looksLikeMac(trimmed)) {
		return "";
	}
	const hex = trimmed.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
	return hex.match(/.{2}/g)?.join(":") ?? "";
}

async function remember(
	token: string | undefined,
	uuid: string,
	id: string,
): Promise<void> {
	await saveLocalBleId(uuid, id).catch(() => undefined);
	const mac = normalizeBleMac(id);
	if (!token || !mac) {
		return;
	}
	await patchDeviceBleMac(token, uuid, mac).catch(() => undefined);
}

async function tryId(
	id: string,
	uuid: string,
	onLost?: (reason: string) => void,
): Promise<{ session: BoardSession; info: BleInfo } | null> {
	const trimmed = id.trim();
	if (!trimmed) {
		return null;
	}
	try {
		const board = await connectById(trimmed);
		const session = await openBoardSession(board, onLost);
		try {
			const info = await readInfo(session.device);
			if (info.uuid && info.uuid !== uuid) {
				await session.close();
				return null;
			}
			return { session, info };
		} catch (caught) {
			await session.close();
			throw caught;
		}
	} catch {
		return null;
	}
}

export async function openPairedBoard(
	uuid: string,
	options: {
		token?: string;
		bleMac?: string;
		onLost?: (reason: string) => void;
	} = {},
): Promise<{ session: BoardSession; info: BleInfo; loss: BoardLoss }> {
	const trimmed = uuid.trim();
	if (!trimmed) {
		throw new Error("choose a paired board first");
	}
	const loss = createBoardLoss();
	const onLost = (why: string) => {
		options.onLost?.(why);
		loss.lose(why);
	};
	const localId = await loadLocalBleId(trimmed);
	const ids = [localId, options.bleMac ?? ""].filter(
		(id, index, all) => id.trim() && all.indexOf(id) === index,
	);
	for (const id of ids) {
		const hit = await tryId(id, trimmed, onLost);
		if (hit) {
			await remember(options.token, trimmed, hit.session.device.id);
			return { ...hit, loss };
		}
	}
	const board = await scanBoard();
	const session = await openBoardSession(board, onLost);
	try {
		const info = await readInfo(session.device);
		if (info.uuid && info.uuid !== trimmed) {
			throw new Error("this board is not the selected paired device");
		}
		await remember(options.token, trimmed, session.device.id);
		return { session, info, loss };
	} catch (caught) {
		await session.close();
		throw caught;
	}
}
