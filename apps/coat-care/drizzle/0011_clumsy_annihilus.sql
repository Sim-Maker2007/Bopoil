CREATE TABLE `waitlist_conversion_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`waitlist_entry_id` text NOT NULL,
	`expected_updated_at` text NOT NULL,
	`appointment_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waitlist_entry_id`) REFERENCES `waitlist_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_conversion_entry_unique` ON `waitlist_conversion_claims` (`waitlist_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_conversion_appointment_unique` ON `waitlist_conversion_claims` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`client_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`service_id` text NOT NULL,
	`preferred_from` text NOT NULL,
	`preferred_to` text NOT NULL,
	`time_preference` text DEFAULT 'anytime' NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`source_hash` text DEFAULT '' NOT NULL,
	`client_notes` text DEFAULT '' NOT NULL,
	`staff_notes` text DEFAULT '' NOT NULL,
	`contacted_at` text,
	`converted_appointment_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `waitlist_location_status_idx` ON `waitlist_entries` (`location_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_client_idx` ON `waitlist_entries` (`client_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_open_preference_unique` ON `waitlist_entries` (`location_id`,`pet_id`,`service_id`,`preferred_from`,`status`);