CREATE TABLE `employee_portal_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`employee_code` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_portal_staff_unique` ON `employee_portal_credentials` (`staff_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `employee_portal_code_unique` ON `employee_portal_credentials` (`employee_code`);--> statement-breakpoint
CREATE TABLE `employee_portal_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`revoked_at` text,
	`invited_by_staff_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_portal_invite_token_unique` ON `employee_portal_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `employee_portal_invite_staff_idx` ON `employee_portal_invitations` (`staff_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `employee_portal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_portal_session_token_unique` ON `employee_portal_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `employee_portal_session_staff_idx` ON `employee_portal_sessions` (`staff_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `timesheet_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`week_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`work_date` text NOT NULL,
	`location_name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`tips_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`week_id`) REFERENCES `timesheet_weeks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `timesheet_shift_week_date_idx` ON `timesheet_shifts` (`week_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `timesheet_shift_org_staff_idx` ON `timesheet_shifts` (`organization_id`,`staff_id`);--> statement-breakpoint
CREATE TABLE `timesheet_weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`week_starts_on` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timesheet_week_staff_start_unique` ON `timesheet_weeks` (`staff_id`,`week_starts_on`);--> statement-breakpoint
CREATE INDEX `timesheet_week_org_start_idx` ON `timesheet_weeks` (`organization_id`,`week_starts_on`);