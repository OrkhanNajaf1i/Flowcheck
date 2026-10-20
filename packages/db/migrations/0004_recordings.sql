CREATE TABLE `recording_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`client_event_id` text,
	`sequence` integer NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `recording_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_events_seq_uq` ON `recording_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `recording_events_client_uq` ON `recording_events` (`session_id`,`client_event_id`);--> statement-breakpoint
CREATE TABLE `recording_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`test_case_id` text,
	`start_path` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`worker_id` text,
	`heartbeat_at` integer,
	`stop_requested_at` integer,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recording_status_idx` ON `recording_sessions` (`status`,`created_at`);