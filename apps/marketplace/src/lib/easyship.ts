const EASYSHIP_PRODUCTION_BASE = "https://public-api.easyship.com";
const EASYSHIP_SANDBOX_BASE = "https://public-api-sandbox.easyship.com";
const EASYSHIP_API_VERSION = "2024-09";
const EASYSHIP_TIMEOUT_MS = 15_000;

export type EasyShipEnv = {
	EASYSHIP_API_TOKEN?: string;
	EASYSHIP_ORIGIN_LINE1?: string;
	EASYSHIP_ORIGIN_LINE2?: string;
	EASYSHIP_ORIGIN_CITY?: string;
	EASYSHIP_ORIGIN_REGION?: string;
	EASYSHIP_ORIGIN_POSTAL_CODE?: string;
	EASYSHIP_ORIGIN_COUNTRY?: string;
	EASYSHIP_ORIGIN_CONTACT_NAME?: string;
	EASYSHIP_ORIGIN_CONTACT_EMAIL?: string;
	EASYSHIP_ORIGIN_CONTACT_PHONE?: string;
	EASYSHIP_ITEM_CATEGORY?: string;
};

export type EasyShipOrigin = {
	line1: string;
	line2: string | null;
	city: string;
	region: string;
	postalCode: string;
	country: string;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
};

export type EasyShipDestination = {
	line1: string;
	line2?: string | null;
	city: string;
	region?: string | null;
	postalCode: string;
	country: string;
};

export type EasyShipParcelItem = {
	sku: string;
	description: string;
	quantity: number;
	weightGrams: number;
	lengthCm: number | null;
	widthCm: number | null;
	heightCm: number | null;
	unitValueCents: number;
};

export type EasyShipRateOption = {
	id: string;
	courierName: string;
	totalCents: number;
	minDays: number | null;
	maxDays: number | null;
	description: string | null;
};

type EasyShipErrorBody = {
	error?: {
		message?: string;
		details?: string[] | null;
	};
};

type EasyShipRateBody = {
	rates?: Array<{
		courier_service?: {
			id?: string;
			name?: string;
			umbrella_name?: string;
		} | null;
		currency?: string;
		total_charge?: number;
		min_delivery_time?: number | null;
		max_delivery_time?: number | null;
		full_description?: string | null;
	} | null>;
};

const COUNTRIES_REQUIRING_REGION = new Set([
	"AU",
	"CA",
	"CN",
	"ID",
	"MX",
	"MY",
	"TH",
	"US",
	"VN",
]);

function asEasyShipEnv(env: object): EasyShipEnv {
	return env as EasyShipEnv;
}

function trimmed(value: string | undefined): string {
	return value?.trim() ?? "";
}

export function easyshipTokenConfigured(env: object): boolean {
	return Boolean(trimmed(asEasyShipEnv(env).EASYSHIP_API_TOKEN));
}

export function easyshipOrigin(env: object): EasyShipOrigin | null {
	const config = asEasyShipEnv(env);
	const line1 = trimmed(config.EASYSHIP_ORIGIN_LINE1);
	const city = trimmed(config.EASYSHIP_ORIGIN_CITY);
	const region = trimmed(config.EASYSHIP_ORIGIN_REGION);
	const postalCode = trimmed(config.EASYSHIP_ORIGIN_POSTAL_CODE);
	const country = trimmed(config.EASYSHIP_ORIGIN_COUNTRY).toUpperCase();
	if (!line1 || !city || !region || !postalCode || !country) return null;
	return {
		line1,
		line2: trimmed(config.EASYSHIP_ORIGIN_LINE2) || null,
		city,
		region,
		postalCode,
		country,
		contactName: trimmed(config.EASYSHIP_ORIGIN_CONTACT_NAME) || null,
		contactEmail: trimmed(config.EASYSHIP_ORIGIN_CONTACT_EMAIL) || null,
		contactPhone: trimmed(config.EASYSHIP_ORIGIN_CONTACT_PHONE) || null,
	};
}

export function easyshipConfigured(env: object): boolean {
	return easyshipTokenConfigured(env) && easyshipOrigin(env) !== null;
}

function easyshipBase(token: string): string {
	return token.startsWith("sand_")
		? EASYSHIP_SANDBOX_BASE
		: EASYSHIP_PRODUCTION_BASE;
}

export function itemCategory(env: object): string {
	return trimmed(asEasyShipEnv(env).EASYSHIP_ITEM_CATEGORY) || "electronics";
}

function assertPositiveCents(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer number of cents`);
	}
}

export function buildEasyShipItems(
	lines: readonly {
		productId: string;
		sku: string;
		nameEn: string;
		quantity: number;
		unitPriceCents: number;
	}[],
	products: readonly {
		id: string;
		weightGrams: number | null;
		lengthCm: number | null;
		widthCm: number | null;
		heightCm: number | null;
	}[],
): EasyShipParcelItem[] {
	const byId = new Map(products.map((product) => [product.id, product]));
	return lines.map((line) => {
		assertPositiveCents(line.unitPriceCents, `Customs value for ${line.sku}`);
		const product = byId.get(line.productId);
		if (!product?.weightGrams) {
			throw new Error(`Shipping weight is not configured for: ${line.sku}`);
		}
		return {
			sku: line.sku,
			description: line.nameEn,
			quantity: line.quantity,
			weightGrams: product.weightGrams,
			lengthCm: product.lengthCm ?? null,
			widthCm: product.widthCm ?? null,
			heightCm: product.heightCm ?? null,
			unitValueCents: line.unitPriceCents,
		};
	});
}

export function boxDimensions(
	items: readonly EasyShipParcelItem[],
): { length: number; width: number; height: number } | null {
	let length = 0;
	let width = 0;
	let height = 0;
	let found = false;
	for (const item of items) {
		if (item.lengthCm && item.widthCm && item.heightCm) {
			found = true;
			length = Math.max(length, item.lengthCm);
			width = Math.max(width, item.widthCm);
			height = Math.max(height, item.heightCm);
		}
	}
	return found ? { length, width, height } : null;
}

export function validateEasyShipDestination(
	destination: EasyShipDestination,
): void {
	const country = destination.country.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(country)) {
		throw new Error("Country must be an ISO 3166-1 alpha-2 code");
	}
	for (const field of ["line1", "city", "postalCode"] as const) {
		if (!destination[field]?.trim()) {
			throw new Error(
				`${field === "line1" ? "Address" : field === "city" ? "City" : "Postal code"} is required for shipping`,
			);
		}
	}
	if (COUNTRIES_REQUIRING_REGION.has(country) && !destination.region?.trim()) {
		throw new Error(`Region/state is required for shipping to ${country}`);
	}
}

export function centsFromAmount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error("EasyShip returned an invalid rate amount");
	}
	return Math.round(value * 100);
}

export function mapEasyShipRate(
	rate: NonNullable<NonNullable<EasyShipRateBody["rates"]>[number]>,
): EasyShipRateOption | null {
	const id = rate.courier_service?.id;
	if (!id) return null;
	const currency = rate.currency;
	if (currency !== "USD") {
		throw new Error(
			"EasyShip returned shipping quotes in an unsupported currency",
		);
	}
	return {
		id,
		courierName:
			rate.courier_service?.name ??
			rate.courier_service?.umbrella_name ??
			"Courier",
		totalCents: centsFromAmount(rate.total_charge),
		minDays: rate.min_delivery_time ?? null,
		maxDays: rate.max_delivery_time ?? null,
		description: rate.full_description ?? null,
	};
}

export async function requestEasyShipRates(
	env: object,
	input: {
		destination: EasyShipDestination;
		items: readonly EasyShipParcelItem[];
	},
): Promise<EasyShipRateOption[]> {
	const config = asEasyShipEnv(env);
	const token = trimmed(config.EASYSHIP_API_TOKEN);
	const origin = easyshipOrigin(env);
	if (!token || !origin) throw new Error("EasyShip is not configured");
	validateEasyShipDestination(input.destination);
	if (input.items.length === 0) {
		throw new Error("Cart must contain at least one item");
	}
	const box = boxDimensions(input.items);
	const totalWeightGrams = input.items.reduce(
		(total, item) => total + item.weightGrams * item.quantity,
		0,
	);
	const category = itemCategory(env);
	const body = {
		origin_address: {
			line_1: origin.line1,
			line_2: origin.line2 ?? undefined,
			state: origin.region,
			city: origin.city,
			postal_code: origin.postalCode,
			country_alpha2: origin.country,
			contact_name: origin.contactName ?? undefined,
			contact_email: origin.contactEmail ?? undefined,
			contact_phone: origin.contactPhone ?? undefined,
		},
		destination_address: {
			line_1: input.destination.line1.trim(),
			line_2: input.destination.line2?.trim() || undefined,
			state: input.destination.region?.trim() || undefined,
			city: input.destination.city.trim(),
			postal_code: input.destination.postalCode.trim(),
			country_alpha2: input.destination.country.trim().toUpperCase(),
		},
		shipping_settings: {
			units: { weight: "g", dimensions: "cm" },
			output_currency: "USD",
		},
		parcels: [
			{
				total_actual_weight: totalWeightGrams,
				box,
				items: input.items.map((item) => ({
					description: item.description,
					category,
					sku: item.sku,
					quantity: item.quantity,
					actual_weight: item.weightGrams,
					declared_currency: "USD",
					declared_customs_value: item.unitValueCents / 100,
					...(box
						? {}
						: item.lengthCm && item.widthCm && item.heightCm
							? {
									dimensions: {
										length: item.lengthCm,
										width: item.widthCm,
										height: item.heightCm,
									},
								}
							: {}),
				})),
			},
		],
	};
	const response = await fetch(
		`${easyshipBase(token)}/${EASYSHIP_API_VERSION}/rates`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(EASYSHIP_TIMEOUT_MS),
		},
	);
	if (!response.ok) {
		const body = (await response
			.json()
			.catch(() => null)) as EasyShipErrorBody | null;
		const detail = body?.error?.details?.join("; ");
		throw new Error(
			body?.error?.message ?? detail ?? "EasyShip rate request failed",
		);
	}
	const parsed = (await response.json()) as EasyShipRateBody;
	const rates = parsed.rates ?? [];
	const options: EasyShipRateOption[] = [];
	for (const rate of rates) {
		if (!rate) continue;
		const option = mapEasyShipRate(rate);
		if (option) options.push(option);
	}
	options.sort((a, b) => a.totalCents - b.totalCents);
	return options;
}
