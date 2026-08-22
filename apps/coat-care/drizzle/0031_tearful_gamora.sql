CREATE TABLE `external_entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text,
	`provider` text NOT NULL,
	`entity_type` text NOT NULL,
	`local_entity_id` text NOT NULL,
	`external_entity_id` text NOT NULL,
	`external_version` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`last_synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_entity_provider_external_unique` ON `external_entity_links` (`organization_id`,`provider`,`entity_type`,`external_entity_id`);--> statement-breakpoint
CREATE INDEX `external_entity_provider_local_idx` ON `external_entity_links` (`organization_id`,`provider`,`entity_type`,`local_entity_id`);--> statement-breakpoint
CREATE TABLE `integration_sync_states` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_started_at` text,
	`last_synced_at` text,
	`error` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_sync_provider_location_unique` ON `integration_sync_states` (`provider`,`location_id`);--> statement-breakpoint
CREATE INDEX `integration_sync_org_status_idx` ON `integration_sync_states` (`organization_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `pet_care_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`size_label` text DEFAULT '' NOT NULL,
	`health_notes` text DEFAULT '' NOT NULL,
	`behavior_notes` text DEFAULT '' NOT NULL,
	`sterilized` text DEFAULT 'unknown' NOT NULL,
	`treats_allowed` integer,
	`marketing_photos_allowed` integer,
	`source` text DEFAULT 'staff' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pet_care_profiles_pet_unique` ON `pet_care_profiles` (`pet_id`);--> statement-breakpoint
CREATE INDEX `pet_care_profiles_org_idx` ON `pet_care_profiles` (`organization_id`);--> statement-breakpoint
CREATE TABLE `public_intake_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`client_id` text,
	`pet_id` text,
	`submission_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`contact_hash` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_intake_submission_key_unique` ON `public_intake_submissions` (`organization_id`,`submission_key`);--> statement-breakpoint
CREATE INDEX `public_intake_source_time_idx` ON `public_intake_submissions` (`organization_id`,`source_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `public_intake_contact_time_idx` ON `public_intake_submissions` (`organization_id`,`contact_hash`,`created_at`);--> statement-breakpoint
DROP INDEX `clients_org_email_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `clients_org_email_unique` ON `clients` (`organization_id`,`email`) WHERE "clients"."email" <> '';