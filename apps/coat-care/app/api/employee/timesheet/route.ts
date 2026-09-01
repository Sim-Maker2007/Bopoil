import { and, asc, eq, sql } from "drizzle-orm";
import { auditEvents, locations, organizations, staffLocations, timesheetShifts, timesheetWeeks } from "../../../../db/schema";
import { requireEmployeeSession } from "../../../../lib/employee-auth";

import { databaseErrorMessage } from "../../../../db";
type ShiftInput = { id?: unknown; workDate?: unknown; locationId?: unknown; locationName?: unknown; startTime?: unknown; endTime?: unknown; tips?: unknown };
type LocationOption = { id: string; name: string; label?: string };

function torontoDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function mondayOf(value: string) { const date = new Date(`${value}T12:00:00Z`); if (!Number.isFinite(date.getTime())) throw new Error("Invalid week."); const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - ((day + 6) % 7)); return date.toISOString().slice(0, 10); }
function addDays(value: string, amount: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function minutes(value: string) { if (!/^\d{2}:\d{2}$/.test(value)) return NaN; const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }

function resolveLocation(item: ShiftInput, allowedLocations: readonly LocationOption[]) {
  const locationId = String(item.locationId || "");
  if (locationId) return allowedLocations.find((location) => location.id === locationId) || null;
  const locationName = String(item.locationName || "");
  const matches = allowedLocations.filter((location) => location.name === locationName);
  return matches.length === 1 ? matches[0] : null;
}

function shifts(value: unknown, weekStartsOn: string, allowedLocations: readonly LocationOption[]) {
  if (!Array.isArray(value) || value.length > 30) throw new Error("The timesheet has too many shifts.");
  const allowedDates = new Set(Array.from({ length: 7 }, (_, index) => addDays(weekStartsOn, index)));
  const result = value.map((raw) => {
    const item = raw as ShiftInput; const workDate = String(item.workDate || ""); const location = resolveLocation(item, allowedLocations); const startTime = String(item.startTime || ""); const endTime = String(item.endTime || "");
    if (!allowedDates.has(workDate)) throw new Error("A shift falls outside the Monday-to-Sunday week.");
    if (!location) throw new Error("Choose one of your assigned locations. If two locations have the same name, choose the location again.");
    const start = minutes(startTime); const end = minutes(endTime); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("The end time must be after the start time.");
    const tips = Number(item.tips || 0); if (!Number.isFinite(tips) || tips < 0 || tips > 100000) throw new Error("The tip amount is invalid.");
    return { id: String(item.id || crypto.randomUUID()), workDate, locationId: location.id, locationName: location.name, startTime, endTime, tipsCents: Math.round(tips * 100), paidMinutes: end - start };
  });
  for (const date of allowedDates) {
    const day = result.filter((item) => item.workDate === date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < day.length; index += 1) if (day[index].startTime < day[index - 1].endTime) throw new Error("Two shifts overlap on the same day.");
  }
  return result;
}

async function employeeLocations(db: ReturnType<typeof import("../../../../db").getDb>, organizationId: string, staffId: string) {
  const rows = await db.select({ id: locations.id, name: locations.name, city: locations.city }).from(staffLocations).innerJoin(locations, eq(staffLocations.locationId, locations.id)).where(and(
    eq(staffLocations.organizationId, organizationId),
    eq(staffLocations.staffId, staffId),
    eq(staffLocations.active, true),
    eq(locations.organizationId, organizationId),
    eq(locations.active, true),
  )).orderBy(asc(locations.name), asc(locations.city));
  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  const counts = new Map<string, number>();
  for (const row of uniqueRows) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  return uniqueRows.map((row) => ({ id: row.id, name: row.name, label: counts.get(row.name)! > 1 ? `${row.name} · ${row.city}` : row.name }));
}

async function findOrCreateWeek(db: ReturnType<typeof import("../../../../db").getDb>, organizationId: string, staffId: string, weekStartsOn: string) {
  let [week] = await db.select().from(timesheetWeeks).where(and(eq(timesheetWeeks.organizationId, organizationId), eq(timesheetWeeks.staffId, staffId), eq(timesheetWeeks.weekStartsOn, weekStartsOn))).limit(1);
  if (week) return week;
  const [created] = await db.insert(timesheetWeeks).values({ id: crypto.randomUUID(), organizationId, staffId, weekStartsOn }).onConflictDoNothing().returning();
  if (created) return created;
  [week] = await db.select().from(timesheetWeeks).where(and(eq(timesheetWeeks.organizationId, organizationId), eq(timesheetWeeks.staffId, staffId), eq(timesheetWeeks.weekStartsOn, weekStartsOn))).limit(1);
  if (!week) throw new Error("The timesheet could not be opened.");
  return week;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The timesheet could not be saved.";
  return Response.json({ error: message === "EMPLOYEE_AUTH_REQUIRED" ? "Sign-in required." : message }, { status: message === "EMPLOYEE_AUTH_REQUIRED" ? 401 : 400 });
}

export async function GET(request: Request) {
  try {
    const { db, organizationId, staffId, displayName } = await requireEmployeeSession(); const requested = new URL(request.url).searchParams.get("week") || torontoDate(); const weekStartsOn = mondayOf(requested);
    const week = await findOrCreateWeek(db, organizationId, staffId, weekStartsOn);
    const [[organization], allowedLocations] = await Promise.all([
      db.select({ name: organizations.name, currency: organizations.currency }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
      employeeLocations(db, organizationId, staffId),
    ]);
    const rows = await db.select().from(timesheetShifts).where(and(eq(timesheetShifts.organizationId, organizationId), eq(timesheetShifts.weekId, week.id), eq(timesheetShifts.staffId, staffId))).orderBy(asc(timesheetShifts.workDate), asc(timesheetShifts.startTime));
    const normalized = rows.map((row) => {
      const legacyMatches = allowedLocations.filter((location) => location.name === row.locationName);
      return { ...row, locationId: row.locationId || (legacyMatches.length === 1 ? legacyMatches[0].id : null), tips: row.tipsCents / 100, paidMinutes: minutes(row.endTime) - minutes(row.startTime) };
    });
    return Response.json({ employee: { displayName }, organizationName: organization?.name || "Salon", currency: organization?.currency || "CAD", locations: [...new Set(allowedLocations.map((location) => location.name))], locationOptions: allowedLocations, week, shifts: normalized });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const { db, organizationId, staffId } = await requireEmployeeSession(); const body = await request.json() as Record<string, unknown>; const weekStartsOn = mondayOf(String(body.weekStartsOn || "")); const allowedLocations = await employeeLocations(db, organizationId, staffId); const parsed = shifts(body.shifts, weekStartsOn, allowedLocations); const now = new Date().toISOString();
    const week = await findOrCreateWeek(db, organizationId, staffId, weekStartsOn);
    if (week.status !== "draft") throw new Error("This week was submitted and can no longer be edited.");
    const expectedRevision = Number(body.revision); if (!Number.isInteger(expectedRevision) || expectedRevision !== week.revision) throw new Error("This timesheet changed. Refresh and try again.");
    const guard = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: sql<string>`(
        select organization_id from timesheet_weeks
        where id = ${week.id}
          and organization_id = ${organizationId}
          and staff_id = ${staffId}
          and status = 'draft'
          and revision = ${expectedRevision}
      )`,
      actorType: "staff",
      actorId: staffId,
      action: "timesheet.week_saved",
      entityType: "timesheet_week",
      entityId: week.id,
      detailsJson: JSON.stringify({ weekStartsOn, revision: expectedRevision + 1, shiftCount: parsed.length }),
    });
    const remove = db.delete(timesheetShifts).where(and(eq(timesheetShifts.organizationId, organizationId), eq(timesheetShifts.weekId, week.id), eq(timesheetShifts.staffId, staffId)));
    const update = db.update(timesheetWeeks).set({ revision: expectedRevision + 1, updatedAt: now }).where(and(eq(timesheetWeeks.id, week.id), eq(timesheetWeeks.organizationId, organizationId), eq(timesheetWeeks.staffId, staffId), eq(timesheetWeeks.status, "draft"), eq(timesheetWeeks.revision, expectedRevision))).returning();
    let updated;
    try {
      if (parsed.length) {
        const results = await db.batch([
          guard,
          remove,
          db.insert(timesheetShifts).values(parsed.map((item) => ({ id: item.id, workDate: item.workDate, locationId: item.locationId, locationName: item.locationName, startTime: item.startTime, endTime: item.endTime, tipsCents: item.tipsCents, organizationId, weekId: week.id, staffId }))),
          update,
        ]);
        updated = results[3][0];
      } else {
        const results = await db.batch([guard, remove, update]);
        updated = results[2][0];
      }
    } catch (error) {
      if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new Error("This timesheet changed. Refresh and try again.");
      throw error;
    }
    if (!updated) throw new Error("This timesheet changed. Refresh and try again.");
    return Response.json({ week: updated });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { db, organizationId, staffId } = await requireEmployeeSession(); const body = await request.json() as Record<string, unknown>; const weekStartsOn = mondayOf(String(body.weekStartsOn || "")); const now = new Date().toISOString();
    const [week] = await db.select().from(timesheetWeeks).where(and(eq(timesheetWeeks.organizationId, organizationId), eq(timesheetWeeks.staffId, staffId), eq(timesheetWeeks.weekStartsOn, weekStartsOn))).limit(1);
    if (!week) throw new Error("Save at least one shift before submitting the week.");
    if (week.status !== "draft") return Response.json({ week });
    const rows = await db.select({ id: timesheetShifts.id }).from(timesheetShifts).where(eq(timesheetShifts.weekId, week.id)).limit(1); if (!rows.length) throw new Error("Save at least one shift before submitting the week.");
    let updated;
    try {
      const results = await db.batch([
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: sql<string>`(
            select organization_id from timesheet_weeks
            where id = ${week.id}
              and organization_id = ${organizationId}
              and staff_id = ${staffId}
              and status = 'draft'
              and revision = ${week.revision}
          )`,
          actorType: "staff",
          actorId: staffId,
          action: "timesheet.week_submitted",
          entityType: "timesheet_week",
          entityId: week.id,
          detailsJson: JSON.stringify({ weekStartsOn }),
        }),
        db.update(timesheetWeeks).set({ status: "submitted", submittedAt: now, revision: week.revision + 1, updatedAt: now }).where(and(eq(timesheetWeeks.id, week.id), eq(timesheetWeeks.organizationId, organizationId), eq(timesheetWeeks.staffId, staffId), eq(timesheetWeeks.status, "draft"), eq(timesheetWeeks.revision, week.revision))).returning(),
      ]);
      updated = results[1][0];
    } catch (error) {
      if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new Error("This timesheet changed. Refresh and try again.");
      throw error;
    }
    if (!updated) throw new Error("This timesheet changed. Refresh and try again.");
    return Response.json({ week: updated });
  } catch (error) { return errorResponse(error); }
}
