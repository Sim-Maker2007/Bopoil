CREATE TABLE `appointment_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`resource_key` text NOT NULL,
	`segment_start` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_reservations_resource_segment_unique` ON `appointment_reservations` (`location_id`,`kind`,`resource_key`,`segment_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_reservations_appointment_segment_unique` ON `appointment_reservations` (`appointment_id`,`kind`,`segment_start`);--> statement-breakpoint
CREATE INDEX `appointment_reservations_location_segment_idx` ON `appointment_reservations` (`location_id`,`segment_start`);--> statement-breakpoint
ALTER TABLE `services` ADD `bath_minutes` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `dryer_minutes` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `grooming_table_minutes` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `kennel_minutes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `services` SET `bath_minutes` = 30, `dryer_minutes` = 30, `grooming_table_minutes` = 75, `kennel_minutes` = 0 WHERE `id` = 'svc_signature';
--> statement-breakpoint
UPDATE `services` SET `bath_minutes` = 30, `dryer_minutes` = 30, `grooming_table_minutes` = 15, `kennel_minutes` = 0 WHERE `id` = 'svc_bath_brush';
--> statement-breakpoint
UPDATE `services` SET `bath_minutes` = 20, `dryer_minutes` = 20, `grooming_table_minutes` = 20, `kennel_minutes` = 0 WHERE `id` = 'svc_puppy';
