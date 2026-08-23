ALTER TABLE `session_attendees` ADD `status` text DEFAULT 'ATTENDED' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `signed_up_at` integer;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `source` text DEFAULT 'LEAD' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `marked_at` integer;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `marked_by_user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `session_attendees_status_idx` ON `session_attendees` (`session_id`,`status`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `status` text DEFAULT 'DELIVERED' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `starts_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ends_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `capacity` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `signups_close_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `register_opened_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `delivered_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `description` text;--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `sessions` (`status`);