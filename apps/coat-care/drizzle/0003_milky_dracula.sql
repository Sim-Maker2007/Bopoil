ALTER TABLE `payment_events` ADD `tax_amount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_events` ADD `tip_amount_cents` integer DEFAULT 0 NOT NULL;