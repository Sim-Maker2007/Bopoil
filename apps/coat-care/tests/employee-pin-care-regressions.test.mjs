import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("employee PIN stage changes are assignment-scoped, one-step, and version claimed", async () => {
  const route = await source("../app/api/employee/care/route.ts");

  assert.match(route, /requireEmployeeSession/);
  assert.match(route, /eq\(appointments\.organizationId, organizationId\)/);
  assert.match(route, /eq\(appointments\.staffId, staffId\)/);
  assert.match(route, /eq\(staffLocations\.active, true\)/);
  assert.match(route, /eq\(locations\.active, true\)/);
  assert.match(route, /employeeStageTargets/);
  assert.match(route, /canTransitionAppointment\(appointment\.status, nextStatus\)/);
  assert.match(route, /appointmentChangeClaims/);
  assert.match(route, /appointmentAssignmentGuard/);
  assert.match(route, /eq\(appointments\.updatedAt, appointment\.updatedAt\)/);
  assert.match(route, /await db\.batch\(\[claim, appointmentWrite, audit\]\)/);
  assert.match(route, /source: "employee_pin_portal"/);
  assert.match(route, /templateKey: "ready_pickup"/);
  assert.doesNotMatch(route, /employeeStageTargets = new Set\(\[[^\]]*"completed"/);
});

test("employee PIN care capture is atomic, conflict-aware, and cannot publish a client report", async () => {
  const route = await source("../app/api/employee/care/route.ts");
  const careBranch = route.slice(route.indexOf('if (action === "save_care")'));
  const careSet = careBranch.slice(careBranch.indexOf("set: {"), careBranch.indexOf("}).returning()"));

  assert.match(careBranch, /careStatuses\.has\(appointment\.status\)/);
  assert.match(careBranch, /coatConditions\.includes\(coatCondition\)/);
  assert.match(careBranch, /styleNotes\.length > 3000/);
  assert.match(careBranch, /productsUsed\.length > 1200/);
  assert.match(careBranch, /internalNotes\.length > 3000/);
  assert.match(careBranch, /expectedCareUpdatedAt/);
  assert.match(careBranch, /careVersionGuard/);
  assert.match(careBranch, /guardAndAudit/);
  assert.match(careBranch, /await db\.batch\(\[guardAndAudit, careWrite\]\)/);
  assert.match(careSet, /coatCondition/);
  assert.match(careSet, /styleNotes/);
  assert.match(careSet, /productsUsed/);
  assert.match(careSet, /internalNotes/);
  assert.doesNotMatch(careBranch, /body\.clientReport/);
  assert.doesNotMatch(careBranch, /body\.reportPublished/);
  assert.doesNotMatch(careSet, /clientReport|reportPublished/);
});

test("My Day exposes only safe employee actions with bilingual controls", async () => {
  const [day, portal] = await Promise.all([
    source("../app/api/employee/day/route.ts"),
    source("../app/employee/employee-portal.tsx"),
  ]);

  assert.match(day, /employeeNextStage/);
  assert.match(day, /careCaptureStatuses/);
  assert.match(day, /eq\(appointments\.staffId, staffId\)/);
  assert.match(day, /inArray\(appointments\.locationId, locationIds\)/);
  assert.match(portal, /fetch\("\/api\/employee\/care"/);
  assert.match(portal, /action: "advance_stage"/);
  assert.match(portal, /action: "save_care"/);
  assert.match(portal, /expectedUpdatedAt: appointment\.care\?\.updatedAt/);
  assert.match(portal, /Ready for pickup/);
  assert.match(portal, /Prêt pour le départ/);
  assert.match(portal, /Client reports and approvals are handled by authorized staff/);
  assert.match(portal, /Les rapports clients et les approbations sont gérés par le personnel autorisé/);
});

test("employee-session API responses are English-first and machine-localizable", async () => {
  const [session, portal] = await Promise.all([
    source("../app/api/employee/session/route.ts"),
    source("../app/employee/employee-portal.tsx"),
  ]);

  assert.match(session, /Invalid employee code or PIN\./);
  assert.match(session, /Access temporarily locked\. Try again in 15 minutes\./);
  assert.match(session, /This invitation is invalid or expired\./);
  assert.match(session, /code: "invalid_credentials"/);
  assert.match(session, /code: "temporarily_locked"/);
  assert.match(session, /code: "invalid_pin"/);
  assert.match(portal, /body\.code === "invalid_credentials"/);
  assert.match(portal, /body\.code === "temporarily_locked"/);
  assert.match(portal, /body\.code === "invalid_pin"/);
});
