CREATE TABLE `salon_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`source_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salon_auth_challenges_token_hash_unique` ON `salon_auth_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `salon_auth_challenges_email_time_idx` ON `salon_auth_challenges` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `salon_auth_challenges_source_time_idx` ON `salon_auth_challenges` (`source_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `salon_auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salon_auth_sessions_token_hash_unique` ON `salon_auth_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `salon_auth_sessions_email_idx` ON `salon_auth_sessions` (`email`,`expires_at`);