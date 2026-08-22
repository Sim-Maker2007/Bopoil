CREATE TABLE `communication_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`category` text DEFAULT 'transactional' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_templates_org_key_unique` ON `communication_templates` (`organization_id`,`key`);--> statement-breakpoint
CREATE INDEX `communication_templates_location_idx` ON `communication_templates` (`location_id`);--> statement-breakpoint
CREATE TABLE `message_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`message_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_events_message_idx` ON `message_events` (`message_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`client_id` text NOT NULL,
	`appointment_id` text,
	`template_id` text,
	`dedupe_key` text NOT NULL,
	`direction` text DEFAULT 'outbound' NOT NULL,
	`channel` text NOT NULL,
	`category` text DEFAULT 'transactional' NOT NULL,
	`status` text DEFAULT 'action_required' NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_address` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`provider` text DEFAULT 'unconnected' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`scheduled_for` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	`created_by_staff_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `communication_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_org_dedupe_unique` ON `messages` (`organization_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `messages_location_scheduled_idx` ON `messages` (`location_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `messages_client_created_idx` ON `messages` (`client_id`,`created_at`);