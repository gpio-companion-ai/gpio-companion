import {
	parseSavedNetworks,
	type SavedNetwork,
	serializeSavedNetworks,
	upsertSavedNetwork,
} from "./wifi-networks.ts";

const KEY = "gpio-companion-wifi-networks";
const memory = new Map<string, string>();

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

export async function loadSavedNetworks(): Promise<SavedNetwork[]> {
	return parseSavedNetworks(await (await store()).getItem(KEY));
}

export async function rememberNetwork(
	ssid: string,
	psk: string,
): Promise<SavedNetwork[]> {
	const next = upsertSavedNetwork(await loadSavedNetworks(), ssid, psk);
	await (await store()).setItem(KEY, serializeSavedNetworks(next));
	return next;
}
