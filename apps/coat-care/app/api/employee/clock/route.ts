import { and, eq, sql } from "drizzle-orm";
import { auditEvents, locations, staffClockStates, staffLocations, timeClockClaims, timeEntries } from "../../../../db/schema";
import { requireEmployeeSession } from "../../../../lib/employee-auth";
import { paidMinutes } from "../../../../lib/payroll";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The time clock could not be updated.";
  const status = message === "EMPLOYEE_AUTH_REQUIRED" ? 401 : /already|not clocked|changed/i.test(message) ? 409 : 400;
  return Response.json({ error: message === "EMPLOYEE_AUTH_REQUIRED" ? "Sign-in required." : message }, { status });
}

function breakValue(value: unknown) {
  const result = Number(value || 0);
  if (!Number.isInteger(result) || result < 0 || result > 720) throw new Error("Break minutes must be between 0 and 720.");
  return result;
}

export async function POST(request: Request) {
  try {
    const { db, organizationId, staffId } = await requireEmployeeSession();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const locationId = String(body.locationId || "");
    const [assignedLocation] = await db.select({ id: locations.id, name: locations.name }).from(staffLocations)
      .innerJoin(locations, eq(staffLocations.locationId, locations.id))
      .where(and(
        eq(staffLocations.organizationId, organizationId),
        eq(staffLocations.staffId, staffId),
        eq(staffLocations.locationId, locationId),
        eq(staffLocations.active, true),
        eq(locations.organizationId, organizationId),
        eq(locations.active, true),
      )).limit(1);
    if (!assignedLocation) throw new Error("Choose one of your assigned locations.");
    const now = new Date().toISOString();

    if (action === "clock_in") {
      const idempotencyKey = String(body.idempotencyKey || "").trim().slice(0, 120);
      if (!idempotencyKey || idempotencyKey.startsWith("pin-timesheet:")) throw new Error("Refresh and try clocking in again.");
      const [existing] = await db.select().from(timeEntries).where(and(
        eq(timeEntries.organizationId, organizationId),
        eq(timeEntries.locationId, locationId),
        eq(timeEntries.staffId, staffId),
        eq(timeEntries.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (existing) return Response.json({ entry: existing, locationName: assignedLocation.name });
      const [openElsewhere] = await db.select({ id: staffClockStates.id, locationId: staffClockStates.locationId }).from(staffClockStates).where(and(
        eq(staffClockStates.organizationId, organizationId),
        eq(staffClockStates.staffId, staffId),
        eq(staffClockStates.status, "clocked_in"),
      )).limit(1);
      if (openElsewhere) throw new Error("You are already clocked in.");
      await db.insert(staffClockStates).values({ id: crypto.randomUUID(), organizationId, locationId, staffId }).onConflictDoNothing();
      const [state] = await db.select().from(staffClockStates).where(and(
        eq(staffClockStates.organizationId, organizationId),
        eq(staffClockStates.locationId, locationId),
        eq(staffClockStates.staffId, staffId),
      )).limit(1);
      if (!state || state.status !== "clocked_out") throw new Error("You are already clocked in.");
      const entryId = crypto.randomUUID();
      const entry = { id: entryId, organizationId, locationId, staffId, clockIn: now, idempotencyKey, enteredByStaffId: staffId };
      try {
        await db.batch([
          db.insert(auditEvents).values({
            id: crypto.randomUUID(),
            organizationId: sql<string>`(
              select organization_id from staff_clock_states
              where id = ${state.id}
                and organization_id = ${organizationId}
                and staff_id = ${staffId}
                and location_id = ${locationId}
                and status = 'clocked_out'
                and version = ${state.version}
                and not exists (
                  select 1 from staff_clock_states as other_clock
                  where other_clock.organization_id = ${organizationId}
                    and other_clock.staff_id = ${staffId}
                    and other_clock.status = 'clocked_in'
                )
            )`,
            actorType: "staff",
            actorId: staffId,
            action: "workforce.clock_in",
            entityType: "time_entry",
            entityId: entryId,
            detailsJson: JSON.stringify({ source: "employee_pin_portal", locationId }),
          }),
          db.insert(timeEntries).values(entry),
          db.insert(timeClockClaims).values({ id: crypto.randomUUID(), organizationId, locationId, staffId, expectedVersion: state.version, action: "clock_in", timeEntryId: entryId }),
          db.update(staffClockStates).set({ status: "clocked_in", openEntryId: entryId, version: state.version + 1, updatedAt: now }).where(and(
            eq(staffClockStates.id, state.id),
            eq(staffClockStates.version, state.version),
            eq(staffClockStates.status, "clocked_out"),
          )),
        ]);
      } catch {
        throw new Error("The clock changed in another session. Refresh and try again.");
      }
      return Response.json({ entry, locationName: assignedLocation.name }, { status: 201 });
    }

    if (action === "clock_out") {
      const unpaidBreakMinutes = breakValue(body.breakMinutes);
      const [state] = await db.select().from(staffClockStates).where(and(
        eq(staffClockStates.organizationId, organizationId),
        eq(staffClockStates.locationId, locationId),
        eq(staffClockStates.staffId, staffId),
      )).limit(1);
      if (!state?.openEntryId || state.status !== "clocked_in") throw new Error("You are not clocked in.");
      const [entry] = await db.select().from(timeEntries).where(and(
        eq(timeEntries.id, state.openEntryId),
        eq(timeEntries.organizationId, organizationId),
        eq(timeEntries.locationId, locationId),
        eq(timeEntries.staffId, staffId),
        eq(timeEntries.status, "open"),
      )).limit(1);
      if (!entry) throw new Error("The open time entry could not be found.");
      paidMinutes(entry.clockIn, now, unpaidBreakMinutes);
      try {
        await db.batch([
          db.insert(auditEvents).values({
            id: crypto.randomUUID(),
            organizationId: sql<string>`(
              select organization_id from staff_clock_states
              where id = ${state.id}
                and organization_id = ${organizationId}
                and staff_id = ${staffId}
                and location_id = ${locationId}
                and status = 'clocked_in'
                and version = ${state.version}
                and open_entry_id = ${entry.id}
            )`,
            actorType: "staff",
            actorId: staffId,
            action: "workforce.clock_out",
            entityType: "time_entry",
            entityId: entry.id,
            detailsJson: JSON.stringify({ source: "employee_pin_portal", locationId, breakMinutes: unpaidBreakMinutes }),
          }),
          db.insert(timeClockClaims).values({ id: crypto.randomUUID(), organizationId, locationId, staffId, expectedVersion: state.version, action: "clock_out", timeEntryId: entry.id }),
          db.update(timeEntries).set({ clockOut: now, breakMinutes: unpaidBreakMinutes, status: "submitted", updatedAt: now }).where(and(
            eq(timeEntries.id, entry.id),
            eq(timeEntries.status, "open"),
          )),
          db.update(staffClockStates).set({ status: "clocked_out", openEntryId: null, version: state.version + 1, updatedAt: now }).where(and(
            eq(staffClockStates.id, state.id),
            eq(staffClockStates.version, state.version),
            eq(staffClockStates.status, "clocked_in"),
          )),
        ]);
      } catch {
        throw new Error("The clock changed in another session. Refresh and try again.");
      }
      return Response.json({ entry: { ...entry, clockOut: now, breakMinutes: unpaidBreakMinutes, status: "submitted" }, locationName: assignedLocation.name });
    }

    throw new Error("Choose Clock in or Clock out.");
  } catch (error) {
    return errorResponse(error);
  }
}
