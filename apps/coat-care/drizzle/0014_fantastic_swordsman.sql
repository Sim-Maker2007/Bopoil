CREATE TABLE `online_payment_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`client_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`invoice_id` text,
	`purpose` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`provider_payment_intent_id` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`application_fee_cents` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`checkout_url` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `online_payment_sessions_provider_session_id_unique` ON `online_payment_sessions` (`provider_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `online_payment_sessions_org_idempotency_unique` ON `online_payment_sessions` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `online_payment_sessions_appointment_idx` ON `online_payment_sessions` (`appointment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `online_payment_sessions_invoice_idx` ON `online_payment_sessions` (`invoice_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_customer_id` text DEFAULT '' NOT NULL,
	`provider_subscription_id` text DEFAULT '' NOT NULL,
	`provider_price_id` text DEFAULT '' NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`trial_ends_at` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_subscriptions_org_unique` ON `organization_subscriptions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `payment_provider_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`connected_account_id` text NOT NULL,
	`country` text NOT NULL,
	`default_currency` text NOT NULL,
	`details_submitted` integer DEFAULT false NOT NULL,
	`charges_enabled` integer DEFAULT false NOT NULL,
	`payouts_enabled` integer DEFAULT false NOT NULL,
	`onboarding_status` text DEFAULT 'pending' NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_accounts_connected_account_id_unique` ON `payment_provider_accounts` (`connected_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_accounts_org_unique` ON `payment_provider_accounts` (`organization_id`);--> statement-breakpoint
CREATE TABLE `provider_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`event_type` text NOT NULL,
	`livemode` integer DEFAULT false NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_webhook_events_status_idx` ON `provider_webhook_events` (`status`,`created_at`);