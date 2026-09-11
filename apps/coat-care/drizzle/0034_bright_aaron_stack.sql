CREATE TABLE `client_media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`client_id` text NOT NULL,
	`kind` text DEFAULT 'gallery' NOT NULL,
	`r2_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`client_visible` integer DEFAULT true NOT NULL,
	`uploaded_by_staff_id` text,
	`uploaded_by_client` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_media_assets_r2_key_unique` ON `client_media_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `client_media_assets_client_idx` ON `client_media_assets` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_media_assets_org_idx` ON `client_media_assets` (`organization_id`,`created_at`);