CREATE TABLE `appointment_care_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`coat_condition` text DEFAULT 'not_assessed' NOT NULL,
	`style_notes` text DEFAULT '' NOT NULL,
	`products_used` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`client_report` text DEFAULT '' NOT NULL,
	`report_published` integer DEFAULT false NOT NULL,
	`completed_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_care_record_unique` ON `appointment_care_records` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `appointment_care_records_org_idx` ON `appointment_care_records` (`organization_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`client_id` text NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`requested_by_staff_id` text,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	`response_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_token_unique` ON `approval_requests` (`token`);--> statement-breakpoint
CREATE INDEX `approval_requests_appointment_idx` ON `approval_requests` (`appointment_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_org_status_idx` ON `approval_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`uploaded_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_r2_key_unique` ON `media_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `media_assets_appointment_idx` ON `media_assets` (`appointment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_assets_pet_idx` ON `media_assets` (`pet_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pet_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`details` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`expires_at` text,
	`author_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pet_warnings_pet_active_idx` ON `pet_warnings` (`pet_id`,`active`);--> statement-breakpoint
CREATE INDEX `pet_warnings_org_idx` ON `pet_warnings` (`organization_id`);