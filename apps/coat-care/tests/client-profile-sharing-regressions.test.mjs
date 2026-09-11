import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("portal connection and every online appointment require separate confirmations", async () => {
  const [access, bookingUi, bookings, squareBookings] = await Promise.all([
    source("../app/portal/access/[token]/route.ts"),
    source("../app/booking-experience.tsx"),
    source("../app/api/bookings/route.ts"),
    source("../app/api/square-bookings/route.ts"),
  ]);
  assert.match(access, /name="policyAcknowledged"[\s\S]*required/);
  assert.match(access, /href="\/politique\.html"/);
  assert.match(access, /form\.get\("policyAcknowledged"\) !== "yes"/);
  assert.match(access, /type: "portal_policy_acknowledgement"/);
  assert.match(bookingUi, /informationCurrent/);
  assert.match(bookingUi, /contact and pet information is up to date/);
  for (const route of [bookings, squareBookings]) {
    assert.match(route, /if \(!payload\.informationCurrent\)/);
    assert.match(route, /type: "client_information_current"/);
  }
});

test("client portal never selects internal care or safety notes", async () => {
  const [portalRoute, portalUi, careUi] = await Promise.all([
    source("../app/api/portal/[token]/route.ts"),
    source("../app/portal/[token]/portal-experience.tsx"),
    source("../app/salon/care-workspace.tsx"),
  ]);
  assert.doesNotMatch(portalRoute, /internalNotes: appointmentCareRecords\.internalNotes/);
  assert.doesNotMatch(portalRoute, /handlingNotes: pets\.handlingNotes/);
  assert.doesNotMatch(portalRoute, /safetyLevel: pets\.safetyLevel/);
  assert.match(portalUi, /Salon-only handling notes and safety warnings are never shown here/);
  assert.match(careUi, /Internal groomer notes — never shown to the client/);
});

test("profile and gallery photos are tenant-scoped and explicitly client-visible", async () => {
  const [schema, adminUpload, portalPayload, portalMedia, profileUpload, portalUi] = await Promise.all([
    source("../db/schema.ts"),
    source("../app/api/client-media/route.ts"),
    source("../app/api/portal/[token]/route.ts"),
    source("../app/api/portal/[token]/media/[id]/route.ts"),
    source("../app/api/portal/[token]/profile-photo/route.ts"),
    source("../app/portal/[token]/portal-experience.tsx"),
  ]);
  assert.match(schema, /clientMediaAssets = sqliteTable\("client_media_assets"/);
  assert.match(schema, /clientVisible: integer\("client_visible"/);
  assert.match(adminUpload, /eq\(clients\.organizationId, membership\.organizationId\)/);
  assert.match(adminUpload, /clientVisible/);
  assert.match(portalPayload, /eq\(clientMediaAssets\.clientVisible, true\)/);
  assert.match(portalMedia, /eq\(clientMediaAssets\.organizationId, access\.client\.organizationId\)/);
  assert.match(portalMedia, /eq\(clientMediaAssets\.clientId, access\.client\.id\)/);
  assert.match(portalMedia, /eq\(clientMediaAssets\.clientVisible, true\)/);
  assert.match(profileUpload, /requestIsSameOrigin\(request\)/);
  assert.match(profileUpload, /uploadedByClient: true/);
  assert.match(portalUi, /My photos/);
  assert.match(portalUi, /Choose profile photo/);
});
