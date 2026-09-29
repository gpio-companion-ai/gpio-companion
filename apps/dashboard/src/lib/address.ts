import { type ShippingAddress, validateShippingAddress } from "gpio-companion";

export function shippingAddressKey(userId: string): string {
	return `address:${userId}`;
}

export async function loadShippingAddress(
	kv: KVNamespace,
	userId: string,
): Promise<ShippingAddress | null> {
	const id = userId.trim();
	if (!id) {
		return null;
	}
	const raw = await kv.get(shippingAddressKey(id));
	if (!raw) {
		return null;
	}
	try {
		return validateShippingAddress(JSON.parse(raw) as Partial<ShippingAddress>);
	} catch {
		return null;
	}
}

export async function saveShippingAddress(
	kv: KVNamespace,
	userId: string,
	address: ShippingAddress,
): Promise<ShippingAddress> {
	const id = userId.trim();
	if (!id || id !== userId) {
		throw new Error("sign in first");
	}
	const stored = validateShippingAddress(address);
	await kv.put(shippingAddressKey(id), JSON.stringify(stored));
	return stored;
}

export async function handleAddressRead(input: {
	kv: KVNamespace;
	userId: string;
}): Promise<{ address: ShippingAddress | null }> {
	return { address: await loadShippingAddress(input.kv, input.userId) };
}

export async function handleAddressSave(input: {
	kv: KVNamespace;
	userId: string;
	body: Record<string, unknown>;
}): Promise<{ address: ShippingAddress }> {
	const address = validateShippingAddress({
		name: text(input.body.name),
		line1: text(input.body.line1),
		line2: text(input.body.line2),
		city: text(input.body.city),
		region: text(input.body.region),
		postalCode: text(input.body.postalCode),
		country: text(input.body.country),
	});
	return {
		address: await saveShippingAddress(input.kv, input.userId, address),
	};
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
