CREATE TABLE `practice_targets` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`consumer` text,
	`module_ids` text DEFAULT '[]' NOT NULL,
	`grace_hours` integer,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `practice_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_key` text NOT NULL,
	`session_id` text,
	`opened_by` text NOT NULL,
	`opens_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_key`) REFERENCES `practice_targets`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `practice_windows_user_idx` ON `practice_windows` (`user_id`,`target_key`);--> statement-breakpoint
CREATE INDEX `practice_windows_session_idx` ON `practice_windows` (`session_id`);--> statement-breakpoint
CREATE INDEX `practice_windows_expires_idx` ON `practice_windows` (`expires_at`);