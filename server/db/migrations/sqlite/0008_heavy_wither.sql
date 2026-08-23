CREATE TABLE `module_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`resolved_session_id` text,
	`resolved_at` integer,
	`resolved_by` text,
	`decline_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_requests_open_unq` ON `module_requests` (`user_id`,`module_id`) WHERE status = 'OPEN';--> statement-breakpoint
CREATE INDEX `module_requests_module_idx` ON `module_requests` (`module_id`,`status`);--> statement-breakpoint
CREATE INDEX `module_requests_user_idx` ON `module_requests` (`user_id`);