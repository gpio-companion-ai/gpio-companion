export type ShippingAddress = {
	name: string;
	line1: string;
	line2?: string | null;
	city: string;
	region?: string | null;
	postalCode: string;
	country: string;
};

export function validateShippingAddress(
	input: Partial<ShippingAddress> | null | undefined,
): ShippingAddress {
	return {
		name: requireText(input?.name, "Full name"),
		line1: requireText(input?.line1, "Address"),
		line2: optionalText(input?.line2),
		city: requireText(input?.city, "City"),
		region: optionalText(input?.region),
		postalCode: requireText(input?.postalCode, "Postal code"),
		country: requireText(input?.country, "Country"),
	};
}

export function shippingAddressFrom(value: unknown): ShippingAddress | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	try {
		return validateShippingAddress(value as Partial<ShippingAddress>);
	} catch {
		return null;
	}
}

export function formatShippingAddress(address: ShippingAddress): string {
	const locality = [address.city, address.region, address.postalCode]
		.filter(Boolean)
		.join(" ");
	return [address.name, address.line1, address.line2, locality, address.country]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

function requireText(value: string | null | undefined, label: string): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) {
		throw new Error(`${label} is required`);
	}
	return trimmed;
}

function optionalText(value: string | null | undefined): string | null {
	return value?.trim() || null;
}
