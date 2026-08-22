CREATE TABLE `inventory_movement_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`expected_stock_version` integer NOT NULL,
	`movement_group_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movement_claims_item_version_unique` ON `inventory_movement_claims` (`inventory_item_id`,`expected_stock_version`);--> statement-breakpoint
CREATE INDEX `inventory_movement_claims_org_group_idx` ON `inventory_movement_claims` (`organization_id`,`movement_group_id`);--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `stock_version` integer DEFAULT 0 NOT NULL;