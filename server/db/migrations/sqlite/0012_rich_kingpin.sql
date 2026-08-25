CREATE INDEX `notification_log_type_sent_idx` ON `notification_log` (`type`,`sent_at`);--> statement-breakpoint
CREATE INDEX `notification_log_sent_at_idx` ON `notification_log` (`sent_at`);