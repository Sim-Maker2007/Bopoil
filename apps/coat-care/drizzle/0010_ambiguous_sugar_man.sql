CREATE TABLE `appointment_change_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`expected_updated_at` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_change_claims_version_unique` ON `appointment_change_claims` (`appointment_id`,`expected_updated_at`);