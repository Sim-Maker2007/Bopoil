CREATE TABLE `purchase_order_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`expected_updated_at` text NOT NULL,
	`action` text NOT NULL,
	`actor_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_claims_order_version_unique` ON `purchase_order_claims` (`purchase_order_id`,`expected_updated_at`);--> statement-breakpoint
CREATE INDEX `purchase_order_claims_org_order_idx` ON `purchase_order_claims` (`organization_id`,`purchase_order_id`);