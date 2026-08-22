CREATE TABLE `financial_account_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`account_id` text NOT NULL,
	`transaction_date` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'csv_import' NOT NULL,
	`import_hash` text NOT NULL,
	`imported_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_transactions_account_hash_unique` ON `financial_account_transactions` (`account_id`,`import_hash`);--> statement-breakpoint
CREATE INDEX `financial_transactions_account_date_idx` ON `financial_account_transactions` (`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `financial_transactions_org_date_idx` ON `financial_account_transactions` (`organization_id`,`transaction_date`);--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`account_type` text NOT NULL,
	`opening_balance_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_accounts_org_name_unique` ON `financial_accounts` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `financial_accounts_org_location_idx` ON `financial_accounts` (`organization_id`,`location_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `gst_amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `qst_amount_cents` integer DEFAULT 0 NOT NULL;