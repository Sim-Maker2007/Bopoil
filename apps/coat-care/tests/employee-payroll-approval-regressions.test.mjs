import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("PIN My Day stays employee-scoped and uses the auditable shared clock ledger", async () => {
  const [day, clock, workspaceClock, portal] = await Promise.all([
    source("../app/api/employee/day/route.ts"),
    source("../app/api/employee/clock/route.ts"),
    source("../app/api/workforce/route.ts"),
    source("../app/employee/employee-portal.tsx"),
  ]);

  assert.match(day, /requireEmployeeSession/);
  assert.match(day, /eq\(appointments\.staffId, staffId\)/);
  assert.match(day, /petWarnings/);
  assert.match(day, /appointmentCareRecords/);
  assert.match(day, /handlingNotes: pets\.handlingNotes/);
  assert.match(clock, /timeClockClaims/);
  assert.match(clock, /timeEntries/);
  assert.match(clock, /not exists \(/);
  assert.match(clock, /other_clock\.status = 'clocked_in'/);
  assert.ok(clock.indexOf("db.insert(timeEntries).values(entry)") < clock.indexOf('action: "clock_in", timeEntryId: entryId'));
  assert.match(workspaceClock, /other_clock\.status = 'clocked_in'/);
  assert.ok(workspaceClock.indexOf("db.insert(timeEntries).values(entry)") < workspaceClock.indexOf('action: "clock_in", timeEntryId: entryId'));
  assert.match(portal, /"day" \| "timesheet"/);
  assert.match(portal, /employee-locale/);
  assert.match(portal, /noAssignedLocation/);
});

test("approval workspace polls pending decisions and reports real delivery state with copy fallback", async () => {
  const [api, view] = await Promise.all([
    source("../app/api/care/route.ts"),
    source("../app/salon/care-workspace.tsx"),
  ]);

  assert.match(api, /DELIVERY_PUBLIC_URL \|\| new URL\(request\.url\)\.origin/);
  assert.match(api, /deliverySummary/);
  assert.match(api, /deliveryByApproval/);
  assert.doesNotMatch(api, /explanation: `\$\{approval\.explanation\}/);
  assert.match(view, /setInterval\(\(\) => void pollApprovals\(\), 8000\)/);
  assert.match(view, /document\.visibilityState === "visible"/);
  assert.match(view, /Automatic delivery is unavailable; Copy link/);
  assert.match(view, /copyApproval/);
});

test("manager approval materializes PIN sheets once and payroll merges tips and retail commission", async () => {
  const [employeeSheet, managerSheet, payrollRoute, payroll] = await Promise.all([
    source("../app/api/employee/timesheet/route.ts"),
    source("../app/api/timesheets/route.ts"),
    source("../app/api/payroll/route.ts"),
    import("../lib/payroll.ts"),
  ]);

  assert.doesNotMatch(employeeSheet, /BOPOIL Paiement|BOPOIL Gatineau/);
  assert.doesNotMatch(managerSheet, /BOPOIL Paiement|BOPOIL Gatineau/);
  assert.match(managerSheet, /timesheet\.week_approved_materialized/);
  assert.match(managerSheet, /pin-timesheet:\$\{week\.id\}:\$\{candidate\.shift\.id\}:r\$\{expectedRevision\}/);
  assert.match(managerSheet, /like\([\s\S]*timeEntries\.idempotencyKey,[\s\S]*`pin-timesheet:/);
  assert.match(payrollRoute, /Approve submitted weekly sheets before building payroll/);
  assert.match(payrollRoute, /approvedReportedTips/);
  assert.match(payrollRoute, /mergeReportedTips/);
  assert.match(payrollRoute, /calculateRetailCommission/);
  assert.match(payrollRoute, /invoiceLineItems/);

  assert.equal(payroll.mergeReportedTips(2_500, 1_000), 2_500);
  assert.equal(payroll.mergeReportedTips(2_500, 4_000), 4_000);
  const snapshot = { payType: "hourly", hourlyRateCents: 2_500, annualSalaryCents: 0, overtimeEligible: true, weeklyOvertimeMinutes: 2_400, overtimeMultiplierBps: 15_000, serviceCommissionBps: 1_000, retailCommissionBps: 1_500, currency: "CAD" };
  assert.equal(payroll.calculateRetailCommission(snapshot, 20_000), 3_000);
  assert.deepEqual(payroll.splitCommissionRevenue(10_000, 8_000, 2_000, 10_000), { serviceRevenueCents: 8_000, retailRevenueCents: 2_000 });
});

test("timesheets persist stable location identity and reject every cross-location punch overlap", async () => {
  const [schema, migration, employeeSheet, managerSheet, employeePortal, managerPortal] = await Promise.all([
    source("../db/schema.ts"),
    source("../drizzle/0030_marvelous_jack_murdock.sql"),
    source("../app/api/employee/timesheet/route.ts"),
    source("../app/api/timesheets/route.ts"),
    source("../app/employee/employee-portal.tsx"),
    source("../app/salon/weekly-timesheets-admin.tsx"),
  ]);

  assert.match(schema, /locationId: text\("location_id"\)\.references\(\(\) => locations\.id\)/);
  assert.match(migration, /ADD `location_id` text REFERENCES locations\(id\)/);
  assert.match(migration, /SELECT count\(\*\)[\s\S]*`locations`\.`name` = `timesheet_shifts`\.`location_name`[\s\S]*\) = 1/);
  assert.match(employeeSheet, /locationId: item\.locationId/);
  assert.match(employeeSheet, /locationOptions: allowedLocations/);
  assert.match(managerSheet, /function resolveLocation/);
  assert.match(managerSheet, /locationId: location\.id/);
  assert.match(managerSheet, /Two weekly shifts overlap after location time zones are applied/);
  assert.match(managerSheet, /const overlaps = existingEntries\.filter/);
  assert.match(managerSheet, /entry\.clockOut === null \|\| entry\.clockOut > candidate\.clockIn/);
  assert.match(managerSheet, /entry\.locationId === candidate\.location\.id\s*&&\s*entry\.status === "approved"/);
  assert.doesNotMatch(managerSheet, /existingEntries\.find\(\(entry\) => entry\.locationId === candidate\.location\.id/);
  assert.match(employeePortal, /locationOptions\?: LocationOption\[\]/);
  assert.match(managerPortal, /locationOptions\?: LocationOption\[\]/);
});

test("timesheet location migration backfills only organization-unique legacy names", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table locations (id text primary key, organization_id text not null, name text not null);
    create table timesheet_shifts (id text primary key, organization_id text not null, location_name text not null, work_date text not null);
    insert into locations values
      ('loc-a', 'org-1', 'Downtown'),
      ('loc-b-1', 'org-1', 'Uptown'),
      ('loc-b-2', 'org-1', 'Uptown'),
      ('loc-c', 'org-2', 'Downtown');
    insert into timesheet_shifts values
      ('shift-a', 'org-1', 'Downtown', '2026-07-20'),
      ('shift-b', 'org-1', 'Uptown', '2026-07-20'),
      ('shift-c', 'org-2', 'Downtown', '2026-07-20');
  `);
  const migration = (await source("../drizzle/0030_marvelous_jack_murdock.sql")).replaceAll("--> statement-breakpoint", "");
  assert.doesNotThrow(() => db.exec(migration));
  const rows = db.prepare("select id, location_id from timesheet_shifts order by id").all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: "shift-a", location_id: "loc-a" },
    { id: "shift-b", location_id: null },
    { id: "shift-c", location_id: "loc-c" },
  ]);
  db.close();
});

test("payroll atomically validates exact approved punch and timesheet snapshots", async () => {
  const payrollRoute = await source("../app/api/payroll/route.ts");

  assert.match(payrollRoute, /approvedTime: snapshotComponent\(effectiveEntries\.map/);
  assert.match(payrollRoute, /approvedReportedTips: snapshotComponent\(approvedReportedTips\.map/);
  assert.match(payrollRoute, /select group_concat\(work_row, '\|'\)/);
  assert.match(payrollRoute, /select group_concat\(tip_row, '\|'\)/);
  assert.match(payrollRoute, /json_extract\(expected\.snapshot_json, '\$\.approvedTime\.signature'\)/);
  assert.match(payrollRoute, /json_extract\(expected\.snapshot_json, '\$\.approvedReportedTips\.signature'\)/);
  assert.match(payrollRoute, /const effectiveClockInSql = sql<string>/);
  assert.match(payrollRoute, /order by candidate_adjustment\.created_at desc, candidate_adjustment\.id desc/);
  assert.match(payrollRoute, /approved_shift\.location_id = expected\.location_id/);
  assert.match(payrollRoute, /Re-select the location on legacy timesheets/);
  assert.match(payrollRoute, /pending_entry\.status = 'open' and pending_entry\.clock_in < expected\.bounds_end/);
  assert.match(payrollRoute, /pending_entry\.status = 'submitted'[\s\S]*coalesce\(pending_adjustment\.clock_in, pending_entry\.clock_in\) >= expected\.bounds_start/);

  assert.match(payrollRoute, /function payrollInputGuardSql/);
  assert.match(payrollRoute, /inputSnapshotJson = JSON\.stringify\(snapshot\)/);
  assert.match(payrollRoute, /inputSnapshotHash: await sha256\(inputSnapshotJson\)/);
  assert.match(payrollRoute, /organizationId: payrollInputGuardSql\(\{/);
  assert.match(payrollRoute, /expected_period\.input_snapshot_hash = expected\.snapshot_hash/);
  assert.match(payrollRoute, /expected_period\.input_snapshot_json = expected\.snapshot_json/);
});
