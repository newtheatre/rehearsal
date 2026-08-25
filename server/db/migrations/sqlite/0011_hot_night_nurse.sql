ALTER TABLE `users` ADD `merged_into` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `users_merged_into_idx` ON `users` (`merged_into`);