CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`preferred_supplier_id` text,
	`name` text NOT NULL,
	`sku` text,
	`barcode` text,
	`category` text NOT NULL,
	`unit` text DEFAULT 'each' NOT NULL,
	`reorder_point_milli` integer DEFAULT 0 NOT NULL,
	`target_stock_milli` integer DEFAULT 0 NOT NULL,
	`preferred_order_milli` integer DEFAULT 0 NOT NULL,
	`last_purchase_unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`selling_price_cents` integer DEFAULT 0 NOT NULL,
	`taxable` integer DEFAULT true NOT NULL,
	`idempotency_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_items_location_name_idx` ON `inventory_items` (`location_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_location_sku_unique` ON `inventory_items` (`location_id`,`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_location_barcode_unique` ON `inventory_items` (`location_id`,`barcode`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_org_idempotency_unique` ON `inventory_items` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`supplier_id` text,
	`purchase_order_id` text,
	`kind` text NOT NULL,
	`quantity_delta_milli` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`total_cost_cents` integer NOT NULL,
	`lot_number` text DEFAULT '' NOT NULL,
	`expires_on` text,
	`note` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`entered_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_movements_item_time_idx` ON `inventory_movements` (`inventory_item_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `inventory_movements_location_time_idx` ON `inventory_movements` (`location_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_movements_org_idempotency_unique` ON `inventory_movements` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`lot_number` text DEFAULT '' NOT NULL,
	`expires_on` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_lines_order_item_unique` ON `purchase_order_lines` (`purchase_order_id`,`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `purchase_order_lines_item_idx` ON `purchase_order_lines` (`inventory_item_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`order_number` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ordered_on` text,
	`expected_on` text,
	`received_at` text,
	`shipping_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by_staff_id` text,
	`updated_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_location_number_unique` ON `purchase_orders` (`location_id`,`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_org_idempotency_unique` ON `purchase_orders` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `purchase_orders_location_status_idx` ON `purchase_orders` (`location_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`account_number` text DEFAULT '' NOT NULL,
	`payment_terms_days` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `suppliers_location_name_idx` ON `suppliers` (`location_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_org_idempotency_unique` ON `suppliers` (`organization_id`,`idempotency_key`);