CREATE TABLE "square_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"appointment_id" text,
	"customer_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"start_at" text DEFAULT '' NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"seller_note" text DEFAULT '' NOT NULL,
	"customer_note" text DEFAULT '' NOT NULL,
	"creator_type" text DEFAULT '' NOT NULL,
	"creator_team_member_id" text DEFAULT '' NOT NULL,
	"creator_customer_id" text DEFAULT '' NOT NULL,
	"location_type" text DEFAULT '' NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"transition_time_minutes" integer DEFAULT 0 NOT NULL,
	"segments_json" text DEFAULT '[]' NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"client_id" text,
	"given_name" text DEFAULT '' NOT NULL,
	"family_name" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"email_address" text DEFAULT '' NOT NULL,
	"phone_number" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reference_id" text DEFAULT '' NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"address_json" text DEFAULT '{}' NOT NULL,
	"creation_source" text DEFAULT '' NOT NULL,
	"email_unsubscribed" boolean DEFAULT false NOT NULL,
	"group_ids_json" text DEFAULT '[]' NOT NULL,
	"segment_ids_json" text DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"external_location_id" text DEFAULT '' NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"client_id" text,
	"state" text DEFAULT '' NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"reference_id" text DEFAULT '' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"service_charge_cents" integer DEFAULT 0 NOT NULL,
	"returned_cents" integer DEFAULT 0 NOT NULL,
	"net_amount_due_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"line_items_json" text DEFAULT '[]' NOT NULL,
	"fulfillments_json" text DEFAULT '[]' NOT NULL,
	"tenders_json" text DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"square_closed_at" text DEFAULT '' NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"external_location_id" text DEFAULT '' NOT NULL,
	"order_id" text DEFAULT '' NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"client_id" text,
	"team_member_id" text DEFAULT '' NOT NULL,
	"staff_id" text,
	"status" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"card_brand" text DEFAULT '' NOT NULL,
	"card_last_4" text DEFAULT '' NOT NULL,
	"entry_method" text DEFAULT '' NOT NULL,
	"wallet_brand" text DEFAULT '' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"approved_cents" integer DEFAULT 0 NOT NULL,
	"processing_fee_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"receipt_number" text DEFAULT '' NOT NULL,
	"receipt_url" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"application_name" text DEFAULT '' NOT NULL,
	"device_name" text DEFAULT '' NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text NOT NULL,
	"payment_id" text DEFAULT '' NOT NULL,
	"order_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"processing_fee_cents" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"staff_id" text,
	"given_name" text DEFAULT '' NOT NULL,
	"family_name" text DEFAULT '' NOT NULL,
	"email_address" text DEFAULT '' NOT NULL,
	"phone_number" text DEFAULT '' NOT NULL,
	"reference_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"assigned_locations_json" text DEFAULT '[]' NOT NULL,
	"square_created_at" text DEFAULT '' NOT NULL,
	"square_updated_at" text DEFAULT '' NOT NULL,
	"raw_json" text DEFAULT '{}' NOT NULL,
	"synced_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
DROP INDEX "integration_sync_provider_location_unique";--> statement-breakpoint
ALTER TABLE "integration_sync_states" ADD COLUMN "resource" text DEFAULT 'bookings' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_sync_states" ADD COLUMN "checkpoint_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_sync_states" ADD COLUMN "last_run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "square_bookings" ADD CONSTRAINT "square_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_bookings" ADD CONSTRAINT "square_bookings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_bookings" ADD CONSTRAINT "square_bookings_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_customers" ADD CONSTRAINT "square_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_customers" ADD CONSTRAINT "square_customers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_customers" ADD CONSTRAINT "square_customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_orders" ADD CONSTRAINT "square_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_orders" ADD CONSTRAINT "square_orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_orders" ADD CONSTRAINT "square_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_payments" ADD CONSTRAINT "square_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_payments" ADD CONSTRAINT "square_payments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_payments" ADD CONSTRAINT "square_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_payments" ADD CONSTRAINT "square_payments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_refunds" ADD CONSTRAINT "square_refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_refunds" ADD CONSTRAINT "square_refunds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_team_members" ADD CONSTRAINT "square_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_team_members" ADD CONSTRAINT "square_team_members_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "square_bookings_location_start_idx" ON "square_bookings" USING btree ("location_id","start_at");--> statement-breakpoint
CREATE INDEX "square_bookings_appointment_idx" ON "square_bookings" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "square_bookings_org_customer_idx" ON "square_bookings" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "square_customers_org_email_idx" ON "square_customers" USING btree ("organization_id","email_address");--> statement-breakpoint
CREATE INDEX "square_customers_org_phone_idx" ON "square_customers" USING btree ("organization_id","phone_number");--> statement-breakpoint
CREATE INDEX "square_customers_client_idx" ON "square_customers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "square_customers_org_updated_idx" ON "square_customers" USING btree ("organization_id","square_updated_at");--> statement-breakpoint
CREATE INDEX "square_orders_location_created_idx" ON "square_orders" USING btree ("location_id","square_created_at");--> statement-breakpoint
CREATE INDEX "square_orders_org_customer_idx" ON "square_orders" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "square_orders_client_idx" ON "square_orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "square_payments_location_created_idx" ON "square_payments" USING btree ("location_id","square_created_at");--> statement-breakpoint
CREATE INDEX "square_payments_org_customer_idx" ON "square_payments" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "square_payments_client_idx" ON "square_payments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "square_payments_order_idx" ON "square_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "square_refunds_location_created_idx" ON "square_refunds" USING btree ("location_id","square_created_at");--> statement-breakpoint
CREATE INDEX "square_refunds_payment_idx" ON "square_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "square_team_members_org_email_idx" ON "square_team_members" USING btree ("organization_id","email_address");--> statement-breakpoint
CREATE INDEX "square_team_members_staff_idx" ON "square_team_members" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_provider_location_resource_unique" ON "integration_sync_states" USING btree ("provider","location_id","resource");