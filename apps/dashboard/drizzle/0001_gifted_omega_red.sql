CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`audio_seconds` real,
	`chars` integer,
	`micros` integer NOT NULL,
	CONSTRAINT "ai_usage_micros_check" CHECK("ai_usage"."micros" >= 0),
	CONSTRAINT "ai_usage_kind_check" CHECK("ai_usage"."kind" in ('chat', 'embedding', 'stt', 'tts'))
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_user_model_idx` ON `ai_usage` (`user_id`,`model`);