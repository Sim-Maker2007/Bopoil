CREATE TABLE "appointment_care_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"coat_condition" text DEFAULT 'not_assessed' NOT NULL,
	"style_notes" text DEFAULT '' NOT NULL,
	"products_used" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"client_report" text DEFAULT '' NOT NULL,
	"report_published" boolean DEFAULT false NOT NULL,
	"completed_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_change_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"expected_updated_at" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_key" text NOT NULL,
	"segment_start" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"service_id" text NOT NULL,
	"staff_id" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"price_estimate_cents" integer NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"deposit_status" text DEFAULT 'not_required' NOT NULL,
	"deposit_due_at" text,
	"deposit_paid_at" text,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"client_notes" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"client_id" text NOT NULL,
	"token" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" text NOT NULL,
	"requested_by_staff_id" text,
	"requested_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"responded_at" text,
	"response_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "approval_requests_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_phone_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"phone_e164" text NOT NULL,
	"verified_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_phone_otp_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone_e164" text NOT NULL,
	"destination_hash" text NOT NULL,
	"source_hash" text NOT NULL,
	"challenge_token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"enrollment_client_id" text,
	"enrollment_session_id" text,
	"expires_at" text NOT NULL,
	"verified_at" text,
	"proof_expires_at" text,
	"proof_consumed_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "client_phone_otp_challenges_challenge_token_hash_unique" UNIQUE("challenge_token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "client_portal_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"email_deliverability" text DEFAULT 'unknown' NOT NULL,
	"sms_deliverability" text DEFAULT 'unknown' NOT NULL,
	"email_deliverability_at" text,
	"sms_deliverability_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"category" text DEFAULT 'transactional' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compensation_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"worker_class" text DEFAULT 'employee' NOT NULL,
	"pay_type" text DEFAULT 'hourly' NOT NULL,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"annual_salary_cents" integer DEFAULT 0 NOT NULL,
	"overtime_eligible" boolean DEFAULT true NOT NULL,
	"weekly_overtime_minutes" integer DEFAULT 2400 NOT NULL,
	"overtime_multiplier_bps" integer DEFAULT 15000 NOT NULL,
	"service_commission_bps" integer DEFAULT 0 NOT NULL,
	"retail_commission_bps" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"effective_from" text NOT NULL,
	"created_by_staff_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"appointment_id" text,
	"type" text NOT NULL,
	"policy_version" text NOT NULL,
	"accepted" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_closeouts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"business_date" text NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"net_collected_cents" integer NOT NULL,
	"expected_cash_cents" integer NOT NULL,
	"counted_cash_cents" integer NOT NULL,
	"cash_variance_cents" integer NOT NULL,
	"sales_tax_cents" integer NOT NULL,
	"tips_cents" integer NOT NULL,
	"refunds_cents" integer NOT NULL,
	"transaction_count" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"closed_by_staff_id" text NOT NULL,
	"closed_at" text NOT NULL,
	"reopened_by_staff_id" text,
	"reopened_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"event_type" text NOT NULL,
	"message_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"received_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"processed_at" text
);
--> statement-breakpoint
CREATE TABLE "employee_portal_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"employee_code" text NOT NULL,
	"pin_salt" text NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_portal_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"revoked_at" text,
	"invited_by_staff_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"expense_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "expense_receipts_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"vendor" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"treatment" text DEFAULT 'operating' NOT NULL,
	"payment_method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tax_amount_cents" integer DEFAULT 0 NOT NULL,
	"gst_amount_cents" integer DEFAULT 0 NOT NULL,
	"qst_amount_cents" integer DEFAULT 0 NOT NULL,
	"recoverable_tax" boolean DEFAULT false NOT NULL,
	"business_use_bps" integer DEFAULT 10000 NOT NULL,
	"currency" text NOT NULL,
	"incurred_on" text NOT NULL,
	"paid_on" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"entered_by_staff_id" text,
	"voided_by_staff_id" text,
	"voided_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_entity_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"local_entity_id" text NOT NULL,
	"external_entity_id" text NOT NULL,
	"external_version" text DEFAULT '' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"last_synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_account_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"account_id" text NOT NULL,
	"transaction_date" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'csv_import' NOT NULL,
	"import_hash" text NOT NULL,
	"imported_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"account_type" text NOT NULL,
	"opening_balance_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_states" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_started_at" text,
	"last_synced_at" text,
	"error" text DEFAULT '' NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"preferred_supplier_id" text,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"category" text NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"reorder_point_milli" integer DEFAULT 0 NOT NULL,
	"target_stock_milli" integer DEFAULT 0 NOT NULL,
	"preferred_order_milli" integer DEFAULT 0 NOT NULL,
	"last_purchase_unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"selling_price_cents" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"idempotency_key" text NOT NULL,
	"stock_version" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movement_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"expected_stock_version" integer NOT NULL,
	"movement_group_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"supplier_id" text,
	"purchase_order_id" text,
	"kind" text NOT NULL,
	"quantity_delta_milli" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"lot_number" text DEFAULT '' NOT NULL,
	"expires_on" text,
	"note" text DEFAULT '' NOT NULL,
	"occurred_at" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"entered_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_mutation_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"expected_mutation_version" integer NOT NULL,
	"mutation_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"discount_reason" text DEFAULT '' NOT NULL,
	"tax_label" text DEFAULT 'Tax' NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"amount_refunded_cents" integer DEFAULT 0 NOT NULL,
	"mutation_version" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"paid_at" text
);
--> statement-breakpoint
CREATE TABLE "location_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"opens_at" text DEFAULT '09:00' NOT NULL,
	"closes_at" text DEFAULT '18:00' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"city" text NOT NULL,
	"region" text NOT NULL,
	"postal_code" text NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"tax_label" text DEFAULT 'Tax' NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"kind" text NOT NULL,
	"r2_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"uploaded_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "media_assets_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "message_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"message_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"details_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text NOT NULL,
	"appointment_id" text,
	"template_id" text,
	"dedupe_key" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"channel" text NOT NULL,
	"category" text DEFAULT 'transactional' NOT NULL,
	"status" text DEFAULT 'action_required' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"provider" text DEFAULT 'unconnected' NOT NULL,
	"provider_message_id" text DEFAULT '' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"processing_started_at" text,
	"last_error" text DEFAULT '' NOT NULL,
	"scheduled_for" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"sent_at" text,
	"delivered_at" text,
	"created_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_payment_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"invoice_id" text,
	"purpose" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"provider_payment_intent_id" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"checkout_url" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" text NOT NULL,
	"completed_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "online_payment_sessions_provider_session_id_unique" UNIQUE("provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_customer_id" text DEFAULT '' NOT NULL,
	"provider_subscription_id" text DEFAULT '' NOT NULL,
	"provider_price_id" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" text,
	"current_period_end" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'CA' NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tax_amount_cents" integer DEFAULT 0 NOT NULL,
	"tip_amount_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"external_reference" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"parent_payment_id" text,
	"actor_staff_id" text,
	"occurred_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"connected_account_id" text NOT NULL,
	"country" text NOT NULL,
	"default_currency" text NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"last_synced_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "payment_provider_accounts_connected_account_id_unique" UNIQUE("connected_account_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"payroll_period_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"staff_name" text NOT NULL,
	"regular_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"regular_pay_cents" integer DEFAULT 0 NOT NULL,
	"overtime_pay_cents" integer DEFAULT 0 NOT NULL,
	"service_commission_cents" integer DEFAULT 0 NOT NULL,
	"retail_commission_cents" integer DEFAULT 0 NOT NULL,
	"tips_cents" integer DEFAULT 0 NOT NULL,
	"other_earnings_cents" integer DEFAULT 0 NOT NULL,
	"deductions_cents" integer DEFAULT 0 NOT NULL,
	"reimbursements_cents" integer DEFAULT 0 NOT NULL,
	"gross_pay_cents" integer DEFAULT 0 NOT NULL,
	"payout_cents" integer DEFAULT 0 NOT NULL,
	"compensation_snapshot_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text NOT NULL,
	"pay_date" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_snapshot_json" text DEFAULT '{}' NOT NULL,
	"input_snapshot_hash" text DEFAULT '' NOT NULL,
	"approved_by_staff_id" text,
	"approved_at" text,
	"exported_at" text,
	"created_by_staff_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pet_care_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"health_notes" text DEFAULT '' NOT NULL,
	"behavior_notes" text DEFAULT '' NOT NULL,
	"sterilized" text DEFAULT 'unknown' NOT NULL,
	"treats_allowed" boolean,
	"marketing_photos_allowed" boolean,
	"source" text DEFAULT 'staff' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pet_warnings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"details" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" text,
	"author_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"species" text DEFAULT 'dog' NOT NULL,
	"breed" text DEFAULT 'Unknown' NOT NULL,
	"weight_kg" integer,
	"date_of_birth" text DEFAULT '' NOT NULL,
	"sex" text DEFAULT 'unknown' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"client_notes" text DEFAULT '' NOT NULL,
	"handling_notes" text DEFAULT '' NOT NULL,
	"safety_level" text DEFAULT 'standard' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email_hash" text NOT NULL,
	"source_hash" text DEFAULT '' NOT NULL,
	"requested_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"event_type" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"processed_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_intake_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text,
	"pet_id" text,
	"submission_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"contact_hash" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"expected_updated_at" text NOT NULL,
	"action" text NOT NULL,
	"actor_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"lot_number" text DEFAULT '' NOT NULL,
	"expires_on" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"order_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ordered_on" text,
	"expected_on" text,
	"received_at" text,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_staff_id" text,
	"updated_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salon_auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"source_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "salon_auth_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "salon_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "salon_auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "salon_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"booking_mode" text DEFAULT 'automatic' NOT NULL,
	"cancellation_hours" integer DEFAULT 24 NOT NULL,
	"minimum_lead_minutes" integer DEFAULT 120 NOT NULL,
	"booking_window_days" integer DEFAULT 120 NOT NULL,
	"max_concurrent_pets" integer DEFAULT 4 NOT NULL,
	"bath_stations" integer DEFAULT 2 NOT NULL,
	"grooming_tables" integer DEFAULT 3 NOT NULL,
	"dryers" integer DEFAULT 2 NOT NULL,
	"kennels" integer DEFAULT 6 NOT NULL,
	"allow_online_booking" boolean DEFAULT true NOT NULL,
	"require_online_deposit" boolean DEFAULT false NOT NULL,
	"deposit_hold_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 15 NOT NULL,
	"price_from_cents" integer NOT NULL,
	"deposit_cents" integer DEFAULT 2500 NOT NULL,
	"bath_minutes" integer DEFAULT 30 NOT NULL,
	"dryer_minutes" integer DEFAULT 30 NOT NULL,
	"grooming_table_minutes" integer DEFAULT 30 NOT NULL,
	"kennel_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text DEFAULT '09:00' NOT NULL,
	"end_time" text DEFAULT '17:00' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_clock_states" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"status" text DEFAULT 'clocked_out' NOT NULL,
	"open_entry_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_staff_id" text,
	"expires_at" text NOT NULL,
	"accepted_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "staff_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"location_id" text NOT NULL,
	"role" text NOT NULL,
	"permissions_json" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_service_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_clock_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"expected_version" integer NOT NULL,
	"action" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"clock_in" text NOT NULL,
	"clock_out" text,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'clock' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"idempotency_key" text NOT NULL,
	"entered_by_staff_id" text NOT NULL,
	"approved_by_staff_id" text,
	"approved_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entry_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"clock_in" text NOT NULL,
	"clock_out" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by_staff_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"week_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"work_date" text NOT NULL,
	"location_id" text,
	"location_name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"tips_cents" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_weeks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"week_starts_on" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_by_staff_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaccination_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"vaccine_name" text NOT NULL,
	"administered_on" text DEFAULT '' NOT NULL,
	"expires_on" text NOT NULL,
	"veterinarian" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'client_submitted' NOT NULL,
	"r2_key" text,
	"original_filename" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"verified_by_staff_id" text,
	"verified_at" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "vaccination_records_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "waitlist_conversion_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"waitlist_entry_id" text NOT NULL,
	"expected_updated_at" text NOT NULL,
	"appointment_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text NOT NULL,
	"pet_id" text NOT NULL,
	"service_id" text NOT NULL,
	"preferred_from" text NOT NULL,
	"preferred_to" text NOT NULL,
	"time_preference" text DEFAULT 'anytime' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"source_hash" text DEFAULT '' NOT NULL,
	"client_notes" text DEFAULT '' NOT NULL,
	"staff_notes" text DEFAULT '' NOT NULL,
	"contacted_at" text,
	"converted_appointment_id" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_care_records" ADD CONSTRAINT "appointment_care_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_care_records" ADD CONSTRAINT "appointment_care_records_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_care_records" ADD CONSTRAINT "appointment_care_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_care_records" ADD CONSTRAINT "appointment_care_records_completed_by_staff_id_staff_id_fk" FOREIGN KEY ("completed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_change_claims" ADD CONSTRAINT "appointment_change_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_change_claims" ADD CONSTRAINT "appointment_change_claims_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reservations" ADD CONSTRAINT "appointment_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reservations" ADD CONSTRAINT "appointment_reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_reservations" ADD CONSTRAINT "appointment_reservations_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_staff_id_staff_id_fk" FOREIGN KEY ("requested_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phone_identities" ADD CONSTRAINT "client_phone_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phone_identities" ADD CONSTRAINT "client_phone_identities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phone_otp_challenges" ADD CONSTRAINT "client_phone_otp_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phone_otp_challenges" ADD CONSTRAINT "client_phone_otp_challenges_enrollment_client_id_clients_id_fk" FOREIGN KEY ("enrollment_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_phone_otp_challenges" ADD CONSTRAINT "client_phone_otp_challenges_enrollment_session_id_client_portal_sessions_id_fk" FOREIGN KEY ("enrollment_session_id") REFERENCES "public"."client_portal_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_profiles" ADD CONSTRAINT "compensation_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_profiles" ADD CONSTRAINT "compensation_profiles_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_profiles" ADD CONSTRAINT "compensation_profiles_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_profiles" ADD CONSTRAINT "compensation_profiles_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closeouts" ADD CONSTRAINT "daily_closeouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closeouts" ADD CONSTRAINT "daily_closeouts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closeouts" ADD CONSTRAINT "daily_closeouts_closed_by_staff_id_staff_id_fk" FOREIGN KEY ("closed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closeouts" ADD CONSTRAINT "daily_closeouts_reopened_by_staff_id_staff_id_fk" FOREIGN KEY ("reopened_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_provider_events" ADD CONSTRAINT "delivery_provider_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_credentials" ADD CONSTRAINT "employee_portal_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_credentials" ADD CONSTRAINT "employee_portal_credentials_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_invitations" ADD CONSTRAINT "employee_portal_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_invitations" ADD CONSTRAINT "employee_portal_invitations_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_invitations" ADD CONSTRAINT "employee_portal_invitations_invited_by_staff_id_staff_id_fk" FOREIGN KEY ("invited_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_sessions" ADD CONSTRAINT "employee_portal_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_portal_sessions" ADD CONSTRAINT "employee_portal_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_uploaded_by_staff_id_staff_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_entered_by_staff_id_staff_id_fk" FOREIGN KEY ("entered_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_staff_id_staff_id_fk" FOREIGN KEY ("voided_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_entity_links" ADD CONSTRAINT "external_entity_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_entity_links" ADD CONSTRAINT "external_entity_links_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_transactions" ADD CONSTRAINT "financial_account_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_transactions" ADD CONSTRAINT "financial_account_transactions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_transactions" ADD CONSTRAINT "financial_account_transactions_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_transactions" ADD CONSTRAINT "financial_account_transactions_imported_by_staff_id_staff_id_fk" FOREIGN KEY ("imported_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_states" ADD CONSTRAINT "integration_sync_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_states" ADD CONSTRAINT "integration_sync_states_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_preferred_supplier_id_suppliers_id_fk" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_claims" ADD CONSTRAINT "inventory_movement_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_claims" ADD CONSTRAINT "inventory_movement_claims_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_claims" ADD CONSTRAINT "inventory_movement_claims_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_entered_by_staff_id_staff_id_fk" FOREIGN KEY ("entered_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_mutation_claims" ADD CONSTRAINT "invoice_mutation_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_mutation_claims" ADD CONSTRAINT "invoice_mutation_claims_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_staff_id_staff_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_communication_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."communication_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment_sessions" ADD CONSTRAINT "online_payment_sessions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_accounts" ADD CONSTRAINT "payment_provider_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approved_by_staff_id_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_care_profiles" ADD CONSTRAINT "pet_care_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_care_profiles" ADD CONSTRAINT "pet_care_profiles_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_warnings" ADD CONSTRAINT "pet_warnings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_warnings" ADD CONSTRAINT "pet_warnings_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_warnings" ADD CONSTRAINT "pet_warnings_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_requests" ADD CONSTRAINT "portal_access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_intake_submissions" ADD CONSTRAINT "public_intake_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_intake_submissions" ADD CONSTRAINT "public_intake_submissions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_intake_submissions" ADD CONSTRAINT "public_intake_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_intake_submissions" ADD CONSTRAINT "public_intake_submissions_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_claims" ADD CONSTRAINT "purchase_order_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_claims" ADD CONSTRAINT "purchase_order_claims_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_claims" ADD CONSTRAINT "purchase_order_claims_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_claims" ADD CONSTRAINT "purchase_order_claims_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_updated_by_staff_id_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_settings" ADD CONSTRAINT "salon_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_settings" ADD CONSTRAINT "salon_settings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_clock_states" ADD CONSTRAINT "staff_clock_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_clock_states" ADD CONSTRAINT "staff_clock_states_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_clock_states" ADD CONSTRAINT "staff_clock_states_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_clock_states" ADD CONSTRAINT "staff_clock_states_open_entry_id_time_entries_id_fk" FOREIGN KEY ("open_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_staff_id_staff_id_fk" FOREIGN KEY ("invited_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_skills" ADD CONSTRAINT "staff_service_skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_skills" ADD CONSTRAINT "staff_service_skills_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_skills" ADD CONSTRAINT "staff_service_skills_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_skills" ADD CONSTRAINT "staff_service_skills_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_claims" ADD CONSTRAINT "time_clock_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_claims" ADD CONSTRAINT "time_clock_claims_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_claims" ADD CONSTRAINT "time_clock_claims_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_claims" ADD CONSTRAINT "time_clock_claims_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_entered_by_staff_id_staff_id_fk" FOREIGN KEY ("entered_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_staff_id_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_adjustments" ADD CONSTRAINT "time_entry_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_adjustments" ADD CONSTRAINT "time_entry_adjustments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_adjustments" ADD CONSTRAINT "time_entry_adjustments_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_adjustments" ADD CONSTRAINT "time_entry_adjustments_adjusted_by_staff_id_staff_id_fk" FOREIGN KEY ("adjusted_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_shifts" ADD CONSTRAINT "timesheet_shifts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_shifts" ADD CONSTRAINT "timesheet_shifts_week_id_timesheet_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."timesheet_weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_shifts" ADD CONSTRAINT "timesheet_shifts_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_shifts" ADD CONSTRAINT "timesheet_shifts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_updated_by_staff_id_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_verified_by_staff_id_staff_id_fk" FOREIGN KEY ("verified_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_conversion_claims" ADD CONSTRAINT "waitlist_conversion_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_conversion_claims" ADD CONSTRAINT "waitlist_conversion_claims_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_conversion_claims" ADD CONSTRAINT "waitlist_conversion_claims_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_conversion_claims" ADD CONSTRAINT "waitlist_conversion_claims_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_converted_appointment_id_appointments_id_fk" FOREIGN KEY ("converted_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_care_record_unique" ON "appointment_care_records" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_care_records_org_idx" ON "appointment_care_records" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_change_claims_version_unique" ON "appointment_change_claims" USING btree ("appointment_id","expected_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_reservations_resource_segment_unique" ON "appointment_reservations" USING btree ("location_id","kind","resource_key","segment_start");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_reservations_appointment_segment_unique" ON "appointment_reservations" USING btree ("appointment_id","kind","segment_start");--> statement-breakpoint
CREATE INDEX "appointment_reservations_location_segment_idx" ON "appointment_reservations" USING btree ("location_id","segment_start");--> statement-breakpoint
CREATE INDEX "appointments_org_start_idx" ON "appointments" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_location_start_idx" ON "appointments" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_staff_start_idx" ON "appointments" USING btree ("staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "approval_requests_appointment_idx" ON "approval_requests" USING btree ("appointment_id","requested_at");--> statement-breakpoint
CREATE INDEX "approval_requests_org_status_idx" ON "approval_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_phone_identities_active_phone_unique" ON "client_phone_identities" USING btree ("organization_id","phone_e164") WHERE "client_phone_identities"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "client_phone_identities_client_idx" ON "client_phone_identities" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "client_phone_otp_destination_time_idx" ON "client_phone_otp_challenges" USING btree ("organization_id","destination_hash","created_at");--> statement-breakpoint
CREATE INDEX "client_phone_otp_source_time_idx" ON "client_phone_otp_challenges" USING btree ("organization_id","source_hash","created_at");--> statement-breakpoint
CREATE INDEX "client_phone_otp_expiry_idx" ON "client_phone_otp_challenges" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "client_portal_sessions_client_idx" ON "client_portal_sessions" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_email_unique" ON "clients" USING btree ("organization_id","email") WHERE "clients"."email" <> '';--> statement-breakpoint
CREATE INDEX "clients_org_phone_idx" ON "clients" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_templates_location_key_unique" ON "communication_templates" USING btree ("location_id","key");--> statement-breakpoint
CREATE INDEX "communication_templates_location_idx" ON "communication_templates" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_staff_effective_unique" ON "compensation_profiles" USING btree ("location_id","staff_id","effective_from");--> statement-breakpoint
CREATE INDEX "compensation_location_staff_idx" ON "compensation_profiles" USING btree ("location_id","staff_id","effective_from");--> statement-breakpoint
CREATE INDEX "consent_client_idx" ON "consent_records" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_closeouts_location_date_unique" ON "daily_closeouts" USING btree ("location_id","business_date");--> statement-breakpoint
CREATE INDEX "daily_closeouts_org_date_idx" ON "daily_closeouts" USING btree ("organization_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_provider_events_provider_event_unique" ON "delivery_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "delivery_provider_events_message_idx" ON "delivery_provider_events" USING btree ("message_id","received_at");--> statement-breakpoint
CREATE INDEX "delivery_provider_events_status_idx" ON "delivery_provider_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_portal_staff_unique" ON "employee_portal_credentials" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_portal_code_unique" ON "employee_portal_credentials" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_portal_invite_token_unique" ON "employee_portal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "employee_portal_invite_staff_idx" ON "employee_portal_invitations" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_portal_session_token_unique" ON "employee_portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "employee_portal_session_staff_idx" ON "employee_portal_sessions" USING btree ("staff_id","expires_at");--> statement-breakpoint
CREATE INDEX "expense_receipts_expense_idx" ON "expense_receipts" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE INDEX "expenses_location_paid_idx" ON "expenses" USING btree ("location_id","paid_on");--> statement-breakpoint
CREATE INDEX "expenses_org_category_idx" ON "expenses" USING btree ("organization_id","category","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_idempotency_unique" ON "expenses" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "external_entity_provider_external_unique" ON "external_entity_links" USING btree ("organization_id","provider","entity_type","external_entity_id");--> statement-breakpoint
CREATE INDEX "external_entity_provider_local_idx" ON "external_entity_links" USING btree ("organization_id","provider","entity_type","local_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_transactions_account_hash_unique" ON "financial_account_transactions" USING btree ("account_id","import_hash");--> statement-breakpoint
CREATE INDEX "financial_transactions_account_date_idx" ON "financial_account_transactions" USING btree ("account_id","transaction_date");--> statement-breakpoint
CREATE INDEX "financial_transactions_org_date_idx" ON "financial_account_transactions" USING btree ("organization_id","transaction_date");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_org_name_unique" ON "financial_accounts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "financial_accounts_org_location_idx" ON "financial_accounts" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_provider_location_unique" ON "integration_sync_states" USING btree ("provider","location_id");--> statement-breakpoint
CREATE INDEX "integration_sync_org_status_idx" ON "integration_sync_states" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "inventory_items_location_name_idx" ON "inventory_items" USING btree ("location_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_location_sku_unique" ON "inventory_items" USING btree ("location_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_location_barcode_unique" ON "inventory_items" USING btree ("location_id","barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_org_idempotency_unique" ON "inventory_items" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movement_claims_item_version_unique" ON "inventory_movement_claims" USING btree ("inventory_item_id","expected_stock_version");--> statement-breakpoint
CREATE INDEX "inventory_movement_claims_org_group_idx" ON "inventory_movement_claims" USING btree ("organization_id","movement_group_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_time_idx" ON "inventory_movements" USING btree ("inventory_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_location_time_idx" ON "inventory_movements" USING btree ("location_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_org_idempotency_unique" ON "inventory_movements" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_mutation_claims_invoice_version_unique" ON "invoice_mutation_claims" USING btree ("invoice_id","expected_mutation_version");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_mutation_claims_org_idempotency_unique" ON "invoice_mutation_claims" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_mutation_claims_invoice_idx" ON "invoice_mutation_claims" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_appointment_unique" ON "invoices" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_unique" ON "invoices" USING btree ("organization_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_location_created_idx" ON "invoices" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "location_hours_day_unique" ON "location_hours" USING btree ("location_id","weekday");--> statement-breakpoint
CREATE INDEX "location_hours_org_idx" ON "location_hours" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_slug_unique" ON "locations" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "media_assets_appointment_idx" ON "media_assets" USING btree ("appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_pet_idx" ON "media_assets" USING btree ("pet_id","created_at");--> statement-breakpoint
CREATE INDEX "message_events_message_idx" ON "message_events" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "message_events_location_idx" ON "message_events" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_dedupe_unique" ON "messages" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "messages_location_scheduled_idx" ON "messages" USING btree ("location_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "messages_client_created_idx" ON "messages" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "online_payment_sessions_org_idempotency_unique" ON "online_payment_sessions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "online_payment_sessions_one_open_invoice_unique" ON "online_payment_sessions" USING btree ("invoice_id") WHERE "online_payment_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "online_payment_sessions_appointment_idx" ON "online_payment_sessions" USING btree ("appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "online_payment_sessions_invoice_idx" ON "online_payment_sessions" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_subscriptions_org_unique" ON "organization_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_events_invoice_idx" ON "payment_events" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_events_location_occurred_idx" ON "payment_events" USING btree ("location_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_org_idempotency_unique" ON "payment_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_accounts_org_unique" ON "payment_provider_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_line_period_staff_unique" ON "payroll_lines" USING btree ("payroll_period_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_location_dates_unique" ON "payroll_periods" USING btree ("location_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_org_idempotency_unique" ON "payroll_periods" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pet_care_profiles_pet_unique" ON "pet_care_profiles" USING btree ("pet_id");--> statement-breakpoint
CREATE INDEX "pet_care_profiles_org_idx" ON "pet_care_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pet_warnings_pet_active_idx" ON "pet_warnings" USING btree ("pet_id","active");--> statement-breakpoint
CREATE INDEX "pet_warnings_org_idx" ON "pet_warnings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pets_client_name_unique" ON "pets" USING btree ("client_id","name");--> statement-breakpoint
CREATE INDEX "pets_org_idx" ON "pets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portal_access_requests_email_time_idx" ON "portal_access_requests" USING btree ("email_hash","requested_at");--> statement-breakpoint
CREATE INDEX "provider_webhook_events_status_idx" ON "provider_webhook_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "public_intake_submission_key_unique" ON "public_intake_submissions" USING btree ("organization_id","submission_key");--> statement-breakpoint
CREATE INDEX "public_intake_source_time_idx" ON "public_intake_submissions" USING btree ("organization_id","source_hash","created_at");--> statement-breakpoint
CREATE INDEX "public_intake_contact_time_idx" ON "public_intake_submissions" USING btree ("organization_id","contact_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_claims_order_version_unique" ON "purchase_order_claims" USING btree ("purchase_order_id","expected_updated_at");--> statement-breakpoint
CREATE INDEX "purchase_order_claims_org_order_idx" ON "purchase_order_claims" USING btree ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_order_item_unique" ON "purchase_order_lines" USING btree ("purchase_order_id","inventory_item_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_item_idx" ON "purchase_order_lines" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_location_number_unique" ON "purchase_orders" USING btree ("location_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_idempotency_unique" ON "purchase_orders" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_orders_location_status_idx" ON "purchase_orders" USING btree ("location_id","status","created_at");--> statement-breakpoint
CREATE INDEX "salon_auth_challenges_email_time_idx" ON "salon_auth_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "salon_auth_challenges_source_time_idx" ON "salon_auth_challenges" USING btree ("source_hash","created_at");--> statement-breakpoint
CREATE INDEX "salon_auth_sessions_email_idx" ON "salon_auth_sessions" USING btree ("email","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "salon_settings_location_unique" ON "salon_settings" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_location_name_unique" ON "services" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "services_org_idx" ON "services" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_email_unique" ON "staff" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "staff_location_idx" ON "staff" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_availability_day_unique" ON "staff_availability" USING btree ("staff_id","location_id","weekday");--> statement-breakpoint
CREATE INDEX "staff_availability_org_idx" ON "staff_availability" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_clock_state_unique" ON "staff_clock_states" USING btree ("location_id","staff_id");--> statement-breakpoint
CREATE INDEX "staff_invitations_org_email_idx" ON "staff_invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "staff_invitations_location_status_idx" ON "staff_invitations" USING btree ("location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_locations_staff_location_unique" ON "staff_locations" USING btree ("staff_id","location_id");--> statement-breakpoint
CREATE INDEX "staff_locations_org_location_idx" ON "staff_locations" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_service_skill_unique" ON "staff_service_skills" USING btree ("staff_id","service_id");--> statement-breakpoint
CREATE INDEX "staff_service_skills_org_idx" ON "staff_service_skills" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "suppliers_location_name_idx" ON "suppliers" USING btree ("location_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_idempotency_unique" ON "suppliers" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "time_clock_claim_staff_version_unique" ON "time_clock_claims" USING btree ("location_id","staff_id","expected_version");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_org_idempotency_unique" ON "time_entries" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "time_entries_location_clock_idx" ON "time_entries" USING btree ("location_id","clock_in");--> statement-breakpoint
CREATE INDEX "time_adjustments_entry_idx" ON "time_entry_adjustments" USING btree ("time_entry_id","created_at");--> statement-breakpoint
CREATE INDEX "timesheet_shift_week_date_idx" ON "timesheet_shifts" USING btree ("week_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheet_shift_org_staff_idx" ON "timesheet_shifts" USING btree ("organization_id","staff_id");--> statement-breakpoint
CREATE INDEX "timesheet_shift_location_date_idx" ON "timesheet_shifts" USING btree ("location_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_week_staff_start_unique" ON "timesheet_weeks" USING btree ("staff_id","week_starts_on");--> statement-breakpoint
CREATE INDEX "timesheet_week_org_start_idx" ON "timesheet_weeks" USING btree ("organization_id","week_starts_on");--> statement-breakpoint
CREATE INDEX "vaccination_records_pet_expiry_idx" ON "vaccination_records" USING btree ("pet_id","expires_on");--> statement-breakpoint
CREATE INDEX "vaccination_records_org_status_idx" ON "vaccination_records" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_conversion_entry_unique" ON "waitlist_conversion_claims" USING btree ("waitlist_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_conversion_appointment_unique" ON "waitlist_conversion_claims" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "waitlist_location_status_idx" ON "waitlist_entries" USING btree ("location_id","status","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_client_idx" ON "waitlist_entries" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_active_pet_service_unique" ON "waitlist_entries" USING btree ("location_id","pet_id","service_id") WHERE "waitlist_entries"."status" in ('waiting','contacted');