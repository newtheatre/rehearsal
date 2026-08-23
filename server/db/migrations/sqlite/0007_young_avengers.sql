ALTER TABLE `notification_log` ADD `session_id` text;--> statement-breakpoint
CREATE INDEX `notification_log_session_type_idx` ON `notification_log` (`session_id`,`type`);