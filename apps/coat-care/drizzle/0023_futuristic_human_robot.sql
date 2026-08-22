CREATE TABLE `compensation_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`worker_class` text DEFAULT 'employee' NOT NULL,
	`pay_type` text DEFAULT 'hourly' NOT NULL,
	`hourly_rate_cents` integer DEFAULT 0 NOT NULL,
	`annual_salary_cents` integer DEFAULT 0 NOT NULL,
	`overtime_eligible` integer DEFAULT true NOT NULL,
	`weekly_overtime_minutes` integer DEFAULT 2400 NOT NULL,
	`overtime_multiplier_bps` integer DEFAULT 15000 NOT NULL,
	`service_commission_bps` integer DEFAULT 0 NOT NULL,
	`retail_commission_bps` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`effective_from` text NOT NULL,
	`created_by_staff_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compensation_staff_effective_unique` ON `compensation_profiles` (`location_id`,`staff_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `compensation_location_staff_idx` ON `compensation_profiles` (`location_id`,`staff_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `payroll_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`payroll_period_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`staff_name` text NOT NULL,
	`regular_minutes` integer DEFAULT 0 NOT NULL,
	`overtime_minutes` integer DEFAULT 0 NOT NULL,
	`regular_pay_cents` integer DEFAULT 0 NOT NULL,
	`overtime_pay_cents` integer DEFAULT 0 NOT NULL,
	`service_commission_cents` integer DEFAULT 0 NOT NULL,
	`retail_commission_cents` integer DEFAULT 0 NOT NULL,
	`tips_cents` integer DEFAULT 0 NOT NULL,
	`other_earnings_cents` integer DEFAULT 0 NOT NULL,
	`deductions_cents` integer DEFAULT 0 NOT NULL,
	`reimbursements_cents` integer DEFAULT 0 NOT NULL,
	`gross_pay_cents` integer DEFAULT 0 NOT NULL,
	`payout_cents` integer DEFAULT 0 NOT NULL,
	`compensation_snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payroll_period_id`) REFERENCES `payroll_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_line_period_staff_unique` ON `payroll_lines` (`payroll_period_id`,`staff_id`);--> statement-breakpoint
CREATE TABLE `payroll_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`pay_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`approved_by_staff_id` text,
	`approved_at` text,
	`exported_at` text,
	`created_by_staff_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_period_location_dates_unique` ON `payroll_periods` (`location_id`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_period_org_idempotency_unique` ON `payroll_periods` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `staff_clock_states` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`status` text DEFAULT 'clocked_out' NOT NULL,
	`open_entry_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`open_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_clock_state_unique` ON `staff_clock_states` (`location_id`,`staff_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`clock_in` text NOT NULL,
	`clock_out` text,
	`break_minutes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text DEFAULT 'clock' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`entered_by_staff_id` text NOT NULL,
	`approved_by_staff_id` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_org_idempotency_unique` ON `time_entries` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `time_entries_location_clock_idx` ON `time_entries` (`location_id`,`clock_in`);--> statement-breakpoint
CREATE TABLE `time_entry_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`time_entry_id` text NOT NULL,
	`clock_in` text NOT NULL,
	`clock_out` text NOT NULL,
	`break_minutes` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`adjusted_by_staff_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`time_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`adjusted_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_adjustments_entry_idx` ON `time_entry_adjustments` (`time_entry_id`,`created_at`);