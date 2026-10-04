import { signOfflineEnvelope } from "./offline-sign.ts";

const KEY = "gpio-companion-offline-keys";
const memory = new Map<string, string>();

export type StoredOfflineKey = {
	uuid: string;
	privateKeyPem: string;
	grant: {
		v: string;
		uuid: string;
		userId: string;
		keyId: string;
		pub: string;
		iat: number;
		exp: number;
		scope: string[];
		sig: string;
	};
	exp: number;
};

type Store = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
};

let native: Store | null | undefined;

async function store(): Promise<Store> {
	if (native !== undefined) {
		return native ?? memoryStore();
	}
	try {
		const mod = await import("expo-secure-store");
		native = {
			getItem: (key) => mod.getItemAsync(key),
			setItem: (key, value) => mod.setItemAsync(key, value),
		};
		return native;
	} catch {
		native = null;
		return memoryStore();
	}
}

function memoryStore(): Store {
	return {
		getItem: async (key) => memory.get(key) ?? null,
		setItem: async (key, value) => {
			memory.set(key, value);
		},
	};
}

function parseMap(raw: string | null): Record<string, StoredOfflineKey> {
	if (!raw) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return parsed as Record<string, StoredOfflineKey>;
	} catch {
		return {};
	}
}

async function readMap(): Promise<Record<string, StoredOfflineKey>> {
	return parseMap(await (await store()).getItem(KEY));
}

async function writeMap(map: Record<string, StoredOfflineKey>): Promise<void> {
	await (await store()).setItem(KEY, JSON.stringify(map));
}

export async function loadOfflineKey(
	uuid: string,
): Promise<StoredOfflineKey | null> {
	const trimmed = uuid.trim();
	if (!trimmed) {
		return null;
	}
	return (await readMap())[trimmed] ?? null;
}

export async function saveOfflineKey(record: StoredOfflineKey): Promise<void> {
	const map = await readMap();
	map[record.uuid] = record;
	await writeMap(map);
}

export async function clearOfflineKeys(): Promise<void> {
	await writeMap({});
}

export function liveOfflineKey(
	record: StoredOfflineKey | null,
	now = Date.now(),
): StoredOfflineKey | null {
	if (!record || record.grant.exp <= now) {
		return null;
	}
	return record;
}

export function shouldMintOfflineKey(
	record: StoredOfflineKey | null,
	now = Date.now(),
): boolean {
	if (!record) {
		return true;
	}
	return record.grant.exp - now <= 60 * 60 * 1000;
}

export function offlineKeyLabel(
	record: StoredOfflineKey | null,
	now = Date.now(),
): string {
	if (!record) {
		return "Offline BLE key not issued";
	}
	if (record.grant.exp <= now) {
		return "Offline BLE key expired";
	}
	const hours = Math.max(0, Math.floor((record.grant.exp - now) / 3_600_000));
	return `Offline BLE · ${hours}h left`;
}

export function isOfflineSignFallback(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /failed to fetch|network|offline|could not reach|load failed|timed out|connection/i.test(
		message,
	);
}

export async function signWithStoredKey(
	uuid: string,
	method: string,
	path: string,
	body = "",
) {
	const record = liveOfflineKey(await loadOfflineKey(uuid));
	if (!record) {
		throw new Error("Go online once to issue a 24h Bluetooth key");
	}
	return signOfflineEnvelope({
		privateKeyPem: record.privateKeyPem,
		grant: record.grant,
		method,
		path,
		body,
	});
}
