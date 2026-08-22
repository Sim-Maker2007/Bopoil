CREATE TABLE `daily_closeouts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`business_date` text NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`net_collected_cents` integer NOT NULL,
	`expected_cash_cents` integer NOT NULL,
	`counted_cash_cents` integer NOT NULL,
	`cash_variance_cents` integer NOT NULL,
	`sales_tax_cents` integer NOT NULL,
	`tips_cents` integer NOT NULL,
	`refunds_cents` integer NOT NULL,
	`transaction_count` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`closed_by_staff_id` text NOT NULL,
	`closed_at` text NOT NULL,
	`reopened_by_staff_id` text,
	`reopened_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closeouts_location_date_unique` ON `daily_closeouts` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `daily_closeouts_org_date_idx` ON `daily_closeouts` (`organization_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `expense_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_receipts_r2_key_unique` ON `expense_receipts` (`r2_key`);--> statement-breakpoint
CREATE INDEX `expense_receipts_expense_idx` ON `expense_receipts` (`expense_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`vendor` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`treatment` text DEFAULT 'operating' NOT NULL,
	`payment_method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`tax_amount_cents` integer DEFAULT 0 NOT NULL,
	`recoverable_tax` integer DEFAULT false NOT NULL,
	`business_use_bps` integer DEFAULT 10000 NOT NULL,
	`currency` text NOT NULL,
	`incurred_on` text NOT NULL,
	`paid_on` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`void_reason` text DEFAULT '' NOT NULL,
	`entered_by_staff_id` text,
	`voided_by_staff_id` text,
	`voided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_location_paid_idx` ON `expenses` (`location_id`,`paid_on`);--> statement-breakpoint
CREATE INDEX `expenses_org_category_idx` ON `expenses` (`organization_id`,`category`,`paid_on`);