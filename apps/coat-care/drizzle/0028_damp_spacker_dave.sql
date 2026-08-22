CREATE TABLE `invoice_mutation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`expected_mutation_version` integer NOT NULL,
	`mutation_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_mutation_claims_invoice_version_unique` ON `invoice_mutation_claims` (`invoice_id`,`expected_mutation_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_mutation_claims_org_idempotency_unique` ON `invoice_mutation_claims` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `invoice_mutation_claims_invoice_idx` ON `invoice_mutation_claims` (`invoice_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `mutation_version` integer DEFAULT 0 NOT NULL;