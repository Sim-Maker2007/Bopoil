ALTER TABLE `payroll_periods` ADD `input_snapshot_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_periods` ADD `input_snapshot_hash` text DEFAULT '' NOT NULL;