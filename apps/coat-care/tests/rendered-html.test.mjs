import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the public grooming booking experience", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Coat & Care — Pet Grooming, Beautifully Simple/);
  assert.match(page, /A happier grooming day/);
  assert.match(page, /fetch\("\/api\/bookings"/);
  assert.match(page, /policyAccepted/);
  assert.doesNotMatch(page + layout, /codex-preview|Your site is taking shape/i);
});

test("protects the salon workspace when no authenticated user is present", async () => {
  const [salonPage, auth] = await Promise.all([
    readFile(new URL("../app/salon/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(salonPage, /requireChatGPTUser\("\/salon"\)/);
  assert.match(salonPage, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(auth, /redirect\(chatGPTSignInPath\(returnTo\)\)/);
});

test("declares tenant-safe Vercel persistence and auditable booking records", async () => {
  const [database, blob, schema, bookingRoute] = await Promise.all([
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/blob-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(database, /DATABASE_URL/);
  assert.match(database, /drizzle\(routeToActiveBatch\(client\)/);
  assert.match(blob, /@vercel\/blob/);
  assert.match(blob, /access: "private"/);
  for (const entity of ["organizations", "locations", "staff", "staff_locations", "staff_invitations", "salon_settings", "location_hours", "clients", "client_portal_sessions", "portal_access_requests", "pets", "vaccination_records", "pet_warnings", "services", "staff_availability", "staff_service_skills", "appointments", "appointment_change_claims", "appointment_care_records", "waitlist_entries", "waitlist_conversion_claims", "media_assets", "approval_requests", "invoices", "invoice_line_items", "payment_events", "communication_templates", "messages", "message_events", "consent_records", "audit_events"]) {
    assert.match(schema, new RegExp(entity));
  }
  assert.match(bookingRoute, /organizationId:\s*organization\.id/);
  assert.match(bookingRoute, /resolveStorefront/);
  assert.match(bookingRoute, /policyAccepted/);
  assert.match(bookingRoute, /appointment\.created/);
});

test("validates protected grooming photos by signature, not only MIME claims", async () => {
  const { isAllowedImageBytes, isAllowedVaccineDocument } = await import("../lib/media-validation.ts");
  assert.equal(isAllowedImageBytes("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(isAllowedImageBytes("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(isAllowedImageBytes("image/webp", new TextEncoder().encode("RIFF1234WEBP")), true);
  assert.equal(isAllowedImageBytes("image/jpeg", new TextEncoder().encode("<script>")), false);
  assert.equal(isAllowedImageBytes("image/svg+xml", new TextEncoder().encode("<svg>")), false);
  assert.equal(isAllowedVaccineDocument("application/pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(isAllowedVaccineDocument("application/pdf", new TextEncoder().encode("<html>")), false);
});

test("ships tenant-safe care records, structured warnings, photos, and atomic approvals", async () => {
  const [careApi, mediaApi, mediaReadApi, approvalApi, careView, approvalView] = await Promise.all([
    readFile(new URL("../app/api/care/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/approvals/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/care-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/approval/[token]/approval-experience.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [careApi, mediaApi, mediaReadApi]) assert.match(source, /requireSalonAccess\(\)/);
  assert.match(mediaApi, /file\.size > 4 \* 1024 \* 1024/);
  assert.match(mediaApi, /isAllowedImageBytes/);
  assert.match(mediaReadApi, /cache-control": "private/);
  assert.match(careApi, /pet\.warning_created/);
  assert.match(careApi, /Price approval must be completed before checkout begins/);
  assert.match(careApi, /templateKey: "report_card"/);
  assert.match(approvalApi, /await db\.batch/);
  assert.match(approvalApi, /approvalRequests\.status, "pending"/);
  assert.match(approvalApi, /priceEstimateCents: sql/);
  for (const feature of [/Safety warnings/, /Capture the care story/, /report card/, /Client price approvals/]) assert.match(careView, feature);
  assert.match(careView, /Internal groomer notes/);
  assert.match(approvalView, /No payment is taken here/);
});

test("renders safe client templates and schedules 24-hour reminders", async () => {
  const { renderCommunicationTemplate, reminderSendAt } = await import("../lib/communication-templates.ts");
  assert.equal(renderCommunicationTemplate("Hi {{client_name}}, {{pet_name}} is ready. {{unknown}}", { client_name: "Amara", pet_name: "Milo" }), "Hi Amara, Milo is ready. ");
  assert.equal(reminderSendAt("2026-07-20T18:00:00.000Z", Date.parse("2026-07-10T00:00:00.000Z")), "2026-07-19T18:00:00.000Z");
  assert.equal(reminderSendAt("2026-07-10T12:00:00.000Z", Date.parse("2026-07-10T11:00:00.000Z")), "2026-07-10T11:00:00.000Z");
});

test("queues deduplicated transactional communications from product events", async () => {
  const [communications, bookingApi, appointmentsApi, checkoutApi, messagesApi, templatesApi, view] = await Promise.all([
    readFile(new URL("../db/communications.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/templates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(communications, /booking_request_received/);
  assert.match(communications, /dedupeKey: `\$\{templateKey\}:\$\{appointmentId\}\$\{suffix\}`/);
  assert.match(communications, /appointment_reminder:\$\{appointmentId\}/);
  assert.match(bookingApi, /queueBookingCommunications/);
  assert.match(appointmentsApi, /templateKey: "ready_pickup"/);
  assert.match(appointmentsApi, /\["cancelled", "no_show"\]/);
  assert.match(checkoutApi, /templateKey: "receipt"/);
  assert.match(messagesApi, /marketingConsent/);
  assert.match(messagesApi, /message\.sent_manually/);
  assert.match(templatesApi, /requireSalonManager\(membership\)/);
  assert.match(view, /delivery is never falsely claimed/i);
  assert.match(view, /Tender|Delivery history/);
});

test("ships a tenant-safe conflict-proof front desk quick booking flow", async () => {
  const [appointmentsApi, access, availability, workspace, modal] = await Promise.all([
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/availability.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/quick-booking-modal.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(access, /requireSchedulingAccess/);
  assert.match(appointmentsApi, /requireSchedulingAccess\(membership\)/);
  assert.match(appointmentsApi, /membership\.organizationId/);
  assert.match(appointmentsApi, /membership\.locationId/);
  assert.match(appointmentsApi, /buildReservationRows/);
  assert.match(appointmentsApi, /await db\.batch/);
  assert.match(appointmentsApi, /source: "staff_quick_booking"/);
  assert.match(appointmentsApi, /policyConsentRecorded: false/);
  assert.doesNotMatch(appointmentsApi, /consentRecords/);
  assert.match(availability, /includeWhenOnlineBookingPaused/);
  assert.match(workspace, /setQuickBookingOpen\(true\)/);
  assert.doesNotMatch(workspace, /window\.location\.assign\(`\$\{storefrontUrl\}#booking`\)/);
  assert.match(modal, /Live capacity, without leaving the workspace/);
  assert.match(modal, /It does not record client policy consent/);
});

test("calculates immutable invoice totals and refund-safe statuses", async () => {
  const { calculateInvoice, invoiceStatus, invoiceBalanceCents } = await import("../lib/financial-ledger.ts");
  assert.deepEqual(calculateInvoice({ subtotalCents: 10000, discountCents: 1000, taxRateBps: 1300, tipCents: 1800 }), {
    taxableCents: 9000,
    taxCents: 1170,
    totalCents: 11970,
  });
  assert.equal(invoiceStatus(11970, 0, 0), "open");
  assert.equal(invoiceStatus(11970, 5000, 0), "partially_paid");
  assert.equal(invoiceStatus(11970, 11970, 0), "paid");
  assert.equal(invoiceStatus(11970, 11970, 2000), "partially_refunded");
  assert.equal(invoiceStatus(11970, 11970, 11970), "refunded");
  assert.equal(invoiceBalanceCents(11970, 11970, 0), 0);
  assert.equal(invoiceBalanceCents(11970, 11970, 2000), 2000);
  assert.equal(invoiceBalanceCents(11970, 5000, 7000), 11970);
});

test("uses each salon timezone for daylight-saving-safe closeout days", async () => {
  const { zonedDayBounds, zonedDateTimeToUtc } = await import("../lib/time-zone.ts");
  assert.equal(zonedDayBounds("2026-01-15", "America/Toronto").start.toISOString(), "2026-01-15T05:00:00.000Z");
  assert.equal(zonedDayBounds("2026-07-15", "America/Toronto").start.toISOString(), "2026-07-15T04:00:00.000Z");
  assert.equal(zonedDayBounds("2026-03-08", "America/Toronto").end.getTime() - zonedDayBounds("2026-03-08", "America/Toronto").start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(zonedDateTimeToUtc("2026-07-20", "09:30", "America/Toronto").toISOString(), "2026-07-20T13:30:00.000Z");
  assert.equal(zonedDateTimeToUtc("2026-01-20", "09:30", "America/Toronto").toISOString(), "2026-01-20T14:30:00.000Z");
});

test("ships authenticated idempotent checkout and daily reconciliation", async () => {
  const [checkoutApi, financeApi, financialViews] = await Promise.all([
    readFile(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/financial-views.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [checkoutApi, financeApi]) assert.match(source, /requireSalonAccess\(\)/);
  assert.match(checkoutApi, /requireWorkspacePermission\(membership, "checkout"\)/);
  assert.match(financeApi, /requireFinancialAccess\(membership\)/);
  assert.match(checkoutApi, /idempotencyKey/);
  assert.match(checkoutApi, /payment\.recorded/);
  assert.match(checkoutApi, /payment\.refunded/);
  assert.match(checkoutApi, /requireSalonManager\(membership\)/);
  assert.match(financeApi, /byMethod/);
  assert.match(financeApi, /location\.tax_settings_updated/);
  assert.match(financialViews, /Card details are handled by your terminal—not stored/);
  assert.match(financialViews, /Tender reconciliation/);
});

test("ships manager-controlled services, team scheduling, and reports", async () => {
  const [servicesApi, teamApi, reportsApi, workspace, businessViews] = await Promise.all([
    readFile(new URL("../app/api/services/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/business-views.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [servicesApi, teamApi]) {
    assert.match(source, /requireSalonAccess\(\)/);
    assert.match(source, /requireSalonManager\(membership\)/);
    assert.match(source, /auditEvents/);
  }
  assert.match(reportsApi, /requireBookkeepingAccess\(membership\)/);
  assert.match(reportsApi, /summarizeOperations/);
  assert.match(reportsApi, /locationComparison/);
  for (const view of ["services", "team", "workforce", "inventory", "finance", "reports"]) assert.match(workspace, new RegExp(`\\| "${view}"`));
  assert.match(businessViews, /Weekly availability/);
  assert.match(businessViews, /Owner intelligence/);
});

test("enforces the grooming appointment state machine", async () => {
  const workflowUrl = new URL("../lib/appointment-workflow.ts", import.meta.url);
  const source = await readFile(workflowUrl, "utf8");
  assert.match(source, /confirmed:\s*\["arrived",\s*"cancelled",\s*"no_show"\]/);
  assert.match(source, /requested:\s*\["confirmed",\s*"cancelled"\]/);
  assert.match(source, /quality_check:\s*\["grooming",\s*"ready"\]/);
  assert.match(source, /completed:\s*\[\]/);
  assert.match(source, /appointmentTransitions\[from\]\?\.includes\(to\)/);
});

test("keeps operational write APIs authenticated and audited", async () => {
  const [appointmentsApi, petsApi, clientsApi] = await Promise.all([
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [appointmentsApi, petsApi, clientsApi]) assert.match(source, /requireSalonAccess\(\)/);
  assert.match(appointmentsApi, /appointment\.status_changed/);
  assert.match(petsApi, /pet\.safety_updated/);
  assert.match(clientsApi, /organizationId,\s*membership\.organizationId/);
});

test("ships secure multi-tenant onboarding and salon controls", async () => {
  const [access, onboardingApi, settingsApi, locationApi, settingsView, workspace, dashboard, appointmentsApi, clientsApi] = await Promise.all([
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/location/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(access, /salon_location/);
  assert.match(access, /salon_organization/);
  assert.match(access, /onboarding_required/);
  assert.match(access, /staffInvitations\.status, "pending"/);
  assert.match(access, /staffLocations\.active, true/);
  assert.match(settingsApi, /requireSalonOwner\(membership\)/);
  assert.match(settingsApi, /Add and invite teammates from Team/);
  assert.match(settingsApi, /location\.created/);
  assert.match(locationApi, /membership\.locations\.find/);
  assert.match(locationApi, /membership\.organizations\.find/);
  assert.match(locationApi, /HttpOnly; Secure; SameSite=Lax/);
  for (const source of [dashboard, appointmentsApi, clientsApi]) assert.match(source, /membership\.organizationId/);
  assert.match(onboardingApi, /organization\.created/);
  assert.match(onboardingApi, /salon_organization=/);
  assert.match(onboardingApi, /country === "US" \? "USD" : "CAD"/);
  for (const feature of [/Opening checklist/, /Booking rules & floor capacity/, /Manage team access/, /Add a location/]) assert.match(settingsView, feature);
  assert.match(workspace, /Current salon location/);
  assert.match(workspace, /Add another salon/);
  assert.match(workspace, /SettingsView/);
});

test("gives every salon and location an isolated public storefront", async () => {
  const [resolver, catalog, availability, booking, waitlist, portalLink, experience, salonRoute, locationRoute, dashboard, workspace] = await Promise.all([
    readFile(new URL("../db/public-storefront.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/availability/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/waitlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/request-link/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/book/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/book/[slug]/[location]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(resolver, /organizations\.slug, requestedOrganization/);
  assert.match(resolver, /locations\.organizationId, organization\.id/);
  for (const source of [catalog, availability, booking, waitlist, portalLink]) assert.match(source, /resolveStorefront/);
  for (const source of [booking, waitlist]) {
    assert.match(source, /organizationId: organization\.id/);
    assert.match(source, /locationId: location\.id/);
  }
  assert.match(experience, /Booking powered by Coat &amp; Care/);
  assert.match(experience, /catalog\.locations\.length > 1/);
  assert.match(salonRoute + locationRoute, /BookingExperience/);
  assert.match(dashboard, /locationSlug: locations\.slug/);
  assert.match(workspace, /View storefront/);
});

test("keeps pilot bootstrap bounded, initializes the configured owner, and hides database errors", async () => {
  const [pilot, storefront, access] = await Promise.all([
    readFile(new URL("../db/pilot.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/public-storefront.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
  ]);
  assert.match(pilot, /function chunks<T>\(values: T\[\], size = 8\)/);
  assert.match(pilot, /chunks\(availabilityRows\)/);
  assert.match(pilot, /pilotSeedPromise = seedPilotData\(\)\.catch/);
  assert.match(access, /process\.env\.SALON_OWNER_EMAIL/);
  assert.match(access, /ensureBootstrapOwner\(email, displayName\)/);
  assert.match(access, /role: "owner"/);
  assert.doesNotMatch(storefront, /Response\.json\(\{ error: error instanceof Error \? error\.message/);
  assert.doesNotMatch(access, /Response\.json\(\{ error: error instanceof Error \? error\.message/);
  assert.match(storefront, /Response\.json\(\{ error: fallback \}/);
  assert.match(access, /Response\.json\(\{ error: fallback \}/);
});

test("generates real bookable slots from staff, floor resources, and local hours", async () => {
  const { generateAvailability, segmentsForAppointment } = await import("../lib/availability-engine.ts");
  const service = { id: "groom", durationMinutes: 60, bufferMinutes: 0, bathMinutes: 30, dryerMinutes: 30, groomingTableMinutes: 0, kennelMinutes: 0 };
  const slots = generateAvailability({
    dates: ["2026-07-20"], timezone: "America/Toronto", now: new Date("2026-07-19T00:00:00.000Z"), minimumLeadMinutes: 0, bookingWindowDays: 30, service,
    hours: [{ weekday: 1, open: true, opensAt: "09:00", closesAt: "12:00" }],
    staff: [{ id: "one", name: "One", weekday: 1, startTime: "09:00", endTime: "12:00" }, { id: "two", name: "Two", weekday: 1, startTime: "09:00", endTime: "12:00" }],
    appointments: [{ id: "existing", staffId: "one", startsAt: "2026-07-20T13:00:00.000Z", endsAt: "2026-07-20T14:00:00.000Z", status: "confirmed", bathMinutes: 30, dryerMinutes: 30, groomingTableMinutes: 0, kennelMinutes: 0 }],
    capacity: { pet_capacity: 2, bath: 1, table: 2, dryer: 1, kennel: 2 },
  });
  assert.equal(slots[0].startsAt, "2026-07-20T13:30:00.000Z");
  assert.deepEqual(slots[0].staff.map((person) => person.id), ["two"]);
  assert.equal(slots.at(-1).startsAt, "2026-07-20T15:00:00.000Z");
  const segments = segmentsForAppointment("2026-07-20T13:00:00.000Z", "2026-07-20T14:00:00.000Z", service);
  assert.equal(segments.pet_capacity.length, 4);
  assert.equal(segments.bath.length, 2);
  assert.equal(segments.dryer[0], "2026-07-20T13:30:00.000Z");
});

test("revalidates and atomically reserves every public booking", async () => {
  const [availabilityApi, bookingApi, schema, page] = await Promise.all([
    readFile(new URL("../app/api/availability/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(availabilityApi, /loadAvailability/);
  assert.match(bookingApi, /availability\.slots\.find/);
  assert.match(bookingApi, /buildReservationRows/);
  assert.match(bookingApi, /await db\.batch/);
  assert.match(schema, /appointment_reservations_resource_segment_unique/);
  assert.match(page, /\/api\/availability\?serviceId=/);
  assert.match(page, /team skills, working hours, equipment/);
  assert.doesNotMatch(page, /const timeSlots/);
});

test("ships a private pet-parent portal with rotating hashed access", async () => {
  const [helper, exchange, requestLink, portalApi, portalView, bookingApi, communications] = await Promise.all([
    readFile(new URL("../db/client-portal.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/access/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/request-link/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/[token]/portal-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/communications.ts", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(helper, /tokenHash: await sha256\(token\)/);
  assert.doesNotMatch(helper, /token:\s*text\(/);
  assert.match(exchange, /isNull\(clientPortalSessions\.revokedAt\)/);
  assert.match(exchange, /__Host-pet_portal=/);
  assert.match(exchange, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(requestLink, /recentEmail\.length >= 3 \|\| recentSource\.length >= 10/);
  assert.match(requestLink, /If that email matches a client account/);
  assert.match(portalApi, /appointment\.canCancel/);
  assert.match(portalApi, /excludeAppointmentId: appointment\.id/);
  assert.match(portalApi, /await db\.batch/);
  assert.match(portalApi, /appointmentChangeClaims/);
  assert.doesNotMatch(portalApi, /handlingNotes|internalNotes/);
  for (const feature of [/My pets/, /Vaccinations/, /Visit history/, /Reschedule/, /Care preferences/]) assert.match(portalView, feature);
  assert.match(bookingApi, /issuePortalSession/);
  assert.match(bookingApi, /portalAccessUrl/);
  assert.match(communications, /portal_access/);
  assert.match(communications, /portal_url/);
});

test("protects vaccination documents and gives salon staff a review workflow", async () => {
  const [clientUpload, clientDocument, staffReview, staffDocument, clientApi, workspace] = await Promise.all([
    readFile(new URL("../app/api/portal/[token]/vaccinations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vaccinations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vaccinations/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(clientUpload, /isAllowedVaccineDocument/);
  assert.match(clientUpload, /file\.size > 4 \* 1024 \* 1024/);
  assert.match(clientDocument, /eq\(pets\.clientId, access\.client\.id\)/);
  assert.match(clientDocument, /Verified records are locked/);
  assert.match(staffReview, /vaccination\.\$\{status\}/);
  assert.match(staffDocument, /requireSalonAccess\(\)/);
  for (const source of [clientDocument, staffDocument]) assert.match(source, /private, no-store/);
  assert.match(clientApi, /vaccinationRecords/);
  assert.match(workspace, /reviewVaccination/);
});

test("recovers unavailable demand with a preference-aware atomic waitlist", async () => {
  const { addCalendarDays, waitlistDates, matchesWaitlistTime, validWaitlistWindow } = await import("../lib/waitlist.ts");
  assert.equal(addCalendarDays("2026-07-31", 1), "2026-08-01");
  assert.deepEqual(waitlistDates("2026-07-20", "2026-07-22"), ["2026-07-20", "2026-07-21", "2026-07-22"]);
  assert.equal(matchesWaitlistTime("2026-07-20T15:30:00.000Z", "morning", "America/Toronto"), true);
  assert.equal(matchesWaitlistTime("2026-07-20T16:00:00.000Z", "morning", "America/Toronto"), false);
  assert.equal(matchesWaitlistTime("2026-07-20T16:00:00.000Z", "afternoon", "America/Toronto"), true);
  assert.equal(validWaitlistWindow("2026-07-20", "2026-08-03", "2026-07-14", "2026-12-01"), true);
  assert.equal(validWaitlistWindow("2026-07-20", "2026-08-04", "2026-07-14", "2026-12-01"), false);
  const [publicApi, manageApi, page, view, schema] = await Promise.all([
    readFile(new URL("../app/api/waitlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/waitlist/manage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/waitlist-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(publicApi, /contactConsent/);
  assert.match(publicApi, /attempts\.length >= 10/);
  assert.match(publicApi, /waitlist_availability_contact/);
  assert.match(publicApi, /queueClientTemplateMessage/);
  assert.match(manageApi, /requireWaitlistAccess\(membership\.role\)/);
  assert.match(manageApi, /already moved to another state/);
  assert.match(manageApi, /buildReservationRows/);
  assert.match(manageApi, /waitlistConversionClaims/);
  assert.match(manageApi, /await db\.batch/);
  assert.match(schema, /waitlist_active_pet_service_unique/);
  assert.match(page, /Join priority list/);
  assert.match(view, /Live matches/);
});

test("ships consent-safe provider delivery with scheduling and duplicate-send protection", async () => {
  const { emailHtml, normalizeNorthAmericanPhone, resendRequest, twilioRequest } = await import("../lib/message-provider-payloads.ts");
  const config = {
    email: { configured: true, webhookConfigured: true, provider: "resend", apiKey: "re_test", from: "Coat & Care <hello@example.com>", replyTo: "salon@example.com" },
    sms: { configured: true, webhookConfigured: true, provider: "twilio", accountSid: `AC${"a".repeat(32)}`, authToken: "secret", messagingServiceSid: `MG${"b".repeat(32)}`, callbackUrl: "https://coat-care.example/api/webhooks/twilio" },
  };
  assert.equal(normalizeNorthAmericanPhone("(416) 555-0123"), "+14165550123");
  assert.equal(normalizeNorthAmericanPhone("1-212-555-0199"), "+12125550199");
  assert.equal(normalizeNorthAmericanPhone("12345"), null);
  assert.match(emailHtml("Hi <Milo> & friends"), /Hi &lt;Milo&gt; &amp; friends/);
  const message = { id: "message-1", recipientAddress: "client@example.com", subject: "Milo is booked", body: "See you soon", scheduledFor: "2026-07-20T15:00:00.000Z", deliveryAttempts: 0 };
  const email = resendRequest(message, config, new Date("2026-07-19T15:00:00.000Z"));
  assert.equal(email.scheduled, true);
  assert.equal(email.url, "https://api.resend.com/emails");
  assert.equal(email.init.headers["idempotency-key"], "coat-care:message-1");
  assert.equal(JSON.parse(email.init.body).scheduled_at, "2026-07-20T15:00:00.000Z");
  const sms = twilioRequest({ ...message, recipientAddress: "416-555-0123" }, config, new Date("2026-07-19T15:00:00.000Z"));
  assert.equal(sms.scheduled, true);
  const smsBody = new URLSearchParams(sms.init.body);
  assert.equal(smsBody.get("To"), "+14165550123");
  assert.equal(smsBody.get("ScheduleType"), "fixed");
  assert.equal(smsBody.get("SendAt"), "2026-07-20T15:00:00.000Z");
  assert.equal(smsBody.get("StatusCallback"), "https://coat-care.example/api/webhooks/twilio");
  assert.equal(twilioRequest({ ...message, recipientAddress: "416-555-0123", scheduledFor: "2026-07-19T15:05:00.000Z" }, config, new Date("2026-07-19T15:00:00.000Z")), null);
  const [delivery, dispatchApi, messagesApi, communications, view, schema, exampleEnv] = await Promise.all([
    readFile(new URL("../lib/message-delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/communications.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(delivery, /status: "processing"/);
  assert.match(delivery, /eq\(messages\.updatedAt, message\.updatedAt\)/);
  assert.match(delivery, /message\.accepted_by_provider/);
  assert.match(delivery, /message\.scheduled_with_provider/);
  assert.match(delivery, /Marketing consent is not active/);
  assert.match(dispatchApi, /requireSalonAccess\(\)/);
  assert.match(dispatchApi, /limit\(30\)/);
  assert.match(messagesApi, /cancelProviderMessage/);
  assert.match(messagesApi, /not currently opted into marketing/);
  assert.match(communications, /dispatchMessage\(db, created\.id\)/);
  assert.match(communications, /Provider cancellation failed/);
  assert.match(view, /Live delivery is active/);
  assert.match(view, /Provider accepted/);
  assert.match(schema, /delivery_attempts/);
  for (const key of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"]) assert.match(exampleEnv, new RegExp(key));
});

test("reconciles signed provider outcomes and sweeps due communications unattended", async () => {
  const { verifyResendWebhook, verifyTwilioWebhook } = await import("../lib/message-webhook-signatures.ts");
  const rawSecret = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;
  const payload = JSON.stringify({ type: "email.delivered", created_at: "2026-07-14T12:00:00.000Z", data: { email_id: "email_123" } });
  const id = "msg_provider_event_123", timestamp = String(Math.floor(new Date("2026-07-14T12:00:00.000Z").getTime() / 1000)), signed = `${id}.${timestamp}.${payload}`;
  const resendKey = await crypto.subtle.importKey("raw", rawSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const resendDigest = await crypto.subtle.sign("HMAC", resendKey, new TextEncoder().encode(signed));
  const resendSignature = `v1,${Buffer.from(resendDigest).toString("base64")}`;
  assert.equal(await verifyResendWebhook({ payload, id, timestamp, signature: resendSignature, secret, now: new Date("2026-07-14T12:00:00.000Z") }), true);
  assert.equal(await verifyResendWebhook({ payload: `${payload} `, id, timestamp, signature: resendSignature, secret, now: new Date("2026-07-14T12:00:00.000Z") }), false);
  assert.equal(await verifyResendWebhook({ payload, id, timestamp, signature: resendSignature, secret, now: new Date("2026-07-14T12:06:00.000Z") }), false);

  const twilioUrl = "https://coat-care.example/api/webhooks/twilio", twilioToken = "twilio-primary-auth-token";
  const twilioParams = new URLSearchParams({ AccountSid: `AC${"a".repeat(32)}`, MessageSid: `SM${"b".repeat(32)}`, MessageStatus: "delivered", ErrorCode: "" });
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const sorted = [...twilioParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => compare(aKey, bKey) || compare(aValue, bValue));
  const twilioContent = sorted.reduce((value, [key, item]) => `${value}${key}${item}`, twilioUrl);
  const twilioKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(twilioToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const twilioDigest = await crypto.subtle.sign("HMAC", twilioKey, new TextEncoder().encode(twilioContent));
  const twilioSignature = Buffer.from(twilioDigest).toString("base64");
  assert.equal(await verifyTwilioWebhook({ url: twilioUrl, params: twilioParams, signature: twilioSignature, authToken: twilioToken }), true);
  twilioParams.set("MessageStatus", "failed");
  assert.equal(await verifyTwilioWebhook({ url: twilioUrl, params: twilioParams, signature: twilioSignature, authToken: twilioToken }), false);

  const [resendRoute, twilioRoute, signatures, webhooks, delivery, payloads, operationsCron, vercel, schema, communications, envExample] = await Promise.all([
    readFile(new URL("../app/api/webhooks/resend/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/twilio/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/message-webhook-signatures.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/message-webhooks.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/message-delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/message-provider-payloads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(resendRoute, /await request\.text\(\)/);
  assert.match(resendRoute, /verifyResendWebhook/);
  assert.match(twilioRoute, /x-twilio-signature/);
  assert.match(twilioRoute, /AccountSid/);
  assert.match(signatures, /Math\.abs\(now - seconds\) > 300/);
  assert.match(webhooks, /deliveryProviderEvents/);
  assert.match(webhooks, /ne\(messages\.status, "delivered"\)/);
  assert.match(webhooks, /inArray\(messages\.status, \["action_required", "scheduled", "processing", "sent"\]\)/);
  assert.match(webhooks, /message\.provider_/);
  assert.match(delivery, /sweepDueMessages/);
  assert.match(delivery, /message\.recipient_blocked/);
  assert.match(payloads, /StatusCallback/);
  assert.match(operationsCron, /sweepDueMessages/);
  assert.match(operationsCron, /Bearer \$\{secret\}/);
  assert.match(vercel, /\*\/15 \* \* \* \*/);
  assert.match(schema, /deliveryProviderEvents/);
  assert.match(schema, /emailDeliverability/);
  assert.match(schema, /deliveredAt/);
  assert.match(communications, /verified outcomes/);
  assert.match(communications, /verify_recipient_and_retry/);
  for (const key of ["RESEND_WEBHOOK_SECRET", "DELIVERY_PUBLIC_URL"]) assert.match(envExample, new RegExp(key));
});

test("ships tenant-safe hosted payments, payouts, and subscription billing", async () => {
  const [stripe, checkout, ledger, connect, billing, webhook, schema, view, settings, exampleEnv] = await Promise.all([
    readFile(new URL("../lib/stripe.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payments/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/connect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/billing/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/financial-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(stripe, /Idempotency-Key/);
  assert.match(stripe, /Math\.abs\(nowSeconds - timestamp\) > 300/);
  assert.match(stripe, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(checkout, /requireWorkspacePermission\(membership, "checkout"\)/);
  assert.match(checkout, /eq\(appointments\.organizationId, membership\.organizationId\)/);
  assert.match(checkout, /Stripe-Account|account: account\.connectedAccountId/);
  assert.match(checkout, /payment_intent_data\[application_fee_amount/);
  assert.match(connect, /requireSalonOwner\(membership\)/);
  assert.match(connect, /type: "account_onboarding"/);
  assert.match(billing, /mode: "subscription"/);
  assert.match(billing, /billing_portal\/sessions/);
  assert.match(webhook, /verifyStripeSignature\(payload, signature\)/);
  assert.match(webhook, /providerWebhookEvents/);
  assert.match(webhook, /onConflictDoNothing\(\)/);
  assert.match(webhook, /payment\.online_succeeded/);
  assert.match(webhook, /refund\.updated/);
  assert.match(ledger, /refund_application_fee/);
  assert.match(ledger, /refundStatus: "pending" \| "succeeded"/);
  for (const table of ["paymentProviderAccounts", "onlinePaymentSessions", "providerWebhookEvents", "organizationSubscriptions"]) assert.match(schema, new RegExp(table));
  assert.match(view, /Collect full balance online/);
  assert.match(view, /Collect.*deposit online/);
  assert.match(settings, /Payments & plan/);
  assert.match(settings, /Manual cash, terminal, e-transfer/);
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_STARTER_PRICE_ID", "STRIPE_GROWTH_PRICE_ID", "STRIPE_MULTI_PRICE_ID"]) assert.match(exampleEnv, new RegExp(key));
});

test("confirms required booking deposits only from verified payment events and releases abandoned holds", async () => {
  const [booking, holds, webhook, appointmentsApi, dashboard, workspace, schema, settingsApi, settingsView, bookingView, paymentPage, catalog, pilot] = await Promise.all([
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/booking-holds.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/booking/payment/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pilot.ts", import.meta.url), "utf8"),
  ]);
  assert.match(booking, /depositRequired \|\| settings\.bookingMode === "request" \? "requested" : "confirmed"/);
  assert.match(booking, /"payment_method_types\[0\]": "card"/);
  assert.match(booking, /booking-deposit:\$\{appointmentId\}/);
  assert.match(booking, /10 \* 60_000/);
  assert.match(booking, /checkout\/sessions\/\$\{providerSessionId\}\/expire/);
  assert.match(booking, /db\.delete\(appointmentReservations\)/);
  assert.match(holds, /lte\(appointments\.depositDueAt/);
  assert.match(holds, /returning\(\{ id: appointments\.id \}\)/);
  assert.match(holds, /If payment won the race, no reservation is touched/);
  assert.match(holds, /booking\.deposit_hold_expired/);
  assert.match(webhook, /booking\.deposit_confirmed/);
  assert.match(webhook, /late-deposit-refund/);
  assert.match(webhook, /releaseDepositSession/);
  assert.match(webhook, /Deposit state changed during confirmation/);
  assert.match(webhook, /issuePortalEmailSession/);
  assert.match(appointmentsApi, /awaiting its required deposit/);
  assert.match(appointmentsApi, /waive_deposit/);
  assert.match(appointmentsApi, /checkout\/sessions\/\$\{session\.providerSessionId\}\/expire/);
  assert.match(dashboard, /depositStatus: appointments\.depositStatus/);
  assert.match(workspace, /Waive & confirm/);
  assert.match(schema, /requireOnlineDeposit/);
  assert.match(schema, /depositStatus/);
  assert.match(settingsApi, /verified webhooks before requiring online booking deposits/);
  assert.match(settingsView, /Require the service deposit online/);
  assert.match(bookingView, /Continue to.*deposit/);
  assert.match(paymentPage, /Only verified payment confirms the booking/);
  assert.match(catalog, /requireOnlineDeposit/);
  assert.match(pilot, /booking_deposit_required/);
});

test("calculates salon books without mixing tax, tips, capital, or personal use into operating profit", async () => {
  const { expenseBookValues, summarizeBooks, summarizePayments, toCsv } = await import("../lib/accounting.ts");
  const payments = [
    { kind: "payment", method: "cash", amountCents: 11300, taxAmountCents: 1300, tipAmountCents: 1000 },
    { kind: "refund", method: "cash", amountCents: 5650, taxAmountCents: 650, tipAmountCents: 500 },
  ];
  const paymentSummary = summarizePayments(payments);
  assert.equal(paymentSummary.netCollectedCents, 5650);
  assert.equal(paymentSummary.netSalesCents, 4500);
  assert.equal(paymentSummary.salesTaxCents, 650);
  assert.equal(paymentSummary.tipsCents, 500);
  assert.equal(paymentSummary.byMethod.cash, 5650);

  const operating = { amountCents: 11300, taxAmountCents: 1300, recoverableTax: true, businessUseBps: 5000, treatment: "operating" };
  assert.deepEqual(expenseBookValues(operating), { businessAmountCents: 5650, inputTaxCreditCents: 650, operatingExpenseCents: 5000, capitalPurchaseCents: 0, nonDeductibleCents: 0 });
  const capital = { amountCents: 22600, taxAmountCents: 2600, recoverableTax: true, businessUseBps: 10000, treatment: "capital" };
  assert.deepEqual(expenseBookValues(capital), { businessAmountCents: 22600, inputTaxCreditCents: 2600, operatingExpenseCents: 0, capitalPurchaseCents: 20000, nonDeductibleCents: 0 });
  const books = summarizeBooks(payments, [operating, capital]);
  assert.equal(books.estimatedOperatingProfitCents, -500);
  assert.equal(books.estimatedNetTaxCents, -2600);
  assert.equal(books.capitalPurchasesCents, 20000);

  const csv = toCsv(["Vendor", "Note", "Amount"], [["=HYPERLINK(\"https://bad.example\")", "line one\nline two", -12.5]]);
  assert.match(csv, /^Vendor,Note,Amount\r\n"'=HYPERLINK/);
  assert.match(csv, /"line one\nline two",-12\.5\r\n$/);
});

test("ships tenant-safe expense books, private receipt evidence, exports, and auditable daily closeouts", async () => {
  const [accounting, receipts, receipt, exportRoute, finance, access, schema, view] = await Promise.all([
    readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/receipts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/receipts/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/accounting-view.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [accounting, receipts, receipt, exportRoute, finance]) {
    assert.match(source, /membership\.organizationId/);
    assert.match(source, /membership\.locationId/);
  }
  assert.match(access, /requireBookkeepingAccess/);
  assert.match(accounting, /requireBookkeepingAccess\(membership\)/);
  assert.match(accounting, /onConflictDoNothing\(\)/);
  assert.match(accounting, /idempotencyKey/);
  assert.match(accounting, /eq\(expenses\.status, "posted"\)/);
  assert.match(accounting, /Future expenses belong in payables/);
  assert.match(receipts, /isAllowedVaccineDocument/);
  assert.match(receipts, /mediaStore\.put/);
  assert.match(receipt, /cache-control.*private, no-store/);
  assert.match(exportRoute, /content-disposition/);
  assert.match(exportRoute, /private, no-store/);
  assert.match(schema, /expenses_org_idempotency_unique/);
  assert.match(schema, /daily_closeouts_location_date_unique/);
  assert.match(finance, /eq\(dailyCloseouts\.status, "reopened"\)/);
  assert.match(finance, /eq\(dailyCloseouts\.status, "closed"\)/);
  assert.match(finance, /future business day cannot be closed/i);
  assert.match(view, /Exporter CSV/);
  assert.match(view, /Photo du reçu/);
  assert.match(view, /confirmez l’admissibilité des crédits/i);
});

test("ships an integrated multi-location bookkeeping planner with Quebec tax and CSV account imports", async () => {
  const [accounting, accounts, schema, view, migration] = await Promise.all([
    readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/accounts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/accounting-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_ambiguous_moondragon.sql", import.meta.url), "utf8"),
  ]);
  assert.match(accounting, /scope === "all"/); assert.match(accounting, /gstCollectedCents/); assert.match(accounting, /qstCollectedCents/); assert.match(accounting, /byLocation/); assert.match(accounting, /timeline/);
  assert.match(accounts, /Banque Desjardins/); assert.match(accounts, /Square/); assert.match(accounts, /financial_transactions\.imported/); assert.match(accounts, /onConflictDoNothing/); assert.match(accounts, /rows\.length > 2_000/);
  assert.match(schema, /financial_accounts_org_name_unique/); assert.match(schema, /financial_transactions_account_hash_unique/); assert.match(schema, /gstAmountCents/); assert.match(schema, /qstAmountCents/);
  assert.match(migration, /CREATE TABLE "financial_accounts"/); assert.match(migration, /"gst_amount_cents" integer DEFAULT 0 NOT NULL/);
  assert.match(view, /Planificateur comptable/); assert.match(view, /Tous les emplacements/); assert.match(view, /Importer un CSV/); assert.match(view, /TPS \/ TVQ/); assert.match(view, /capture="environment"/);
});

test("rebuilds inventory quantity and value from immutable movements and generates practical reorder quantities", async () => {
  const { displayQuantity, movementCost, movementCostSign, quantityMilli, reorderQuantity, stockPosition } = await import("../lib/inventory.ts");
  assert.equal(quantityMilli(2.375), 2375);
  assert.equal(displayQuantity(2375), 2.375);
  assert.equal(movementCost(2500, 4200), 10500);
  assert.equal(movementCostSign({ quantityDeltaMilli: -1000, totalCostCents: 533 }), -533);
  const movements = [
    { kind: "opening", quantityDeltaMilli: 10000, unitCostCents: 500, totalCostCents: 5000, occurredAt: "2026-06-01T12:00:00.000Z" },
    { kind: "purchase", quantityDeltaMilli: 5000, unitCostCents: 600, totalCostCents: 3000, occurredAt: "2026-07-02T12:00:00.000Z" },
    { kind: "retail_sale", quantityDeltaMilli: -4000, unitCostCents: 533, totalCostCents: 2132, occurredAt: "2026-07-04T12:00:00.000Z" },
    { kind: "usage", quantityDeltaMilli: -2000, unitCostCents: 533, totalCostCents: 1066, occurredAt: "2026-07-05T12:00:00.000Z" },
    { kind: "waste", quantityDeltaMilli: -1000, unitCostCents: 533, totalCostCents: 533, occurredAt: "2026-07-06T12:00:00.000Z" },
  ];
  assert.deepEqual(stockPosition(movements, "2026-07-01", "2026-08-01"), { quantityOnHandMilli: 8000, inventoryValueCents: 4269, averageUnitCostCents: 534, purchaseCostCents: 3000, usageCostCents: 1066, retailCogsCents: 2132, wasteCostCents: 533 });
  assert.equal(reorderQuantity(1500, 2000, 8000, 6000), 6500);
  assert.equal(reorderQuantity(2500, 2000, 8000, 6000), 0);
});

test("ships tenant-safe concurrent inventory, purchasing, supplier, audit, and export workflows", async () => {
  const [inventory, orders, exportRoute, access, schema, view, workspace] = await Promise.all([
    readFile(new URL("../app/api/inventory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/orders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/inventory/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/inventory-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [inventory, orders, exportRoute]) {
    assert.match(source, /membership\.organizationId/);
    assert.match(source, /membership\.locationId/);
  }
  assert.match(access, /requireInventoryAccess/);
  assert.match(access, /requireInventoryManagement/);
  assert.match(access, /requireInventoryMovementAccess/);
  assert.match(inventory, /idempotencyKey/);
  assert.match(inventory, /Future stock movements are not allowed/);
  assert.match(inventory, /Only.*is available/);
  assert.match(inventory, /inventoryMovementClaims/);
  assert.match(inventory, /eq\(inventoryItems\.stockVersion, item\.stockVersion\)/);
  assert.match(orders, /eq\(purchaseOrders\.status, "ordered"\)/);
  assert.match(orders, /db\.batch\(\[/);
  assert.match(orders, /inventoryMovementClaims/);
  assert.match(orders, /purchase_order_received/);
  assert.match(schema, /inventory_items_location_sku_unique/);
  assert.match(schema, /inventory_items_location_barcode_unique/);
  assert.match(schema, /inventory_movements_org_idempotency_unique/);
  assert.match(schema, /inventory_movement_claims_item_version_unique/);
  assert.match(schema, /purchase_orders_org_idempotency_unique/);
  assert.match(schema, /purchase_order_claims_order_version_unique/);
  assert.match(exportRoute, /private, no-store/);
  assert.match(exportRoute, /toCsv/);
  assert.match(view, /Reorder radar/);
  assert.match(view, /Receive delivery/);
  assert.match(view, /physical count/i);
  assert.match(view, /data\.disclaimer/);
  assert.match(inventory, /year-end counts, valuation method/i);
  assert.match(workspace, /Inventory & purchasing/);
});

test("calculates paid time, weekly overtime, salary proration, commissions, and tip payout deterministically", async () => {
  const { paidMinutes, splitWeeklyMinutes, calculateGross } = await import("../lib/payroll.ts");
  assert.equal(paidMinutes("2026-07-05T09:00:00.000Z", "2026-07-05T17:30:00.000Z", 30), 480);
  assert.throws(() => paidMinutes("2026-07-05T17:00:00.000Z", "2026-07-05T09:00:00.000Z", 0));
  const entries = Array.from({ length: 6 }, (_, day) => ({ clockIn: `2026-07-${String(5 + day).padStart(2, "0")}T09:00:00.000Z`, clockOut: `2026-07-${String(5 + day).padStart(2, "0")}T17:00:00.000Z`, breakMinutes: 0 }));
  assert.deepEqual(splitWeeklyMinutes(entries, 2400, true), { regularMinutes: 2400, overtimeMinutes: 480 });
  assert.deepEqual(calculateGross({ payType: "hourly", hourlyRateCents: 2500, annualSalaryCents: 0, overtimeEligible: true, weeklyOvertimeMinutes: 2400, overtimeMultiplierBps: 15000, serviceCommissionBps: 1000, retailCommissionBps: 0, currency: "CAD" }, 2400, 480, 7, 30000, 5000), { regularPayCents: 100000, overtimePayCents: 30000, serviceCommissionCents: 3000, grossPayCents: 133000, payoutCents: 138000 });
  assert.equal(calculateGross({ payType: "salary", hourlyRateCents: 0, annualSalaryCents: 7300000, overtimeEligible: false, weeklyOvertimeMinutes: 2400, overtimeMultiplierBps: 15000, serviceCommissionBps: 0, retailCommissionBps: 0, currency: "USD" }, 0, 0, 14, 0, 0).grossPayCents, 280000);
});

test("ships tenant-safe auditable workforce, compensation, payroll approval, and private export workflows", async () => {
  const [workforce, payroll, exportRoute, access, schema, view, workspace, payrollLib] = await Promise.all([
    readFile(new URL("../app/api/workforce/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payroll/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payroll/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/workforce-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/payroll.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [workforce, payroll, exportRoute]) { assert.match(source, /membership\.organizationId/); assert.match(source, /membership\.locationId/); }
  assert.match(access, /requirePayrollAccess/); assert.match(access, /requirePayrollManagement/);
  assert.match(workforce, /staffClockStates/); assert.match(workforce, /timeClockClaims/); assert.match(workforce, /db\.batch\(\[/); assert.match(workforce, /eq\(staffClockStates\.version, state\.version\)/); assert.match(workforce, /timeEntryAdjustments/); assert.match(workforce, /idempotencyKey/); assert.match(workforce, /auditEvents/);
  assert.match(payroll, /eq\(timeEntries\.status, "approved"\)/); assert.match(payroll, /compensationSnapshotJson/); assert.match(payroll, /Approve or reject every submitted time entry/); assert.match(payroll, /payment\.kind === "refund"/); assert.match(payroll, /days\)\) throw new SalonAccessError/);
  assert.match(schema, /compensation_staff_effective_unique/); assert.match(schema, /time_entries_org_idempotency_unique/); assert.match(schema, /staff_clock_state_unique/); assert.match(schema, /time_clock_claim_staff_version_unique/); assert.match(schema, /payroll_period_location_dates_unique/); assert.match(schema, /payroll_line_period_staff_unique/);
  assert.match(exportRoute, /private, no-store/); assert.match(exportRoute, /content-disposition/);
  assert.match(payrollLib, /Gross-pay operations only/); assert.match(view, /Correct time without erasing history/); assert.match(view, /Export payroll CSV/); assert.match(workspace, /Workforce & payroll/);
});

test("ships secure employee PIN invitations and locked multi-location weekly timesheets", async () => {
  const { hashPin, verifyPin } = await import("../lib/employee-crypto.ts");
  const [auth, session, employeeSheet, managerSheet, exportRoute, schema, employeeView, managerView] = await Promise.all([
    readFile(new URL("../lib/employee-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/timesheet/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/timesheets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/timesheets/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/employee/employee-portal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/weekly-timesheets-admin.tsx", import.meta.url), "utf8"),
  ]);
  const cryptoSource = await readFile(new URL("../lib/employee-crypto.ts", import.meta.url), "utf8"); assert.match(cryptoSource, /PBKDF2/); assert.match(cryptoSource, /EMPLOYEE_PIN_ITERATIONS = 100_000/); assert.match(auth, /httpOnly: true/); assert.match(auth, /sameSite: "lax"/); assert.match(auth, /sha256\(token\)/);
  const credential = await hashPin("482951"); assert.equal(await verifyPin("482951", credential.salt, credential.hash), true); assert.equal(await verifyPin("482952", credential.salt, credential.hash), false);
  assert.match(session, /failedAttempts/); assert.match(session, /lockedUntil/); assert.match(session, /15 \* 60000/); assert.match(session, /employee_portal\.activated/);
  assert.match(employeeSheet, /requireEmployeeSession/); assert.match(employeeSheet, /employeeLocations/); assert.match(employeeSheet, /staffLocations/); assert.match(employeeSheet, /week\.status !== "draft"/); assert.match(employeeSheet, /timesheet\.week_submitted/); assert.match(employeeSheet, /Two shifts overlap/);
  assert.match(managerSheet, /requireSalonManager/); assert.match(managerSheet, /membership\.organizationId/); assert.match(managerSheet, /timesheet\.week_corrected/); assert.match(managerSheet, /timesheet\.week_reopened/); assert.match(managerSheet, /timesheet\.week_approved_materialized/);
  assert.match(exportRoute, /application\/pdf/); assert.match(exportRoute, /text\/csv/); assert.match(exportRoute, /content-disposition/);
  assert.match(schema, /employee_portal_staff_unique/); assert.match(schema, /employee_portal_code_unique/); assert.match(schema, /timesheet_week_staff_start_unique/);
  assert.match(employeeView, /Soumettre ma semaine/); assert.match(employeeView, /Ajouter un quart/); assert.match(managerView, /create private setup links from Team/); assert.match(managerView, /Save correction/);
});

test("creates each operational role and administrators with server-enforced workspace access", async () => {
  const [teamApi, teamView, access, permissions, schema, workspace, migration] = await Promise.all([
    readFile(new URL("../app/api/team/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/business-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/salon-permissions.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_ambiguous_moondragon.sql", import.meta.url), "utf8"),
  ]);
  assert.match(teamApi, /\["manager", "receptionist", "groomer", "bather", "accountant"\]/); assert.match(teamApi, /role === "manager" && membership\.role !== "owner"/); assert.match(teamApi, /employeePortalInvitations/); assert.match(teamApi, /permissionsJson: JSON\.stringify\(permissions\)/);
  assert.match(teamView, /Add a team member/); assert.match(teamView, /Groomer/); assert.match(teamView, /Bather/); assert.match(teamView, /Receptionist/); assert.match(teamView, /Administrator/); assert.match(teamView, /Create and send invitation/);
  assert.match(access, /requireWorkspacePermission/); assert.match(access, /parsePermissions/); assert.match(permissions, /WORKSPACE_PERMISSIONS/); assert.match(permissions, /Appointments & calendar/);
  assert.match(schema, /permissionsJson: text\("permissions_json"\)/); assert.match(migration, /"permissions_json" text/); assert.match(workspace, /hasAccess\("team"\)/);
});

test("derives owner metrics from signed ledgers, capacity, client history, and recorded costs", async () => {
  const { signedNetSale, rate, change, summarizeOperations, buildInsights } = await import("../lib/owner-analytics.ts");
  const current = [
    { id: "a1", clientId: "c1", petId: "p1", serviceId: "s1", serviceName: "Full groom", staffId: "u1", staffName: "Maya", status: "completed", startsAt: "2026-07-05T09:00:00.000Z", endsAt: "2026-07-05T10:00:00.000Z" },
    { id: "a2", clientId: "c2", petId: "p2", serviceId: "s1", serviceName: "Full groom", staffId: "u1", staffName: "Maya", status: "cancelled", startsAt: "2026-07-06T09:00:00.000Z", endsAt: "2026-07-06T10:00:00.000Z" },
  ];
  const all = [{ ...current[0], id: "old", startsAt: "2026-01-01T09:00:00.000Z", endsAt: "2026-01-01T10:00:00.000Z" }, ...current, { ...current[0], id: "future", startsAt: "2026-08-01T09:00:00.000Z", endsAt: "2026-08-01T10:00:00.000Z", status: "confirmed" }];
  const payments = [{ appointmentId: "a1", kind: "payment", amountCents: 12000, taxAmountCents: 1000, tipAmountCents: 1000, occurredAt: "2026-07-05T10:00:00.000Z" }, { appointmentId: "a1", kind: "refund", amountCents: 2000, taxAmountCents: 0, tipAmountCents: 0, occurredAt: "2026-07-06T10:00:00.000Z" }];
  assert.equal(signedNetSale(payments[0]), 10000); assert.equal(signedNetSale(payments[1]), -2000); assert.equal(rate(1, 4), 2500); assert.equal(change(125, 100), 2500); assert.equal(change(100, 0), null);
  const metrics = summarizeOperations({ appointments: current, allAppointments: all, payments, availableMinutesByStaff: new Map([["u1", 600]]), grossPayrollCents: 2000, operatingExpenseCents: 1000, inventoryCostCents: 500 });
  assert.equal(metrics.netSalesCents, 8000); assert.equal(metrics.averageTicketCents, 8000); assert.equal(metrics.settledTickets, 1); assert.equal(metrics.utilizationBps, 1000); assert.equal(metrics.retentionBps, 10000); assert.equal(metrics.rebookingBps, 10000); assert.equal(metrics.laborBps, 2500); assert.equal(metrics.contributionCents, 4500); assert.equal(metrics.contributionMarginBps, 5625);
  assert.ok(buildInsights(metrics, { ...metrics, netSalesCents: 4000 }).length > 0);
});

test("ships private decision-grade owner intelligence with comparisons, unit economics, and safe exports", async () => {
  const [reports, exportRoute, analytics, view, access, workspace] = await Promise.all([
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/export/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/owner-analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/business-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/salon-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(reports, /requireBookkeepingAccess\(membership\)/); assert.match(access, /requireBookkeepingAccess/); assert.match(reports, /membership\.organizationId/); assert.match(reports, /permittedIds/); assert.match(reports, /inArray\(.*locationId, permittedIds\)/); assert.match(reports, /zonedDayBounds/); assert.match(reports, /previousFrom/); assert.match(reports, /paymentEvents\.status, "succeeded"/); assert.match(reports, /\["approved", "exported"\]/); assert.match(reports, /expenseBookValues/); assert.match(reports, /\["usage", "retail_sale", "waste"\]/); assert.match(reports, /locationComparison/);
  assert.match(analytics, /signedNetSale/); assert.match(analytics, /retentionBps/); assert.match(analytics, /rebookingBps/); assert.match(analytics, /contributionMarginBps/); assert.match(analytics, /buildInsights/);
  assert.match(exportRoute, /toCsv/); assert.match(exportRoute, /private, no-store/); assert.match(exportRoute, /content-disposition/);
  assert.match(view, /Know what is growing—and what is leaking/); assert.match(view, /Recorded contribution/); assert.match(view, /Team economics/); assert.match(view, /Service economics/); assert.match(view, /Location scoreboard/); assert.match(view, /data\.disclaimer/); assert.match(workspace, /Intelligence/);
});
