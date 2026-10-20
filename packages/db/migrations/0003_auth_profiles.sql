CREATE TABLE `auth_capture_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`profile_name` text NOT NULL,
	`start_path` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`worker_id` text,
	`heartbeat_at` integer,
	`save_requested_at` integer,
	`cancel_requested_at` integer,
	`auth_profile_id` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_capture_status_idx` ON `auth_capture_sessions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`encrypted_storage_state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_profiles_env_name_uq` ON `auth_profiles` (`environment_id`,`name`);