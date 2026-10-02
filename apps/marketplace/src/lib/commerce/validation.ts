export const MAX_CART_QUANTITY = 99;

const commerceIdPattern =
	/^(?:[a-z][a-z0-9]*_[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const skuPattern = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;

export interface CartInputItem {
	productId: string;
	quantity: number;
}

export interface PublicationCandidate {
	slug: string;
	sku: string;
	nameEn: string;
	nameFr: string;
	descriptionEn: string;
	descriptionFr: string;
	priceCents: number | null;
	weightGrams: number | null;
	dimensionsConfigured: boolean;
	imageCount: number;
	inventoryConfigured: boolean;
}

export function isCommerceId(value: string): boolean {
	return commerceIdPattern.test(value);
}

export function validateCartInput(
	items: readonly CartInputItem[],
): CartInputItem[] {
	if (items.length === 0) {
		throw new Error("Cart must contain at least one item");
	}

	const seen = new Set<string>();
	return items.map((item) => {
		if (!isCommerceId(item.productId)) {
			throw new Error(`Invalid product ID: ${item.productId}`);
		}
		if (
			!Number.isInteger(item.quantity) ||
			item.quantity < 1 ||
			item.quantity > MAX_CART_QUANTITY
		) {
			throw new Error(
				`Quantity must be an integer between 1 and ${MAX_CART_QUANTITY}`,
			);
		}
		if (seen.has(item.productId)) {
			throw new Error(`Duplicate product ID: ${item.productId}`);
		}
		seen.add(item.productId);
		return { productId: item.productId, quantity: item.quantity };
	});
}

export function validateProductPublication(
	candidate: PublicationCandidate,
): string[] {
	const errors: string[] = [];
	if (!slugPattern.test(candidate.slug)) errors.push("Slug is invalid");
	if (!skuPattern.test(candidate.sku)) errors.push("SKU is invalid");
	if (!candidate.nameEn.trim()) errors.push("English name is required");
	if (!candidate.nameFr.trim()) errors.push("French name is required");
	if (!candidate.descriptionEn.trim()) {
		errors.push("English description is required");
	}
	if (!candidate.descriptionFr.trim()) {
		errors.push("French description is required");
	}
	if (
		candidate.priceCents === null ||
		!Number.isSafeInteger(candidate.priceCents) ||
		candidate.priceCents < 0
	) {
		errors.push("A non-negative integer price is required");
	}
	if (
		candidate.weightGrams === null ||
		!Number.isSafeInteger(candidate.weightGrams) ||
		candidate.weightGrams <= 0
	) {
		errors.push("A positive shipping weight in grams is required");
	}
	if (!candidate.dimensionsConfigured) {
		errors.push("Package dimensions (length, width, height) are required");
	}
	if (candidate.imageCount < 1)
		errors.push("At least one product image is required");
	if (!candidate.inventoryConfigured)
		errors.push("Inventory must be configured");
	return errors;
}

export function assertCountryCode(value: string): string {
	const normalized = value.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(normalized)) {
		throw new Error("Country must be an ISO 3166-1 alpha-2 code");
	}
	return normalized;
}

export function normalizeRegion(
	value: string | null | undefined,
): string | null {
	const normalized = value?.trim().toUpperCase() ?? "";
	return normalized || null;
}
