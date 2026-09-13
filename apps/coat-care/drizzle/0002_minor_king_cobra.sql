CREATE TABLE "client_media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" text,
	"client_id" text NOT NULL,
	"kind" text DEFAULT 'gallery' NOT NULL,
	"r2_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"uploaded_by_staff_id" text,
	"uploaded_by_client" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "client_media_assets_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
ALTER TABLE "client_media_assets" ADD CONSTRAINT "client_media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_media_assets" ADD CONSTRAINT "client_media_assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_media_assets" ADD CONSTRAINT "client_media_assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_media_assets" ADD CONSTRAINT "client_media_assets_uploaded_by_staff_id_staff_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_media_assets_client_idx" ON "client_media_assets" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "client_media_assets_org_idx" ON "client_media_assets" USING btree ("organization_id","created_at");