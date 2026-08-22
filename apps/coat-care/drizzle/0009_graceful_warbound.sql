CREATE TABLE `client_portal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_portal_sessions_token_hash_unique` ON `client_portal_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `client_portal_sessions_client_idx` ON `client_portal_sessions` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `portal_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email_hash` text NOT NULL,
	`source_hash` text DEFAULT '' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portal_access_requests_email_time_idx` ON `portal_access_requests` (`email_hash`,`requested_at`);--> statement-breakpoint
CREATE TABLE `vaccination_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`vaccine_name` text NOT NULL,
	`administered_on` text DEFAULT '' NOT NULL,
	`expires_on` text NOT NULL,
	`veterinarian` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'client_submitted' NOT NULL,
	`r2_key` text,
	`original_filename` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT '' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`verified_by_staff_id` text,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaccination_records_r2_key_unique` ON `vaccination_records` (`r2_key`);--> statement-breakpoint
CREATE INDEX `vaccination_records_pet_expiry_idx` ON `vaccination_records` (`pet_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `vaccination_records_org_status_idx` ON `vaccination_records` (`organization_id`,`status`);--> statement-breakpoint
ALTER TABLE `pets` ADD `date_of_birth` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pets` ADD `sex` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `pets` ADD `color` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pets` ADD `client_notes` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `communication_templates` SET `body` = 'Hi {{client_name}},

We received your request for {{pet_name}}’s {{service_name}} on {{appointment_date}} at {{appointment_time}}. Our team will review it and confirm shortly.

Manage pets and appointments: {{portal_url}}

— Coat & Care' WHERE `key` = 'booking_request_received';
--> statement-breakpoint
UPDATE `communication_templates` SET `body` = 'Hi {{client_name}},

{{pet_name}} is confirmed for {{service_name}} on {{appointment_date}} at {{appointment_time}}.

Manage pets and appointments: {{portal_url}}

We can’t wait to welcome you both.

— Coat & Care' WHERE `key` = 'booking_confirmation';
