CREATE TABLE `client_phone_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`verified_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_phone_identities_active_phone_unique` ON `client_phone_identities` (`organization_id`,`phone_e164`) WHERE "client_phone_identities"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `client_phone_identities_client_idx` ON `client_phone_identities` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_phone_otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`phone_e164` text NOT NULL,
	`destination_hash` text NOT NULL,
	`source_hash` text NOT NULL,
	`challenge_token_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`provider_message_id` text,
	`enrollment_client_id` text,
	`enrollment_session_id` text,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`proof_expires_at` text,
	`proof_consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_session_id`) REFERENCES `client_portal_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_phone_otp_challenges_challenge_token_hash_unique` ON `client_phone_otp_challenges` (`challenge_token_hash`);--> statement-breakpoint
CREATE INDEX `client_phone_otp_destination_time_idx` ON `client_phone_otp_challenges` (`organization_id`,`destination_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_phone_otp_source_time_idx` ON `client_phone_otp_challenges` (`organization_id`,`source_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_phone_otp_expiry_idx` ON `client_phone_otp_challenges` (`organization_id`,`expires_at`);--> statement-breakpoint
UPDATE `communication_templates`
SET `body` = replace(
	`body`,
	'This link expires in 30 days.',
	'This link expires in 15 minutes. After you open it, this browser stays trusted for 30 days.'
)
WHERE `key` = 'portal_access'
	AND instr(`body`, 'This link expires in 30 days.') > 0;
