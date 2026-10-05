CREATE TABLE `support_reports` (
	`report_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`surface` text NOT NULL,
	`board` text DEFAULT '' NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`body_html` text NOT NULL,
	`summary_json` text NOT NULL,
	`emailed_at` text,
	CONSTRAINT "support_reports_surface_check" CHECK("support_reports"."surface" in ('web', 'desktop', 'mobile'))
);
--> statement-breakpoint
CREATE INDEX `support_reports_created_idx` ON `support_reports` (`created_at`);