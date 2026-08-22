CREATE TABLE `location_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`opens_at` text DEFAULT '09:00' NOT NULL,
	`closes_at` text DEFAULT '18:00' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_hours_day_unique` ON `location_hours` (`location_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `location_hours_org_idx` ON `location_hours` (`organization_id`);--> statement-breakpoint
CREATE TABLE `salon_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`booking_mode` text DEFAULT 'automatic' NOT NULL,
	`cancellation_hours` integer DEFAULT 24 NOT NULL,
	`minimum_lead_minutes` integer DEFAULT 120 NOT NULL,
	`booking_window_days` integer DEFAULT 120 NOT NULL,
	`max_concurrent_pets` integer DEFAULT 4 NOT NULL,
	`bath_stations` integer DEFAULT 2 NOT NULL,
	`grooming_tables` integer DEFAULT 3 NOT NULL,
	`dryers` integer DEFAULT 2 NOT NULL,
	`kennels` integer DEFAULT 6 NOT NULL,
	`allow_online_booking` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salon_settings_location_unique` ON `salon_settings` (`location_id`);--> statement-breakpoint
CREATE TABLE `staff_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by_staff_id` text,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_invitations_token_unique` ON `staff_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `staff_invitations_org_email_idx` ON `staff_invitations` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `staff_invitations_location_status_idx` ON `staff_invitations` (`location_id`,`status`);--> statement-breakpoint
CREATE TABLE `staff_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`location_id` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_locations_staff_location_unique` ON `staff_locations` (`staff_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `staff_locations_org_location_idx` ON `staff_locations` (`organization_id`,`location_id`);--> statement-breakpoint
DROP INDEX `communication_templates_org_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `communication_templates_location_key_unique` ON `communication_templates` (`location_id`,`key`);--> statement-breakpoint
DROP INDEX `staff_availability_day_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `staff_availability_day_unique` ON `staff_availability` (`staff_id`,`location_id`,`weekday`);--> statement-breakpoint
ALTER TABLE `locations` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `contact_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `currency` text DEFAULT 'CAD' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `timezone` text DEFAULT 'America/Toronto' NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `contact_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `onboarding_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;