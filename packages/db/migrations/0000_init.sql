CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_run_id` text,
	`type` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`sensitive` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_run_id`) REFERENCES `step_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_run_idx` ON `artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`frontend_base_url` text NOT NULL,
	`api_base_url` text NOT NULL,
	`allowed_origins` text NOT NULL,
	`allow_private_network` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `environments_project_idx` ON `environments` (`project_id`);--> statement-breakpoint
CREATE TABLE `execution_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`holder_kind` text NOT NULL,
	`holder_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	CONSTRAINT "execution_lock_single_row" CHECK("execution_lock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `step_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`phase` text NOT NULL,
	`order` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`expected` text,
	`actual` text,
	`error_code` text,
	`error_message` text,
	`skip_reason` text,
	FOREIGN KEY (`run_id`) REFERENCES `test_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_runs_order_uq` ON `step_runs` (`run_id`,`order`);--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`current_revision_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `test_cases_project_idx` ON `test_cases` (`project_id`);--> statement-breakpoint
CREATE TABLE `test_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`test_case_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_revisions_number_uq` ON `test_revisions` (`test_case_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`test_case_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`environment_snapshot` text NOT NULL,
	`inputs_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`cancellation_requested_at` integer,
	`failure_summary` text,
	`worker_id` text,
	`claimed_at` integer,
	`heartbeat_at` integer,
	`trace_enabled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `test_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `test_runs_queue_idx` ON `test_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `test_runs_test_case_idx` ON `test_runs` (`test_case_id`,`created_at`);