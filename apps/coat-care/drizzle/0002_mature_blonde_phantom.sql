CREATE TABLE `invoice_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_line_items_invoice_idx` ON `invoice_line_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`discount_reason` text DEFAULT '' NOT NULL,
	`tax_label` text DEFAULT 'Tax' NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`tip_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`amount_paid_cents` integer DEFAULT 0 NOT NULL,
	`amount_refunded_cents` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_appointment_unique` ON `invoices` (`appointment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_org_number_unique` ON `invoices` (`organization_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_location_created_idx` ON `invoices` (`location_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'succeeded' NOT NULL,
	`external_reference` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`parent_payment_id` text,
	`actor_staff_id` text,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_events_invoice_idx` ON `payment_events` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payment_events_location_occurred_idx` ON `payment_events` (`location_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_org_idempotency_unique` ON `payment_events` (`organization_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `locations` ADD `tax_label` text DEFAULT 'Tax' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;