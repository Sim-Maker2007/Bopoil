ALTER TABLE `appointments` ADD `deposit_status` text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `deposit_due_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `deposit_paid_at` text;--> statement-breakpoint
ALTER TABLE `salon_settings` ADD `require_online_deposit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `salon_settings` ADD `deposit_hold_minutes` integer DEFAULT 30 NOT NULL;