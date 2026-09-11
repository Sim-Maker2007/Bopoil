import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("quick booking resolves tenant-owned clients and pets without silently merging new profiles", async () => {
  const [route, modal] = await Promise.all([
    source("../app/api/appointments/route.ts"),
    source("../app/salon/quick-booking-modal.tsx"),
  ]);
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));

  assert.match(route, /url\.searchParams\.has\("clientQuery"\)/);
  assert.match(route, /eq\(clients\.organizationId, membership\.organizationId\)/);
  assert.match(post, /eq\(pets\.clientId, requestedClientId\)/);
  assert.match(post, /eq\(pets\.organizationId, membership\.organizationId\)/);
  assert.match(post, /eq\(sql<string>`lower\(\$\{clients\.email\}\)`, email\)/);
  assert.match(post, /right\(replace\(replace\(replace\(replace\(replace\(replace\(\$\{clients\.phone\}/);
  assert.match(post, /existing_client_selection_required/);
  assert.match(post, /addingPetToExisting/);
  assert.match(post, /newPetForExistingClient: addingPetToExisting/);
  assert.match(post, /const statements = \[\.\.\.prefix, appointmentInsert, \.\.\.reservationInsertStatements/);
  assert.doesNotMatch(post, /onConflictDoUpdate/);
  assert.match(modal, /clientId: selectedClient\?\.id, petId: selectedPetId/);
  assert.match(modal, /addPetToExisting: true/);
  assert.match(modal, /Add another pet/);
  assert.match(modal, /result\.code === "existing_client_selection_required"/);
  assert.match(modal, /Existing client/);
  assert.match(modal, /New client/);
});

test("staff availability pages through settings and walk-ins only override lead time on authenticated staff routes", async () => {
  const [route, availability, modal] = await Promise.all([
    source("../app/api/appointments/route.ts"),
    source("../db/availability.ts"),
    source("../app/salon/quick-booking-modal.tsx"),
  ]);

  assert.match(route, /const bookingWindowEnd = walkIn \? today : addDays\(today, probe\.settings\.bookingWindowDays\)/);
  assert.match(route, /if \(walkIn && date !== today\)/);
  assert.match(route, /Math\.min\(21,/);
  assert.doesNotMatch(route, /Math\.min\(21, probe\.settings\.bookingWindowDays \+ 1\)/);
  assert.match(route, /nextFrom: nextFrom <= bookingWindowEnd \? nextFrom : null/);
  assert.match(route, /requireSchedulingAccess\(membership\)/);
  assert.match(route, /minimumLeadMinutesOverride: walkIn \? 0 : undefined/);
  assert.match(availability, /options\.minimumLeadMinutesOverride == null/);
  assert.match(modal, /Load more dates/);
  assert.match(modal, /Walk-in here now/);
});

test("staff rescheduling claims the observed version and atomically replaces reservations", async () => {
  const [route, workspace] = await Promise.all([
    source("../app/api/appointments/route.ts"),
    source("../app/salon/salon-workspace.tsx"),
  ]);
  const reschedule = route.slice(route.indexOf('if (action === "reschedule")'), route.indexOf('if (action === "waive_deposit")'));

  assert.match(reschedule, /excludeAppointmentId: existing\.id/);
  assert.match(reschedule, /appointmentChangeClaims/);
  assert.match(reschedule, /and updated_at = \$\{existing\.updatedAt\}/);
  assert.match(reschedule, /db\.delete\(appointmentReservations\)/);
  assert.match(reschedule, /\.\.\.reservationInsertStatements\(db, reservationRows\)/);
  assert.match(reschedule, /appointment\.rescheduled_by_staff/);
  assert.match(workspace, /StaffReschedulePanel/);
  assert.match(workspace, /action: "reschedule"/);
});

test("operational roles can advance stages without receiving scheduling exceptions", async () => {
  const [route, workspace] = await Promise.all([
    source("../app/api/appointments/route.ts"),
    source("../app/salon/salon-workspace.tsx"),
  ]);

  assert.match(route, /operationalStageTargets/);
  assert.match(route, /\["owner", "manager", "receptionist", "groomer", "bather"\]/);
  assert.match(route, /requireSchedulingAccess\(membership\)/);
  assert.match(route, /existing\.staffId !== membership\.id/);
  assert.match(route, /Only the team member assigned to this appointment/);
  assert.match(workspace, /selectedAppointment\.staffId === data\.user\.id/);
  assert.match(workspace, /canOperateStages && operationalStageTargets\.has\(next\)/);
  assert.match(workspace, /canSchedule\s*&&[\s\S]*\["requested", "confirmed"\]\.includes\(appointment\.status\)/);
});

test("dashboard counts actionable messages and waitlist matches refresh after schedule changes", async () => {
  const [dashboard, workspace, waitlist] = await Promise.all([
    source("../app/api/dashboard/route.ts"),
    source("../app/salon/salon-workspace.tsx"),
    source("../app/salon/waitlist-view.tsx"),
  ]);

  assert.match(dashboard, /inArray\(messages\.status, \["action_required", "failed"\]\)/);
  assert.match(dashboard, /actionableMessages/);
  assert.match(workspace, /metrics\.actionableMessages/);
  assert.match(workspace, /salon:schedule-changed/);
  assert.match(waitlist, /window\.setInterval\(refresh, 30_000\)/);
  assert.match(waitlist, /window\.addEventListener\("salon:schedule-changed", refresh\)/);
  assert.match(waitlist, /onMatchedCount\?\.\(result\.summary\.matched\)/);
});

test("client directory issues a fresh tenant-owned short-lived portal link per click", async () => {
  const [route, workspace] = await Promise.all([
    source("../app/api/clients/route.ts"),
    source("../app/salon/salon-workspace.tsx"),
  ]);
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const post = route.slice(route.indexOf("export async function POST"));

  assert.match(post, /requireWorkspacePermission\(membership, "clients"\)/);
  assert.match(post, /requireSchedulingAccess\(membership\)/);
  assert.doesNotMatch(get, /requireSchedulingAccess\(membership\)/);
  assert.match(post, /eq\(clients\.organizationId, membership\.organizationId\)/);
  assert.match(post, /issuePortalEmailSession\(db, ownedClient\.id\)/);
  assert.match(post, /expiresInMinutes: 15/);
  assert.match(post, /"cache-control": "private, no-store"/);
  assert.match(workspace, /copyFreshPortalLink/);
  assert.match(workspace, /await copyToClipboard\(result\.portalUrl\)/);
  assert.match(workspace, /Fresh 15-minute portal link copied/);
});
