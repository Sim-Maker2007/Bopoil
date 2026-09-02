-- BOPOIL production cleanup.
--
-- The first deployment seeded Coat & Care's demo data (three fictional groomers,
-- three English demo services, 8-18 opening hours) into the BOPOIL tenant and
-- left the CRM's own online booking switched on. Square Appointments is the
-- scheduling source of truth, so:
--   * online booking and deposits are paused for the Gatineau location,
--   * demo services, staff, memberships and availability are deactivated,
--   * opening hours follow the salon's published schedule.
-- Every statement only touches rows that still carry the seed's exact values,
-- so anything the salon has since edited by hand is left alone.

UPDATE "salon_settings"
SET "allow_online_booking" = false,
    "require_online_deposit" = false,
    "updated_at" = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
WHERE "id" = 'settings_queen_west'
  AND "organization_id" = 'org_coat_care';
--> statement-breakpoint
UPDATE "services"
SET "active" = false
WHERE "organization_id" = 'org_coat_care'
  AND "location_id" = 'loc_queen_west'
  AND (
    ("id" = 'svc_signature' AND "name" = 'Signature groom')
    OR ("id" = 'svc_bath_brush' AND "name" = 'Bath & brush')
    OR ("id" = 'svc_puppy' AND "name" = 'Puppy''s first visit')
  );
--> statement-breakpoint
UPDATE "staff"
SET "active" = false
WHERE "organization_id" = 'org_coat_care'
  AND "email" IS NULL
  AND (
    ("id" = 'staff_maya' AND "display_name" = 'Maya')
    OR ("id" = 'staff_nadia' AND "display_name" = 'Nadia')
    OR ("id" = 'staff_jonah' AND "display_name" = 'Jonah')
  );
--> statement-breakpoint
UPDATE "staff_locations"
SET "active" = false,
    "updated_at" = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
WHERE "organization_id" = 'org_coat_care'
  AND "staff_id" IN (
    SELECT "id" FROM "staff"
    WHERE "id" IN ('staff_maya', 'staff_nadia', 'staff_jonah') AND "active" = false
  );
--> statement-breakpoint
UPDATE "staff_availability"
SET "active" = false,
    "updated_at" = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
WHERE "organization_id" = 'org_coat_care'
  AND "staff_id" IN (
    SELECT "id" FROM "staff"
    WHERE "id" IN ('staff_maya', 'staff_nadia', 'staff_jonah') AND "active" = false
  );
--> statement-breakpoint
UPDATE "location_hours"
SET "open" = ("weekday" <> 0),
    "opens_at" = '09:00',
    "closes_at" = '16:00',
    "updated_at" = to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')
WHERE "organization_id" = 'org_coat_care'
  AND "location_id" = 'loc_queen_west'
  AND "id" LIKE 'hours_queen_west_%'
  AND (
    ("weekday" = 6 AND "opens_at" = '09:00' AND "closes_at" = '16:00')
    OR ("weekday" <> 6 AND "opens_at" = '08:00' AND "closes_at" = '18:00')
  );
