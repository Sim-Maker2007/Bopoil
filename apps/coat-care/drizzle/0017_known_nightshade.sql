CREATE TABLE `delivery_provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`event_type` text NOT NULL,
	`message_id` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_provider_events_provider_event_unique` ON `delivery_provider_events` (`provider`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `delivery_provider_events_message_idx` ON `delivery_provider_events` (`message_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `delivery_provider_events_status_idx` ON `delivery_provider_events` (`status`,`received_at`);--> statement-breakpoint
ALTER TABLE `clients` ADD `email_deliverability` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `sms_deliverability` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `email_deliverability_at` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `sms_deliverability_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `delivered_at` text;