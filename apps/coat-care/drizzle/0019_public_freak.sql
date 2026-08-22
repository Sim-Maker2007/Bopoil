ALTER TABLE `expenses` ADD `idempotency_key` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_org_idempotency_unique` ON `expenses` (`organization_id`,`idempotency_key`);