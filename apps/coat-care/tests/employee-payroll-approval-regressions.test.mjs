import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    source("../drizzle/0000_ambiguous_moondragon.sql"),
    source("../app/api/employee/timesheet/route.ts"),
    source("../app/api/timesheets/route.ts"),
    source("../app/employee/employee-portal.tsx"),
    source("../app/salon/weekly-timesheets-admin.tsx"),
  ]);

  assert.match(schema, /locationId: text\("location_id"\)\.references\(\(\) => locations\.id\)/);
  assert.match(migration, /"timesheet_shifts_location_id_locations_id_fk" FOREIGN KEY \("location_id"\) REFERENCES "public"\."locations"\("id"\)/);
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

test("payroll atomically validates exact approved punch and timesheet snapshots", async () => {
  const payrollRoute = await source("../app/api/payroll/route.ts");

  assert.match(payrollRoute, /approvedTime: snapshotComponent\(effectiveEntries\.map/);
  assert.match(payrollRoute, /approvedReportedTips: snapshotComponent\(approvedReportedTips\.map/);
  assert.match(payrollRoute, /select string_agg\(work_row, '\|' order by work_sort collate \"C\"\)/);
  assert.match(payrollRoute, /select string_agg\(tip_row, '\|' order by tip_sort collate \"C\"\)/);
  assert.match(payrollRoute, /snapshot_json::json #>> '\{approvedTime,signature\}'/);
  assert.match(payrollRoute, /snapshot_json::json #>> '\{approvedReportedTips,signature\}'/);
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
