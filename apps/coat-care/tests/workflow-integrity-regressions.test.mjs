import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("one-time employee invitations and CRM invitations are claimed transactionally", async () => {
  const [employeeSession, salonAccess] = await Promise.all([
    source("../app/api/employee/session/route.ts"),
    source("../app/salon-access.ts"),
  ]);

  assert.match(employeeSession, /select organization_id from employee_portal_invitations/);
  assert.match(employeeSession, /used_at is null/);
  assert.match(employeeSession, /await db\.batch\(\[/);
  assert.match(employeeSession, /isNull\(employeePortalInvitations\.usedAt\)/);

  const invitationFlow = salonAccess.slice(salonAccess.indexOf("async function acceptInvitations"), salonAccess.indexOf("async function ensureBootstrapOwner"));
  assert.doesNotMatch(invitationFlow, /PILOT\.organizationId/);
  assert.doesNotMatch(salonAccess, /return requireSalonAccess\(\)/);
  assert.match(salonAccess, /guardedOrganizationId/);
  assert.match(salonAccess, /status = 'pending'/);
  assert.match(salonAccess, /onConflictDoUpdate/);
});

test("employee and manager timesheet replacement is revision-guarded and atomic", async () => {
  const [employee, manager] = await Promise.all([
    source("../app/api/employee/timesheet/route.ts"),
    source("../app/api/timesheets/route.ts"),
  ]);

  assert.match(employee, /Array\.from\(\{ length: 7 \}/);
  assert.match(employee, /timesheet\.week_saved/);
  assert.match(employee, /and revision = \$\{expectedRevision\}/);
  assert.match(employee, /const results = await db\.batch\(\[/);
  assert.match(manager, /const expectedRevision = Number\(body\.revision\)/);
  assert.match(manager, /guardOrganizationId/);
  assert.match(manager, /eq\(staffLocations\.locationId, membership\.locationId\)/);
  assert.match(manager, /eq\(timesheetShifts\.organizationId, membership\.organizationId\)/);
});

test("team skills are replaced only for the selected location", async () => {
  const team = await source("../app/api/team/route.ts");
  const removal = team.slice(team.indexOf("const removeSkills"), team.indexOf("const audit", team.indexOf("const removeSkills")));

  assert.match(team, /new Set\(days\.map\(\(day\) => day\.weekday\)\)\.size !== 7/);
  assert.match(removal, /eq\(staffServiceSkills\.organizationId, membership\.organizationId\)/);
  assert.match(removal, /eq\(staffServiceSkills\.locationId, membership\.locationId\)/);
  assert.match(removal, /eq\(staffServiceSkills\.staffId, staffId\)/);
  assert.match(team, /await db\.batch\(\[/);
});

test("appointment state changes claim the observed version and release reservations in the same batch", async () => {
  const appointments = await source("../app/api/appointments/route.ts");

  assert.match(appointments, /appointmentChangeClaims/);
  assert.match(appointments, /and updated_at = \$\{existing\.updatedAt\}/);
  assert.match(appointments, /eq\(appointments\.status, existing\.status\)/);
  assert.match(appointments, /eq\(appointments\.updatedAt, existing\.updatedAt\)/);
  assert.match(appointments, /db\.delete\(appointmentReservations\)/);
  assert.match(appointments, /This appointment changed\. Refresh and try again\./);
});

test("payroll uses salon-local boundaries and excludes tax and tips from commission revenue", async () => {
  const [payrollRoute, payrollLib] = await Promise.all([
    source("../app/api/payroll/route.ts"),
    import("../lib/payroll.ts"),
  ]);

  assert.match(payrollRoute, /zonedDayBounds\(startsOn, timeZone\)/);
  assert.match(payrollRoute, /lt\(paymentEvents\.occurredAt, bounds\.end\)/);
  assert.match(payrollRoute, /payment\.amountCents - payment\.taxAmountCents - payment\.tipAmountCents/);
  assert.match(payrollRoute, /splitWeeklyMinutes\(ownEntries, profile\.weeklyOvertimeMinutes, profile\.overtimeEligible, location\.timezone\)/);

  const entries = [
    { clockIn: "2026-06-28T16:00:00.000Z", clockOut: "2026-06-28T16:45:00.000Z", breakMinutes: 0 },
    { clockIn: "2026-07-05T03:00:00.000Z", clockOut: "2026-07-05T03:45:00.000Z", breakMinutes: 0 },
  ];
  assert.deepEqual(payrollLib.splitWeeklyMinutes(entries, 60, true, "America/Toronto"), { regularMinutes: 60, overtimeMinutes: 30 });
  assert.deepEqual(payrollLib.splitWeeklyMinutes(entries, 60, true), { regularMinutes: 90, overtimeMinutes: 0 });
});

test("subscription checkout is deterministic and existing subscriptions use the billing portal", async () => {
  const billing = await source("../app/api/billing/route.ts");

  assert.match(billing, /subscription\?\.providerSubscriptionId && subscription\.status !== "cancelled"/);
  assert.match(billing, /already active\. Use the billing portal/);
  assert.match(billing, /status: "incomplete"/);
  assert.match(billing, /onConflictDoNothing\(\)\.returning\(\)/);
  assert.match(billing, /subscription-checkout:\$\{organization\.id\}:\$\{plan\}:\$\{subscription\.updatedAt\}/);
  assert.doesNotMatch(billing, /subscription:\$\{organization\.id\}:\$\{plan\}:\$\{crypto\.randomUUID\(\)\}/);
});

test("settings uses Team as the canonical invitation flow and location clones commit atomically", async () => {
  const settings = await source("../app/api/settings/route.ts");
  const patch = settings.slice(settings.indexOf("export async function PATCH"), settings.indexOf("export async function POST"));
  const post = settings.slice(settings.indexOf("export async function POST"));

  assert.match(settings, /function validTime/);
  assert.match(patch, /new Set\(hourValues\.map\(\(day\) => day\.weekday\)\)\.size !== 7/);
  assert.match(patch, /const statements: \[BatchItem<"sqlite">/);
  assert.match(patch, /await db\.batch\(statements\)/);
  assert.ok(patch.indexOf("hourValues = hours.map") < patch.indexOf("await db.batch(statements)"));

  const invite = post.slice(post.indexOf('if (action === "invite")'), post.indexOf('} else if (action === "revoke_invitation")'));
  assert.match(invite, /Add and invite teammates from Team/);
  assert.doesNotMatch(invite, /db\.insert\(staffInvitations\)/);

  const createLocation = post.slice(post.indexOf('} else if (action === "create_location")'));
  assert.match(createLocation, /const \[source, templates\] = cloneServices \? await Promise\.all/);
  assert.match(createLocation, /chunks\(serviceClones, 6\)/);
  assert.match(createLocation, /chunks\(templateClones, 8\)/);
  assert.match(createLocation, /await db\.batch\(statements\)/);
  assert.match(createLocation, /location\.created/);
});
