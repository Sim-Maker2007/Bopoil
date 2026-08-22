import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { auditEvents, compensationProfiles, locations, staff, staffClockStates, staffLocations, timeClockClaims, timeEntries, timeEntryAdjustments } from "../../../db/schema";
import { requirePayrollManagement, requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { paidMinutes, PAYROLL_DISCLAIMER } from "../../../lib/payroll";

const managers = ["owner", "manager"];
const iso = (value: unknown, name: string) => { const date = new Date(String(value || "")); if (!Number.isFinite(date.getTime())) throw new SalonAccessError(`${name} is invalid`, 400); return date.toISOString(); };
const number = (value: unknown, min: number, max: number, name: string) => { const result = Number(value); if (!Number.isFinite(result) || result < min || result > max) throw new SalonAccessError(`${name} is invalid`, 400); return Math.round(result); };

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "workforce"); const url = new URL(request.url);
    const from = url.searchParams.get("from") || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const canManage = managers.includes(membership.role); const canSeePayroll = [...managers, "accountant"].includes(membership.role);
    const team = await db.select({ id: staff.id, displayName: staff.displayName, role: staffLocations.role }).from(staffLocations).innerJoin(staff, eq(staffLocations.staffId, staff.id)).where(and(eq(staffLocations.organizationId, membership.organizationId), eq(staffLocations.locationId, membership.locationId), eq(staffLocations.active, true), eq(staff.active, true))).orderBy(asc(staff.displayName));
    const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.locationId, membership.locationId), canManage || membership.role === "accountant" ? undefined : eq(timeEntries.staffId, membership.id), gte(timeEntries.clockIn, `${from}T00:00:00.000Z`), lte(timeEntries.clockIn, `${to}T23:59:59.999Z`))).orderBy(desc(timeEntries.clockIn));
    const adjustments = entries.length ? await db.select().from(timeEntryAdjustments).where(and(eq(timeEntryAdjustments.organizationId, membership.organizationId), eq(timeEntryAdjustments.locationId, membership.locationId))).orderBy(asc(timeEntryAdjustments.createdAt)) : [];
    const latest = new Map(adjustments.map((item) => [item.timeEntryId, item])); const names = new Map(team.map((item) => [item.id, item.displayName]));
    const states = await db.select().from(staffClockStates).where(and(eq(staffClockStates.organizationId, membership.organizationId), eq(staffClockStates.locationId, membership.locationId), canManage ? undefined : eq(staffClockStates.staffId, membership.id)));
    const profiles = canSeePayroll ? await db.select().from(compensationProfiles).where(and(eq(compensationProfiles.organizationId, membership.organizationId), eq(compensationProfiles.locationId, membership.locationId))).orderBy(desc(compensationProfiles.effectiveFrom)) : [];
    const currentProfiles = new Map<string, typeof profiles[number]>(); for (const profile of profiles) if (!currentProfiles.has(profile.staffId)) currentProfiles.set(profile.staffId, profile);
    const [location] = await db.select({ currency: locations.currency }).from(locations).where(eq(locations.id, membership.locationId)).limit(1);
    return Response.json({ canManage, canSeePayroll, currentStaffId: membership.id, currency: location.currency, disclaimer: PAYROLL_DISCLAIMER, team: team.map((person) => ({ ...person, compensation: currentProfiles.get(person.id) || null })), states, entries: entries.map((entry) => { const adjustment = latest.get(entry.id); const clockIn = adjustment?.clockIn || entry.clockIn; const clockOut = adjustment?.clockOut || entry.clockOut; const breakMinutes = adjustment?.breakMinutes ?? entry.breakMinutes; return { ...entry, staffName: names.get(entry.staffId), effectiveClockIn: clockIn, effectiveClockOut: clockOut, effectiveBreakMinutes: breakMinutes, paidMinutes: clockOut ? paidMinutes(clockIn, clockOut, breakMinutes) : null, adjusted: Boolean(adjustment) }; }) });
  } catch (error) { return salonApiError(error, "Workforce records could not be loaded."); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "workforce"); const body = await request.json() as Record<string, unknown>; const action = String(body.action || ""); const now = new Date().toISOString();
    if (action === "clock_in") {
      const key = String(body.idempotencyKey || crypto.randomUUID());
      const [existing] = await db.select().from(timeEntries).where(and(eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.staffId, membership.id), eq(timeEntries.idempotencyKey, key))).limit(1); if (existing) return Response.json({ entry: existing });
      const [openElsewhere] = await db.select({ id: staffClockStates.id }).from(staffClockStates).where(and(eq(staffClockStates.organizationId, membership.organizationId), eq(staffClockStates.staffId, membership.id), eq(staffClockStates.status, "clocked_in"))).limit(1);
      if (openElsewhere) throw new SalonAccessError("You are already clocked in.", 409);
      await db.insert(staffClockStates).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId: membership.id }).onConflictDoNothing();
      const [state] = await db.select().from(staffClockStates).where(and(eq(staffClockStates.organizationId, membership.organizationId), eq(staffClockStates.locationId, membership.locationId), eq(staffClockStates.staffId, membership.id))).limit(1); if (!state || state.status !== "clocked_out") throw new SalonAccessError("You are already clocked in.", 409);
      const entryId = crypto.randomUUID(); const entry = { id: entryId, organizationId: membership.organizationId, locationId: membership.locationId, staffId: membership.id, clockIn: now, idempotencyKey: key, enteredByStaffId: membership.id };
      try { await db.batch([
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: sql<string>`(
            select organization_id from staff_clock_states
            where id = ${state.id}
              and organization_id = ${membership.organizationId}
              and location_id = ${membership.locationId}
              and staff_id = ${membership.id}
              and status = 'clocked_out'
              and version = ${state.version}
              and not exists (
                select 1 from staff_clock_states as other_clock
                where other_clock.organization_id = ${membership.organizationId}
                  and other_clock.staff_id = ${membership.id}
                  and other_clock.status = 'clocked_in'
              )
          )`,
          actorType: "staff", actorId: membership.id, action: "workforce.clock_in", entityType: "time_entry", entityId: entryId,
        }),
        db.insert(timeEntries).values(entry),
        db.insert(timeClockClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId: membership.id, expectedVersion: state.version, action: "clock_in", timeEntryId: entryId }),
        db.update(staffClockStates).set({ status: "clocked_in", openEntryId: entryId, version: state.version + 1, updatedAt: now }).where(and(eq(staffClockStates.id, state.id), eq(staffClockStates.version, state.version), eq(staffClockStates.status, "clocked_out"))),
      ]); } catch { throw new SalonAccessError("The clock changed in another session. Refresh and try again.", 409); } return Response.json({ entry }, { status: 201 });
    }
    if (action === "clock_out") {
      const breakMinutes = number(body.breakMinutes || 0, 0, 720, "Break minutes"); const [state] = await db.select().from(staffClockStates).where(and(eq(staffClockStates.organizationId, membership.organizationId), eq(staffClockStates.locationId, membership.locationId), eq(staffClockStates.staffId, membership.id))).limit(1);
      if (!state?.openEntryId || state.status !== "clocked_in") throw new SalonAccessError("You are not clocked in.", 409);
      const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, state.openEntryId), eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.locationId, membership.locationId), eq(timeEntries.staffId, membership.id), eq(timeEntries.status, "open"))).limit(1); if (!entry) throw new SalonAccessError("The open time entry could not be found.", 409); paidMinutes(entry.clockIn, now, breakMinutes);
      try { await db.batch([
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: sql<string>`(
            select organization_id from staff_clock_states
            where id = ${state.id}
              and organization_id = ${membership.organizationId}
              and location_id = ${membership.locationId}
              and staff_id = ${membership.id}
              and status = 'clocked_in'
              and version = ${state.version}
              and open_entry_id = ${entry.id}
          )`,
          actorType: "staff", actorId: membership.id, action: "workforce.clock_out", entityType: "time_entry", entityId: entry.id, detailsJson: JSON.stringify({ breakMinutes }),
        }),
        db.insert(timeClockClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId: membership.id, expectedVersion: state.version, action: "clock_out", timeEntryId: entry.id }),
        db.update(timeEntries).set({ clockOut: now, breakMinutes, status: "submitted", updatedAt: now }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.locationId, membership.locationId), eq(timeEntries.staffId, membership.id), eq(timeEntries.status, "open"))),
        db.update(staffClockStates).set({ status: "clocked_out", openEntryId: null, version: state.version + 1, updatedAt: now }).where(and(eq(staffClockStates.id, state.id), eq(staffClockStates.version, state.version), eq(staffClockStates.status, "clocked_in"))),
      ]); } catch { throw new SalonAccessError("The clock changed in another session. Refresh and try again.", 409); } return Response.json({ entry: { ...entry, clockOut: now, breakMinutes, status: "submitted" } });
    }
    requirePayrollManagement(membership);
    if (action === "save_compensation") {
      const staffId = String(body.staffId || ""); const [person] = await db.select({ id: staffLocations.staffId }).from(staffLocations).where(and(eq(staffLocations.organizationId, membership.organizationId), eq(staffLocations.locationId, membership.locationId), eq(staffLocations.staffId, staffId), eq(staffLocations.active, true))).limit(1); if (!person) throw new SalonAccessError("Staff member not found.", 404);
      const values = { id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId, workerClass: body.workerClass === "contractor" ? "contractor" as const : "employee" as const, payType: body.payType === "salary" ? "salary" as const : "hourly" as const, hourlyRateCents: number(body.hourlyRateCents || 0, 0, 1000000, "Hourly rate"), annualSalaryCents: number(body.annualSalaryCents || 0, 0, 100000000, "Annual salary"), overtimeEligible: body.overtimeEligible !== false, weeklyOvertimeMinutes: number(body.weeklyOvertimeMinutes || 2400, 60, 10080, "Overtime threshold"), overtimeMultiplierBps: number(body.overtimeMultiplierBps || 15000, 10000, 50000, "Overtime multiplier"), serviceCommissionBps: number(body.serviceCommissionBps || 0, 0, 10000, "Service commission"), retailCommissionBps: number(body.retailCommissionBps || 0, 0, 10000, "Retail commission"), currency: String(body.currency || "CAD"), effectiveFrom: String(body.effectiveFrom || now.slice(0, 10)), createdByStaffId: membership.id };
      const [profile] = await db.insert(compensationProfiles).values(values).returning(); await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "workforce.compensation_effective_dated", entityType: "compensation_profile", entityId: profile.id, detailsJson: JSON.stringify({ staffId, effectiveFrom: values.effectiveFrom }) }); return Response.json({ profile }, { status: 201 });
    }
    if (action === "manual_entry") {
      const staffId = String(body.staffId || ""); const clockIn = iso(body.clockIn, "Clock-in"); const clockOut = iso(body.clockOut, "Clock-out"); const breakMinutes = number(body.breakMinutes || 0, 0, 720, "Break minutes"); paidMinutes(clockIn, clockOut, breakMinutes); const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
      const [assignedStaff] = await db.select({ id: staffLocations.id }).from(staffLocations).where(and(eq(staffLocations.organizationId, membership.organizationId), eq(staffLocations.locationId, membership.locationId), eq(staffLocations.staffId, staffId), eq(staffLocations.active, true))).limit(1);
      if (!assignedStaff) throw new SalonAccessError("Staff member not found.", 404);
      const [entry] = await db.insert(timeEntries).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId, clockIn, clockOut, breakMinutes, status: "submitted", source: "manual", note: String(body.note || ""), idempotencyKey, enteredByStaffId: membership.id }).onConflictDoNothing().returning(); if (!entry) throw new SalonAccessError("This time entry was already recorded.", 409); await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "workforce.manual_entry_created", entityType: "time_entry", entityId: entry.id }); return Response.json({ entry }, { status: 201 });
    }
    throw new SalonAccessError("Unsupported workforce action.", 400);
  } catch (error) { return salonApiError(error, "Workforce record could not be saved."); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requirePayrollManagement(membership); const body = await request.json() as Record<string, unknown>; const action = String(body.action || ""); const entryId = String(body.entryId || "");
    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.organizationId, membership.organizationId), eq(timeEntries.locationId, membership.locationId))).limit(1); if (!entry) throw new SalonAccessError("Time entry not found.", 404); const now = new Date().toISOString();
    if (action === "approve" || action === "reject" || action === "void") { const status = action === "approve" ? "approved" as const : action === "reject" ? "rejected" as const : "void" as const; const [updated] = await db.update(timeEntries).set({ status, approvedByStaffId: action === "approve" ? membership.id : null, approvedAt: action === "approve" ? now : null, updatedAt: now }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.updatedAt, entry.updatedAt))).returning(); if (!updated) throw new SalonAccessError("This entry changed in another session.", 409); await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: `workforce.time_${action}d`, entityType: "time_entry", entityId: entry.id, detailsJson: JSON.stringify({ reason: String(body.reason || "") }) }); return Response.json({ entry: updated }); }
    if (action === "adjust") { const clockIn = iso(body.clockIn, "Clock-in"); const clockOut = iso(body.clockOut, "Clock-out"); const breakMinutes = number(body.breakMinutes || 0, 0, 720, "Break minutes"); paidMinutes(clockIn, clockOut, breakMinutes); const reason = String(body.reason || "").trim(); if (reason.length < 3) throw new SalonAccessError("A correction reason is required.", 400); const [adjustment] = await db.insert(timeEntryAdjustments).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, timeEntryId: entry.id, clockIn, clockOut, breakMinutes, reason, adjustedByStaffId: membership.id }).returning(); await db.update(timeEntries).set({ status: "submitted", approvedByStaffId: null, approvedAt: null, updatedAt: now }).where(eq(timeEntries.id, entry.id)); await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "workforce.time_adjusted", entityType: "time_entry", entityId: entry.id, detailsJson: JSON.stringify({ adjustmentId: adjustment.id, reason }) }); return Response.json({ adjustment }); }
    throw new SalonAccessError("Unsupported workforce action.", 400);
  } catch (error) { return salonApiError(error, "Time entry could not be updated."); }
}
