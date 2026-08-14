CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `department_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`department` text NOT NULL,
	`user_id` text NOT NULL,
	`granted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`department`) REFERENCES `departments`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `department_leads_user_idx` ON `department_leads` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_leads_dept_user_unq` ON `department_leads` (`department`,`user_id`);--> statement-breakpoint
CREATE TABLE `departments` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eligibility_rules` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`requires` text DEFAULT '{"allOf":[],"anyOf":[]}' NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `legacy_module_map` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`legacy_code` text NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_module_map_pair_unq` ON `legacy_module_map` (`module_id`,`legacy_code`);--> statement-breakpoint
CREATE TABLE `module_prerequisites` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`requires_module_id` text NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requires_module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `module_prerequisites_requires_idx` ON `module_prerequisites` (`requires_module_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_prerequisites_pair_unq` ON `module_prerequisites` (`module_id`,`requires_module_id`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`department` text NOT NULL,
	`kind` text DEFAULT 'MODULE' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`notes` text,
	`materials_url` text,
	`expiry_mode` text DEFAULT 'NONE' NOT NULL,
	`expiry_months` integer,
	`safety_critical` integer DEFAULT false NOT NULL,
	`signoff_required` integer DEFAULT false NOT NULL,
	`grants_supervisor` integer DEFAULT false NOT NULL,
	`grants_trainer` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`department`) REFERENCES `departments`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `modules_department_idx` ON `modules` (`department`);--> statement-breakpoint
CREATE INDEX `modules_status_idx` ON `modules` (`status`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`record_id` text,
	`module_id` text,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_log_user_idx` ON `notification_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `notification_log_record_type_idx` ON `notification_log` (`record_id`,`type`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`awarded_at` text NOT NULL,
	`expires_at` text,
	`source` text NOT NULL,
	`session_id` text,
	`granted_by` text,
	`external_ref` text,
	`revoked_at` integer,
	`revoked_by` text,
	`revoke_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `records_current_idx` ON `records` (`user_id`,`module_id`,`awarded_at`);--> statement-breakpoint
CREATE INDEX `records_module_idx` ON `records` (`module_id`);--> statement-breakpoint
CREATE INDEX `records_expires_at_idx` ON `records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT 'read' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_name_unique` ON `service_tokens` (`name`);--> statement-breakpoint
CREATE TABLE `session_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_attendees_user_idx` ON `session_attendees` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_attendees_pair_unq` ON `session_attendees` (`session_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `session_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`module_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_modules_pair_unq` ON `session_modules` (`session_id`,`module_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`held_on` text NOT NULL,
	`trainer_user_id` text NOT NULL,
	`location` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trainer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_held_on_idx` ON `sessions` (`held_on`);--> statement-breakpoint
CREATE INDEX `sessions_trainer_idx` ON `sessions` (`trainer_user_id`);--> statement-breakpoint
CREATE TABLE `site_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);