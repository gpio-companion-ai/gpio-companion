CREATE TABLE `jlcpcb_draft_assembly_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`sort` integer NOT NULL,
	`component_code` text NOT NULL,
	`qty` integer NOT NULL,
	`ref` text,
	FOREIGN KEY (`user_id`) REFERENCES `jlcpcb_drafts`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jlcpcb_draft_assembly_qty_check" CHECK("jlcpcb_draft_assembly_lines"."qty" >= 1)
);
--> statement-breakpoint
CREATE INDEX `jlcpcb_draft_assembly_user_idx` ON `jlcpcb_draft_assembly_lines` (`user_id`,`sort`);--> statement-breakpoint
CREATE TABLE `jlcpcb_draft_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`sort` integer NOT NULL,
	`component_code` text NOT NULL,
	`qty` integer NOT NULL,
	`name` text,
	`package` text,
	`stock` text,
	`price` text,
	FOREIGN KEY (`user_id`) REFERENCES `jlcpcb_drafts`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jlcpcb_draft_parts_qty_check" CHECK("jlcpcb_draft_parts"."qty" >= 1)
);
--> statement-breakpoint
CREATE INDEX `jlcpcb_draft_parts_user_idx` ON `jlcpcb_draft_parts` (`user_id`,`sort`);--> statement-breakpoint
CREATE TABLE `jlcpcb_draft_prints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`sort` integer NOT NULL,
	`name` text NOT NULL,
	`file` text NOT NULL,
	`file_access_id` text,
	`item_count` text,
	FOREIGN KEY (`user_id`) REFERENCES `jlcpcb_drafts`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jlcpcb_draft_prints_user_idx` ON `jlcpcb_draft_prints` (`user_id`,`sort`);--> statement-breakpoint
CREATE TABLE `jlcpcb_drafts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`pcb_file` text,
	`pcb_file_key` text,
	`pcb_layer` text,
	`pcb_qty` text,
	`pcb_thickness` text,
	`pcb_order_type` text,
	`assembly_note` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "jlcpcb_drafts_repo_check" CHECK(length("jlcpcb_drafts"."repo") > 0)
);
