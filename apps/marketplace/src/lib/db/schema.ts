import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const productStatuses = ["draft", "published", "archived"] as const;
export const orderStatuses = [
	"pending",
	"confirmed",
	"completed",
	"cancelled",
] as const;
export const paymentStatuses = [
	"pending",
	"authorized",
	"captured",
	"failed",
	"refunded",
	"voided",
] as const;
export const fulfillmentStatuses = [
	"unfulfilled",
	"processing",
	"shipped",
	"delivered",
	"cancelled",
] as const;
export const reservationStatuses = [
	"active",
	"released",
	"consumed",
	"expired",
] as const;
export const policyStatuses = ["draft", "published"] as const;

export type ProductStatus = (typeof productStatuses)[number];
export type OrderStatus = (typeof orderStatuses)[number];
export type PaymentStatus = (typeof paymentStatuses)[number];
export type FulfillmentStatus = (typeof fulfillmentStatuses)[number];
export type ReservationStatus = (typeof reservationStatuses)[number];
export type PolicyStatus = (typeof policyStatuses)[number];

const unixSeconds = sql`(unixepoch())`;

export const products = sqliteTable(
	"products",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		sku: text("sku").notNull(),
		nameEn: text("name_en").notNull(),
		nameFr: text("name_fr").notNull(),
		descriptionEn: text("description_en").notNull(),
		descriptionFr: text("description_fr").notNull(),
		priceCents: integer("price_cents"),
		weightGrams: integer("weight_grams"),
		lengthCm: integer("length_cm"),
		widthCm: integer("width_cm"),
		heightCm: integer("height_cm"),
		status: text("status", { enum: productStatuses })
			.notNull()
			.default("draft"),
		createdAt: integer("created_at").notNull().default(unixSeconds),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
		publishedAt: integer("published_at"),
	},
	(table) => [
		uniqueIndex("products_slug_unique").on(table.slug),
		uniqueIndex("products_sku_unique").on(table.sku),
		index("products_status_idx").on(table.status),
		check(
			"products_status_check",
			sql`${table.status} in ('draft', 'published', 'archived')`,
		),
		check(
			"products_price_cents_check",
			sql`${table.priceCents} is null or ${table.priceCents} >= 0`,
		),
		check(
			"products_weight_grams_check",
			sql`${table.weightGrams} is null or ${table.weightGrams} > 0`,
		),
		check(
			"products_length_cm_check",
			sql`${table.lengthCm} is null or ${table.lengthCm} > 0`,
		),
		check(
			"products_width_cm_check",
			sql`${table.widthCm} is null or ${table.widthCm} > 0`,
		),
		check(
			"products_height_cm_check",
			sql`${table.heightCm} is null or ${table.heightCm} > 0`,
		),
	],
);

export const productImages = sqliteTable(
	"product_images",
	{
		id: text("id").primaryKey(),
		productId: text("product_id")
			.notNull()
			.references(() => products.id, { onDelete: "cascade" }),
		r2Key: text("r2_key").notNull(),
		altEn: text("alt_en").notNull(),
		altFr: text("alt_fr").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: integer("created_at").notNull().default(unixSeconds),
	},
	(table) => [
		uniqueIndex("product_images_r2_key_unique").on(table.r2Key),
		index("product_images_product_sort_idx").on(
			table.productId,
			table.sortOrder,
		),
		check("product_images_sort_check", sql`${table.sortOrder} >= 0`),
	],
);

export const inventory = sqliteTable(
	"inventory",
	{
		productId: text("product_id")
			.primaryKey()
			.references(() => products.id, { onDelete: "restrict" }),
		onHand: integer("on_hand").notNull().default(0),
		reserved: integer("reserved").notNull().default(0),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
	},
	(table) => [
		check("inventory_on_hand_check", sql`${table.onHand} >= 0`),
		check("inventory_reserved_check", sql`${table.reserved} >= 0`),
		check(
			"inventory_reserved_on_hand_check",
			sql`${table.reserved} <= ${table.onHand}`,
		),
	],
);

export const shippingRates = sqliteTable(
	"shipping_rates",
	{
		id: text("id").primaryKey(),
		country: text("country").notNull(),
		region: text("region"),
		flatCents: integer("flat_cents").notNull(),
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		createdAt: integer("created_at").notNull().default(unixSeconds),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
	},
	(table) => [
		uniqueIndex("shipping_rates_country_default_unique")
			.on(table.country)
			.where(sql`${table.region} is null`),
		uniqueIndex("shipping_rates_country_region_unique")
			.on(table.country, table.region)
			.where(sql`${table.region} is not null`),
		index("shipping_rates_destination_idx").on(
			table.country,
			table.region,
			table.active,
		),
		check("shipping_rates_flat_cents_check", sql`${table.flatCents} >= 0`),
	],
);

export const orders = sqliteTable(
	"orders",
	{
		id: text("id").primaryKey(),
		orderNumber: text("order_number").notNull(),
		userId: text("user_id"),
		email: text("email").notNull(),
		status: text("status", { enum: orderStatuses })
			.notNull()
			.default("pending"),
		paymentStatus: text("payment_status", { enum: paymentStatuses })
			.notNull()
			.default("pending"),
		fulfillmentStatus: text("fulfillment_status", {
			enum: fulfillmentStatuses,
		})
			.notNull()
			.default("unfulfilled"),
		paypalOrderId: text("paypal_order_id"),
		paypalCaptureId: text("paypal_capture_id"),
		idempotencyKey: text("idempotency_key"),
		carrier: text("carrier"),
		trackingNumber: text("tracking_number"),
		subtotalCents: integer("subtotal_cents").notNull(),
		shippingCents: integer("shipping_cents").notNull(),
		taxCents: integer("tax_cents").notNull().default(0),
		totalCents: integer("total_cents").notNull(),
		currency: text("currency").notNull().default("USD"),
		shippingName: text("shipping_name").notNull(),
		shippingLine1: text("shipping_line1").notNull(),
		shippingLine2: text("shipping_line2"),
		shippingCity: text("shipping_city").notNull(),
		shippingRegion: text("shipping_region"),
		shippingPostalCode: text("shipping_postal_code").notNull(),
		shippingCountry: text("shipping_country").notNull(),
		shippingCourierId: text("shipping_courier_id"),
		shippingCourierName: text("shipping_courier_name"),
		shippingMinDays: integer("shipping_min_days"),
		shippingMaxDays: integer("shipping_max_days"),
		createdAt: integer("created_at").notNull().default(unixSeconds),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
		paidAt: integer("paid_at"),
		fulfilledAt: integer("fulfilled_at"),
		cancelledAt: integer("cancelled_at"),
	},
	(table) => [
		uniqueIndex("orders_order_number_unique").on(table.orderNumber),
		uniqueIndex("orders_paypal_order_id_unique").on(table.paypalOrderId),
		uniqueIndex("orders_paypal_capture_id_unique").on(table.paypalCaptureId),
		uniqueIndex("orders_idempotency_key_unique")
			.on(table.idempotencyKey)
			.where(sql`${table.idempotencyKey} is not null`),
		index("orders_user_created_idx").on(table.userId, table.createdAt),
		index("orders_status_created_idx").on(table.status, table.createdAt),
		check(
			"orders_status_check",
			sql`${table.status} in ('pending', 'confirmed', 'completed', 'cancelled')`,
		),
		check(
			"orders_payment_status_check",
			sql`${table.paymentStatus} in ('pending', 'authorized', 'captured', 'failed', 'refunded', 'voided')`,
		),
		check(
			"orders_fulfillment_status_check",
			sql`${table.fulfillmentStatus} in ('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled')`,
		),
		check("orders_currency_check", sql`${table.currency} = 'USD'`),
		check(
			"orders_amounts_check",
			sql`${table.subtotalCents} >= 0 and ${table.shippingCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.shippingCents} + ${table.taxCents}`,
		),
	],
);

export const orderItems = sqliteTable(
	"order_items",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		productId: text("product_id").references(() => products.id, {
			onDelete: "set null",
		}),
		sku: text("sku").notNull(),
		nameEn: text("name_en").notNull(),
		nameFr: text("name_fr").notNull(),
		unitPriceCents: integer("unit_price_cents").notNull(),
		quantity: integer("quantity").notNull(),
		lineTotalCents: integer("line_total_cents").notNull(),
		createdAt: integer("created_at").notNull().default(unixSeconds),
	},
	(table) => [
		index("order_items_order_idx").on(table.orderId),
		check("order_items_unit_price_check", sql`${table.unitPriceCents} >= 0`),
		check("order_items_quantity_check", sql`${table.quantity} > 0`),
		check(
			"order_items_line_total_check",
			sql`${table.lineTotalCents} = ${table.unitPriceCents} * ${table.quantity}`,
		),
	],
);

export const inventoryReservations = sqliteTable(
	"inventory_reservations",
	{
		id: text("id").primaryKey(),
		idempotencyKey: text("idempotency_key").notNull(),
		orderId: text("order_id")
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		productId: text("product_id")
			.notNull()
			.references(() => inventory.productId, { onDelete: "restrict" }),
		quantity: integer("quantity").notNull(),
		status: text("status", { enum: reservationStatuses })
			.notNull()
			.default("active"),
		expiresAt: integer("expires_at").notNull(),
		createdAt: integer("created_at").notNull().default(unixSeconds),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
	},
	(table) => [
		uniqueIndex("inventory_reservations_idempotency_unique").on(
			table.idempotencyKey,
		),
		index("inventory_reservations_product_status_idx").on(
			table.productId,
			table.status,
		),
		index("inventory_reservations_expiry_idx").on(
			table.status,
			table.expiresAt,
		),
		index("inventory_reservations_order_idx").on(table.orderId),
		check("inventory_reservations_quantity_check", sql`${table.quantity} > 0`),
		check(
			"inventory_reservations_status_check",
			sql`${table.status} in ('active', 'released', 'consumed', 'expired')`,
		),
	],
);

export const inventoryAdjustments = sqliteTable(
	"inventory_adjustments",
	{
		id: text("id").primaryKey(),
		productId: text("product_id")
			.notNull()
			.references(() => inventory.productId, { onDelete: "restrict" }),
		delta: integer("delta").notNull(),
		reason: text("reason").notNull(),
		referenceId: text("reference_id"),
		actorId: text("actor_id"),
		createdAt: integer("created_at").notNull().default(unixSeconds),
	},
	(table) => [
		index("inventory_adjustments_product_created_idx").on(
			table.productId,
			table.createdAt,
		),
		uniqueIndex("inventory_adjustments_product_reference_unique")
			.on(table.productId, table.referenceId)
			.where(sql`${table.referenceId} is not null`),
		check("inventory_adjustments_delta_check", sql`${table.delta} <> 0`),
	],
);

export const paymentEvents = sqliteTable(
	"payment_events",
	{
		id: text("id").primaryKey(),
		provider: text("provider").notNull().default("paypal"),
		providerEventId: text("provider_event_id").notNull(),
		orderId: text("order_id").references(() => orders.id, {
			onDelete: "set null",
		}),
		eventType: text("event_type").notNull(),
		payload: text("payload").notNull(),
		processedAt: integer("processed_at"),
		createdAt: integer("created_at").notNull().default(unixSeconds),
	},
	(table) => [
		uniqueIndex("payment_events_provider_event_id_unique").on(
			table.providerEventId,
		),
		index("payment_events_order_idx").on(table.orderId),
	],
);

export const policies = sqliteTable(
	"policies",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		titleEn: text("title_en").notNull(),
		titleFr: text("title_fr").notNull(),
		bodyEn: text("body_en").notNull(),
		bodyFr: text("body_fr").notNull(),
		status: text("status", { enum: policyStatuses }).notNull().default("draft"),
		createdAt: integer("created_at").notNull().default(unixSeconds),
		updatedAt: integer("updated_at").notNull().default(unixSeconds),
		publishedAt: integer("published_at"),
	},
	(table) => [
		uniqueIndex("policies_slug_unique").on(table.slug),
		index("policies_status_idx").on(table.status),
		check(
			"policies_status_check",
			sql`${table.status} in ('draft', 'published')`,
		),
	],
);
