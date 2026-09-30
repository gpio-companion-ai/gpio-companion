CREATE TABLE `opencode_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "opencode_prompts_kind_check" CHECK("opencode_prompts"."kind" in ('question', 'permission')),
	CONSTRAINT "opencode_prompts_repo_check" CHECK(length("opencode_prompts"."repo") > 0),
	CONSTRAINT "opencode_prompts_session_check" CHECK(length("opencode_prompts"."session_id") > 0)
);
--> statement-breakpoint
CREATE INDEX `opencode_prompts_repo_session` ON `opencode_prompts` (`repo`,`session_id`);