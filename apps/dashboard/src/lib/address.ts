import {
	type ShippingAddress,
	shippingAddressFrom,
	validateShippingAddress,
} from "gpio-companion";
import { requireSession } from "./session.ts";

export const ADDRESS_SAVE_FAILED = "address save failed";

export type AddressSession = {
	read(): Promise<unknown>;
	write(address: ShippingAddress): Promise<void>;
};

export function shippingAddressKey(userId: string): string {
	return `address:${userId}`;
}

export function addressFromSession(value: unknown): ShippingAddress | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const nested = record.public;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		const fromPublic = shippingAddressFrom(
			(nested as { address?: unknown }).address,
		);
		if (fromPublic) return fromPublic;
	}
	return shippingAddressFrom(record.address);
}

export async function loadShippingAddress(input: {
	session: AddressSession;
	kv?: KVNamespace;
	userId: string;
}): Promise<ShippingAddress | null> {
	const current = addressFromSession(await input.session.read());
	if (current) return current;
	const legacy = await legacyAddress(input.kv, input.userId);
	if (!legacy) return null;
	await input.session.write(legacy);
	await input.kv?.delete(shippingAddressKey(input.userId));
	return legacy;
}

export async function saveShippingAddress(input: {
	session: AddressSession;
	kv?: KVNamespace;
	userId: string;
	address: ShippingAddress;
}): Promise<ShippingAddress> {
	requireUser(input.userId);
	const stored = validateShippingAddress(input.address);
	await input.session.write(stored);
	await input.kv?.delete(shippingAddressKey(input.userId));
	return stored;
}

export async function handleAddressRead(input: {
	session: AddressSession;
	kv?: KVNamespace;
	userId: string;
}): Promise<{ address: ShippingAddress | null }> {
	return { address: await loadShippingAddress(input) };
}

export async function handleAddressSave(input: {
	session: AddressSession;
	kv?: KVNamespace;
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
		address: await saveShippingAddress({ ...input, address }),
	};
}

export async function addressContext(ctx: {
	request: { headers: { get(name: string): string | null } };
	env: { DYNAMIC_PAGE_KV?: KVNamespace };
}): Promise<{
	session: AddressSession;
	kv?: KVNamespace;
	userId: string;
}> {
	const { auth, identity } = await requireSession(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return {
		session: sessionFromClient(auth),
		kv: ctx.env.DYNAMIC_PAGE_KV,
		userId: identity.id,
	};
}

export function sessionFromClient(auth: {
	getUserSession(type: "public"): Promise<unknown>;
	updateUserSession(
		type: "public",
		data: { address: ShippingAddress },
	): Promise<unknown>;
}): AddressSession {
	return {
		async read() {
			return unwrap(await auth.getUserSession("public"), "request failed");
		},
		async write(address) {
			unwrap(
				await auth.updateUserSession("public", { address }),
				ADDRESS_SAVE_FAILED,
			);
		},
	};
}

function unwrap(value: unknown, fallback: string): unknown {
	if (value instanceof Error) {
		throw new Error(fallback);
	}
	return value;
}

async function legacyAddress(
	kv: KVNamespace | undefined,
	userId: string,
): Promise<ShippingAddress | null> {
	const id = userId.trim();
	if (!kv || !id) return null;
	const raw = await kv.get(shippingAddressKey(id));
	if (!raw) return null;
	try {
		return shippingAddressFrom(JSON.parse(raw));
	} catch {
		return null;
	}
}

function requireUser(userId: string): string {
	const id = userId.trim();
	if (!id || id !== userId) {
		throw new Error("sign in first");
	}
	return id;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
