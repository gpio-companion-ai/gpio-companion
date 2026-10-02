ALTER TABLE `orders` ADD `shipping_courier_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_courier_name` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_min_days` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_max_days` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`sku` text NOT NULL,
	`name_en` text NOT NULL,
	`name_fr` text NOT NULL,
	`description_en` text NOT NULL,
	`description_fr` text NOT NULL,
	`price_cents` integer,
	`weight_grams` integer,
	`length_cm` integer,
	`width_cm` integer,
	`height_cm` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`published_at` integer,
	CONSTRAINT "products_status_check" CHECK("__new_products"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "products_price_cents_check" CHECK("__new_products"."price_cents" is null or "__new_products"."price_cents" >= 0),
	CONSTRAINT "products_weight_grams_check" CHECK("__new_products"."weight_grams" is null or "__new_products"."weight_grams" > 0),
	CONSTRAINT "products_length_cm_check" CHECK("__new_products"."length_cm" is null or "__new_products"."length_cm" > 0),
	CONSTRAINT "products_width_cm_check" CHECK("__new_products"."width_cm" is null or "__new_products"."width_cm" > 0),
	CONSTRAINT "products_height_cm_check" CHECK("__new_products"."height_cm" is null or "__new_products"."height_cm" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "slug", "sku", "name_en", "name_fr", "description_en", "description_fr", "price_cents", "weight_grams", "length_cm", "width_cm", "height_cm", "status", "created_at", "updated_at", "published_at") SELECT "id", "slug", "sku", "name_en", "name_fr", "description_en", "description_fr", "price_cents", "weight_grams", "length_cm", "width_cm", "height_cm", "status", "created_at", "updated_at", "published_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`);