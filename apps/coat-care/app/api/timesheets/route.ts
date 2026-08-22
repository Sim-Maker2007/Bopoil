import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  auditEvents,
  employeePortalCredentials,
  employeePortalInvitations,
  employeePortalSessions,
  locations,
  staff,
  staffLocations,
  timeEntries,
  timesheetShifts,
  timesheetWeeks,
} from "../../../db/schema";
import { randomToken, sha256 } from "../../../lib/employee-auth";
import { deliverEmployeeInvitation } from "../../../lib/employee-invitation-delivery";
import { deliveryConfig } from "../../../lib/message-delivery";
import { safePublicOrigin } from "../../../lib/portal-links";
import { zonedDateTimeToUtc } from "../../../lib/time-zone";
import {
  requireSalonAccess,
  requireSalonManager,
  requireWorkspacePermission,
  salonApiError,
  SalonAccessError,
} from "../../salon-access";

function mondayOf(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()))
    throw new SalonAccessError("Invalid week.", 400);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function timeMinutes(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function torontoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type LocationOption = { id: string; name: string; label?: string };
type ShiftInput = Record<string, unknown> & {
  locationId?: unknown;
  locationName?: unknown;
};

function labelLocations(
  rows: Array<{ id: string; name: string; city: string }>,
): LocationOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + 1);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: counts.get(row.name)! > 1 ? `${row.name} · ${row.city}` : row.name,
  }));
}

async function organizationLocations(
  db: ReturnType<typeof import("../../../db").getDb>,
  organizationId: string,
) {
  const rows = await db
    .select({ id: locations.id, name: locations.name, city: locations.city })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, organizationId),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.name), asc(locations.city));
  return labelLocations(rows);
}

async function permittedStaffLocations(
  db: ReturnType<typeof import("../../../db").getDb>,
  organizationId: string,
  staffId: string,
) {
  const rows = await db
    .select({ id: locations.id, name: locations.name, city: locations.city })
    .from(staffLocations)
    .innerJoin(locations, eq(staffLocations.locationId, locations.id))
    .where(
      and(
        eq(staffLocations.organizationId, organizationId),
        eq(staffLocations.staffId, staffId),
        eq(staffLocations.active, true),
        eq(locations.organizationId, organizationId),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.name), asc(locations.city));
  return labelLocations([
    ...new Map(rows.map((row) => [row.id, row])).values(),
  ]);
}

function resolveLocation<T extends LocationOption>(
  item: ShiftInput,
  allowedLocations: readonly T[],
) {
  const locationId = String(item.locationId || "");
  if (locationId)
    return (
      allowedLocations.find((location) => location.id === locationId) || null
    );
  const locationName = String(item.locationName || "");
  const matches = allowedLocations.filter(
    (location) => location.name === locationName,
  );
  return matches.length === 1 ? matches[0] : null;
}

function parseShifts(
  value: unknown,
  weekStartsOn: string,
  allowedLocations: readonly LocationOption[],
) {
  if (!Array.isArray(value) || value.length > 30)
    throw new SalonAccessError("The timesheet has too many shifts.", 400);
  const dates = new Set(
    Array.from({ length: 7 }, (_, index) => addDays(weekStartsOn, index)),
  );
  const result = value.map((raw) => {
    const item = raw as ShiftInput;
    const workDate = String(item.workDate || "");
    const location = resolveLocation(item, allowedLocations);
    const startTime = String(item.startTime || "");
    const endTime = String(item.endTime || "");
    const start = timeMinutes(startTime);
    const end = timeMinutes(endTime);
    const tipsCents = Math.round(Number(item.tips || 0) * 100);
    if (
      !dates.has(workDate) ||
      !location ||
      !Number.isFinite(tipsCents) ||
      tipsCents < 0 ||
      tipsCents > 10_000_000 ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      throw new SalonAccessError(
        "Check the dates, times, assigned locations, and tips.",
        400,
      );
    return {
      id: String(item.id || crypto.randomUUID()),
      workDate,
      locationId: location.id,
      locationName: location.name,
      startTime,
      endTime,
      tipsCents,
    };
  });
  for (const date of dates) {
    const day = result
      .filter((item) => item.workDate === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < day.length; index += 1)
      if (day[index].startTime < day[index - 1].endTime)
        throw new SalonAccessError("Two shifts overlap on the same day.", 400);
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "workforce");
    requireSalonManager(membership);
    const url = new URL(request.url);
    const weekStartsOn = mondayOf(
      url.searchParams.get("week") || torontoDate(),
    );
    const team = await db
      .select({
        id: staff.id,
        displayName: staff.displayName,
        email: staff.email,
        role: staffLocations.role,
      })
      .from(staffLocations)
      .innerJoin(staff, eq(staffLocations.staffId, staff.id))
      .where(
        and(
          eq(staffLocations.organizationId, membership.organizationId),
          eq(staffLocations.locationId, membership.locationId),
          eq(staffLocations.active, true),
          eq(staff.active, true),
        ),
      )
      .orderBy(asc(staff.displayName));
    const teamIds = team.map((person) => person.id);
    const credentials = teamIds.length
      ? await db
          .select({
            staffId: employeePortalCredentials.staffId,
            employeeCode: employeePortalCredentials.employeeCode,
            active: employeePortalCredentials.active,
          })
          .from(employeePortalCredentials)
          .where(
            and(
              eq(
                employeePortalCredentials.organizationId,
                membership.organizationId,
              ),
              inArray(employeePortalCredentials.staffId, teamIds),
            ),
          )
      : [];
    const weeks = teamIds.length
      ? await db
          .select()
          .from(timesheetWeeks)
          .where(
            and(
              eq(timesheetWeeks.organizationId, membership.organizationId),
              eq(timesheetWeeks.weekStartsOn, weekStartsOn),
              inArray(timesheetWeeks.staffId, teamIds),
            ),
          )
          .orderBy(asc(timesheetWeeks.createdAt))
      : [];
    const weekIds = weeks.map((week) => week.id);
    const shifts = weekIds.length
      ? await db
          .select()
          .from(timesheetShifts)
          .where(
            and(
              eq(timesheetShifts.organizationId, membership.organizationId),
              inArray(timesheetShifts.weekId, weekIds),
            ),
          )
          .orderBy(
            asc(timesheetShifts.workDate),
            asc(timesheetShifts.startTime),
          )
      : [];
    const [[currentLocation], allowedLocations] = await Promise.all([
      db
        .select({ currency: locations.currency })
        .from(locations)
        .where(
          and(
            eq(locations.id, membership.locationId),
            eq(locations.organizationId, membership.organizationId),
          ),
        )
        .limit(1),
      organizationLocations(db, membership.organizationId),
    ]);
    const access = new Map(credentials.map((item) => [item.staffId, item]));
    return Response.json({
      weekStartsOn,
      organizationName: membership.organizationName,
      currency: currentLocation?.currency || "CAD",
      locations: [
        ...new Set(allowedLocations.map((location) => location.name)),
      ],
      locationOptions: allowedLocations,
      team: team.map((person) => ({
        ...person,
        portal: access.get(person.id) || null,
      })),
      weeks: weeks.map((week) => ({
        ...week,
        staffName:
          team.find((person) => person.id === week.staffId)?.displayName ||
          "Employee",
        shifts: shifts
          .filter((shift) => shift.weekId === week.id)
          .map((shift) => {
            const legacyMatches = allowedLocations.filter(
              (location) => location.name === shift.locationName,
            );
            return {
              ...shift,
              locationId:
                shift.locationId ||
                (legacyMatches.length === 1 ? legacyMatches[0].id : null),
              tips: shift.tipsCents / 100,
              paidMinutes:
                timeMinutes(shift.endTime) - timeMinutes(shift.startTime),
            };
          }),
      })),
    });
  } catch (error) {
    return salonApiError(error, "Timesheets could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "workforce");
    requireSalonManager(membership);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "invite");
    let staffId = String(body.staffId || "");
    const now = new Date().toISOString();
    let newEmployee: {
      id: string;
      displayName: string;
      email: string;
      role: "receptionist" | "groomer" | "bather";
    } | null = null;
    if (action === "create_employee") {
      const displayName = String(body.displayName || "").trim();
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const allowedRoles = ["receptionist", "groomer", "bather"] as const;
      const requestedRole = String(body.role || "groomer");
      const role = allowedRoles.includes(
        requestedRole as (typeof allowedRoles)[number],
      )
        ? (requestedRole as (typeof allowedRoles)[number])
        : "groomer";
      if (displayName.length < 2 || displayName.length > 80)
        throw new SalonAccessError("Enter the employee's full name.", 400);
      if (email && !/^\S+@\S+\.\S+$/.test(email))
        throw new SalonAccessError("Enter a valid email address.", 400);
      if (email) {
        const [existing] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(
            and(
              eq(staff.organizationId, membership.organizationId),
              eq(staff.email, email),
            ),
          )
          .limit(1);
        if (existing)
          throw new SalonAccessError(
            "A team member already uses this email address.",
            409,
          );
      }
      staffId = crypto.randomUUID();
      newEmployee = { id: staffId, displayName, email, role };
    }
    const person =
      newEmployee ||
      (
        await db
          .select({
            id: staff.id,
            displayName: staff.displayName,
            email: staff.email,
          })
          .from(staffLocations)
          .innerJoin(staff, eq(staffLocations.staffId, staff.id))
          .where(
            and(
              eq(staff.id, staffId),
              eq(staff.organizationId, membership.organizationId),
              eq(staffLocations.organizationId, membership.organizationId),
              eq(staffLocations.locationId, membership.locationId),
              eq(staffLocations.active, true),
              eq(staff.active, true),
            ),
          )
          .limit(1)
      )[0];
    if (!person) throw new SalonAccessError("Employee not found.", 404);
    if (action === "invite" || action === "create_employee") {
      const token = randomToken();
      const invitationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const publicOrigin =
        safePublicOrigin(process.env.DELIVERY_PUBLIC_URL) ||
        safePublicOrigin(request.url);
      if (!publicOrigin)
        throw new Error(
          "A secure public site URL is required to create an employee invitation.",
        );
      const invitationUrl = new URL(
        `/employee/setup/${encodeURIComponent(token)}`,
        publicOrigin,
      ).toString();
      const invitationInsert = db.insert(employeePortalInvitations).values({
        id: invitationId,
        organizationId: membership.organizationId,
        staffId,
        tokenHash: await sha256(token),
        expiresAt,
        invitedByStaffId: membership.id,
      });
      const invitationAudit = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        actorType: "staff",
        actorId: membership.id,
        action: "employee_portal.invited",
        entityType: "staff",
        entityId: staffId,
        detailsJson: JSON.stringify({
          expiresAt,
          hasEmail: Boolean(person.email),
        }),
      });
      if (newEmployee) {
        await db.batch([
          db.insert(staff).values({
            id: staffId,
            organizationId: membership.organizationId,
            locationId: membership.locationId,
            email: newEmployee.email || null,
            displayName: newEmployee.displayName,
            role: newEmployee.role,
          }),
          db.insert(staffLocations).values({
            id: crypto.randomUUID(),
            organizationId: membership.organizationId,
            staffId,
            locationId: membership.locationId,
            role: newEmployee.role,
          }),
          db.insert(auditEvents).values({
            id: crypto.randomUUID(),
            organizationId: membership.organizationId,
            actorType: "staff",
            actorId: membership.id,
            action: "timesheet.employee_created",
            entityType: "staff",
            entityId: staffId,
            detailsJson: JSON.stringify({
              role: newEmployee.role,
              hasEmail: Boolean(newEmployee.email),
            }),
          }),
          invitationInsert,
          invitationAudit,
        ]);
      } else {
        await db.batch([
          db
            .update(employeePortalInvitations)
            .set({ revokedAt: now })
            .where(
              and(
                eq(
                  employeePortalInvitations.organizationId,
                  membership.organizationId,
                ),
                eq(employeePortalInvitations.staffId, staffId),
                isNull(employeePortalInvitations.usedAt),
                isNull(employeePortalInvitations.revokedAt),
              ),
            ),
          invitationInsert,
          invitationAudit,
        ]);
      }

      const invitationDelivery = await deliverEmployeeInvitation(
        {
          invitationId,
          recipient: person.email || "",
          displayName: person.displayName,
          organizationName: membership.organizationName,
          employeeInvitationUrl: invitationUrl,
          crmUrl: null,
          expiresAt,
        },
        deliveryConfig(),
      );
      try {
        await db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: membership.organizationId,
          actorType: "system",
          action:
            invitationDelivery.state === "sent"
              ? "employee_invitation.email_sent"
              : invitationDelivery.state === "failed"
                ? "employee_invitation.email_failed"
                : "employee_invitation.manual_share_required",
          entityType: "staff",
          entityId: staffId,
          detailsJson: JSON.stringify({
            state: invitationDelivery.state,
            recipient: invitationDelivery.recipient,
            reason:
              "reason" in invitationDelivery
                ? invitationDelivery.reason
                : undefined,
            providerMessageId:
              invitationDelivery.state === "sent"
                ? invitationDelivery.providerMessageId
                : undefined,
          }),
        });
      } catch (auditError) {
        console.error(
          "Employee invitation delivery result could not be audited",
          auditError,
        );
      }
      return Response.json({
        invitationUrl,
        displayName: person.displayName,
        expiresAt,
        delivery: {
          state: invitationDelivery.state,
          recipient: invitationDelivery.recipient,
          reason:
            "reason" in invitationDelivery ? invitationDelivery.reason : null,
        },
      });
    }
    if (action === "revoke") {
      await db.batch([
        db
          .update(employeePortalSessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(
                employeePortalSessions.organizationId,
                membership.organizationId,
              ),
              eq(employeePortalSessions.staffId, staffId),
              isNull(employeePortalSessions.revokedAt),
            ),
          ),
        db
          .update(employeePortalCredentials)
          .set({ active: false, updatedAt: now })
          .where(
            and(
              eq(
                employeePortalCredentials.organizationId,
                membership.organizationId,
              ),
              eq(employeePortalCredentials.staffId, staffId),
            ),
          ),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: membership.organizationId,
          actorType: "staff",
          actorId: membership.id,
          action: "employee_portal.revoked",
          entityType: "staff",
          entityId: staffId,
        }),
      ]);
      return Response.json({ ok: true });
    }
    throw new SalonAccessError("Unsupported action.", 400);
  } catch (error) {
    return salonApiError(error, "Employee access could not be updated.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "workforce");
    requireSalonManager(membership);
    const body = (await request.json()) as Record<string, unknown>;
    const weekId = String(body.weekId || "");
    const action = String(body.action || "save");
    const [week] = await db
      .select()
      .from(timesheetWeeks)
      .where(
        and(
          eq(timesheetWeeks.id, weekId),
          eq(timesheetWeeks.organizationId, membership.organizationId),
        ),
      )
      .limit(1);
    if (!week) throw new SalonAccessError("Timesheet not found.", 404);
    const [visibleStaff] = await db
      .select({ id: staffLocations.id })
      .from(staffLocations)
      .where(
        and(
          eq(staffLocations.organizationId, membership.organizationId),
          eq(staffLocations.locationId, membership.locationId),
          eq(staffLocations.staffId, week.staffId),
          eq(staffLocations.active, true),
        ),
      )
      .limit(1);
    if (!visibleStaff) throw new SalonAccessError("Timesheet not found.", 404);
    const now = new Date().toISOString();
    const expectedRevision = Number(body.revision);
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== week.revision
    )
      throw new SalonAccessError(
        "This timesheet changed. Refresh and try again.",
        409,
      );
    const guardOrganizationId = (
      requiredStatus?: "submitted" | "approved",
      additionalGuard = sql``,
    ) => sql<string>`(
      select organization_id from timesheet_weeks
      where id = ${week.id}
        and organization_id = ${membership.organizationId}
        and revision = ${expectedRevision}
        ${requiredStatus ? sql`and status = ${requiredStatus}` : sql``}
        ${additionalGuard}
    )`;
    if (action === "approve") {
      if (week.status === "approved") return Response.json({ week });
      if (week.status !== "submitted")
        throw new SalonAccessError("Submit the week before approving it.", 409);
      const submittedShifts = await db
        .select()
        .from(timesheetShifts)
        .where(
          and(
            eq(timesheetShifts.organizationId, membership.organizationId),
            eq(timesheetShifts.weekId, week.id),
            eq(timesheetShifts.staffId, week.staffId),
          ),
        )
        .orderBy(asc(timesheetShifts.workDate), asc(timesheetShifts.startTime));
      if (!submittedShifts.length)
        throw new SalonAccessError("The submitted week has no shifts.", 409);
      const assignedLocations = await db
        .select({
          id: locations.id,
          name: locations.name,
          timezone: locations.timezone,
        })
        .from(staffLocations)
        .innerJoin(locations, eq(staffLocations.locationId, locations.id))
        .where(
          and(
            eq(staffLocations.organizationId, membership.organizationId),
            eq(staffLocations.staffId, week.staffId),
            eq(staffLocations.active, true),
            eq(locations.organizationId, membership.organizationId),
            eq(locations.active, true),
          ),
        );
      const candidates = submittedShifts.map((shift) => {
        const location = resolveLocation(shift, assignedLocations);
        if (!location)
          throw new SalonAccessError(
            `The location "${shift.locationName}" is no longer assigned to this employee.`,
            409,
          );
        const clockIn = zonedDateTimeToUtc(
          shift.workDate,
          shift.startTime,
          location.timezone,
        ).toISOString();
        const clockOut = zonedDateTimeToUtc(
          shift.workDate,
          shift.endTime,
          location.timezone,
        ).toISOString();
        return { shift, location, clockIn, clockOut };
      });
      for (let left = 0; left < candidates.length; left += 1) {
        for (let right = left + 1; right < candidates.length; right += 1) {
          if (
            candidates[left].clockIn < candidates[right].clockOut &&
            candidates[right].clockIn < candidates[left].clockOut
          )
            throw new SalonAccessError(
              "Two weekly shifts overlap after location time zones are applied.",
              409,
            );
        }
      }
      const minStart = new Date(
        Math.min(
          ...candidates.map((candidate) =>
            new Date(candidate.clockIn).getTime(),
          ),
        ),
      ).toISOString();
      const maxEnd = new Date(
        Math.max(
          ...candidates.map((candidate) =>
            new Date(candidate.clockOut).getTime(),
          ),
        ),
      ).toISOString();
      const existingEntries = await db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.organizationId, membership.organizationId),
            eq(timeEntries.staffId, week.staffId),
            ne(timeEntries.status, "void"),
            lt(timeEntries.clockIn, maxEnd),
            or(
              isNull(timeEntries.clockOut),
              gt(timeEntries.clockOut, minStart),
            ),
          ),
        );
      const reusedEntryIds: string[] = [];
      const materialized = candidates.flatMap((candidate) => {
        const overlaps = existingEntries.filter(
          (entry) =>
            entry.clockIn < candidate.clockOut &&
            (entry.clockOut === null || entry.clockOut > candidate.clockIn),
        );
        const exactApprovedEntry = overlaps.find(
          (entry) =>
            entry.locationId === candidate.location.id &&
            entry.status === "approved" &&
            entry.clockIn === candidate.clockIn &&
            entry.clockOut === candidate.clockOut &&
            entry.breakMinutes === 0,
        );
        if (overlaps.length) {
          if (
            !exactApprovedEntry ||
            overlaps.some((entry) => entry.id !== exactApprovedEntry.id)
          )
            throw new SalonAccessError(
              "An existing punch overlaps this weekly shift. Correct or void it before approval.",
              409,
            );
          reusedEntryIds.push(exactApprovedEntry.id);
          return [];
        }
        return [
          {
            id: crypto.randomUUID(),
            organizationId: membership.organizationId,
            locationId: candidate.location.id,
            staffId: week.staffId,
            clockIn: candidate.clockIn,
            clockOut: candidate.clockOut,
            status: "approved" as const,
            source: "manual" as const,
            note: `Approved PIN timesheet ${week.id}`,
            idempotencyKey: `pin-timesheet:${week.id}:${candidate.shift.id}:r${expectedRevision}`,
            enteredByStaffId: membership.id,
            approvedByStaffId: membership.id,
            approvedAt: now,
            updatedAt: now,
          },
        ];
      });
      const overlapPredicates = sql.join(candidates.map((candidate) =>
        sql`(clock_in < ${candidate.clockOut} and (clock_out is null or clock_out > ${candidate.clockIn}))`
      ), sql` or `);
      const reusedExclusion = reusedEntryIds.length
        ? sql`and id not in (${sql.join(reusedEntryIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``;
      const entrySnapshotGuard = sql`and not exists (
        select 1 from time_entries
        where organization_id = ${membership.organizationId}
          and staff_id = ${week.staffId}
          and status <> 'void'
          and (${overlapPredicates})
          ${reusedExclusion}
      )`;
      const audit = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: guardOrganizationId("submitted", entrySnapshotGuard),
        actorType: "staff",
        actorId: membership.id,
        action: "timesheet.week_approved_materialized",
        entityType: "timesheet_week",
        entityId: week.id,
        detailsJson: JSON.stringify({
          revision: expectedRevision,
          materializedEntryIds: materialized.map((entry) => entry.id),
          reusedEntryIds,
          tipsCents: submittedShifts.reduce(
            (sum, shift) => sum + shift.tipsCents,
            0,
          ),
        }),
      });
      const update = db
        .update(timesheetWeeks)
        .set({
          status: "approved",
          revision: expectedRevision + 1,
          updatedByStaffId: membership.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(timesheetWeeks.id, week.id),
            eq(timesheetWeeks.organizationId, membership.organizationId),
            eq(timesheetWeeks.status, "submitted"),
            eq(timesheetWeeks.revision, expectedRevision),
          ),
        )
        .returning();
      let updated;
      try {
        if (materialized.length) {
          const results = await db.batch([
            audit,
            db.insert(timeEntries).values(materialized),
            update,
          ]);
          updated = results[2][0];
        } else {
          const results = await db.batch([audit, update]);
          updated = results[1][0];
        }
      } catch (error) {
        if (
          error instanceof Error &&
          /constraint|null|unique/i.test(error.message)
        )
          throw new SalonAccessError(
            "This week changed or was already approved. Refresh and try again.",
            409,
          );
        throw error;
      }
      if (!updated)
        throw new SalonAccessError(
          "This week changed or was already approved. Refresh and try again.",
          409,
        );
      return Response.json({
        week: updated,
        materializedCount: materialized.length,
        reusedCount: reusedEntryIds.length,
      });
    }
    if (action === "reopen") {
      if (!["submitted", "approved"].includes(week.status))
        throw new SalonAccessError(
          "Only a submitted or approved week can be reopened.",
          409,
        );
      const priorStatus: "submitted" | "approved" =
        week.status === "approved" ? "approved" : "submitted";
      let updated;
      try {
        const audit = db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          organizationId: guardOrganizationId(priorStatus),
          actorType: "staff",
          actorId: membership.id,
          action: "timesheet.week_reopened",
          entityType: "timesheet_week",
          entityId: week.id,
          detailsJson: JSON.stringify({
            priorStatus,
            materializedEntriesVoided: priorStatus === "approved",
          }),
        });
        const update = db
          .update(timesheetWeeks)
          .set({
            status: "draft",
            submittedAt: null,
            revision: expectedRevision + 1,
            updatedByStaffId: membership.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(timesheetWeeks.id, week.id),
              eq(timesheetWeeks.organizationId, membership.organizationId),
              eq(timesheetWeeks.status, priorStatus),
              eq(timesheetWeeks.revision, expectedRevision),
            ),
          )
          .returning();
        if (priorStatus === "approved") {
          const results = await db.batch([
            audit,
            db
              .update(timeEntries)
              .set({ status: "void", updatedAt: now })
              .where(
                and(
                  eq(timeEntries.organizationId, membership.organizationId),
                  eq(timeEntries.staffId, week.staffId),
                  like(
                    timeEntries.idempotencyKey,
                    `pin-timesheet:${week.id}:%`,
                  ),
                ),
              ),
            update,
          ]);
          updated = results[2][0];
        } else {
          const results = await db.batch([audit, update]);
          updated = results[1][0];
        }
      } catch (error) {
        if (
          error instanceof Error &&
          /constraint|null|unique/i.test(error.message)
        )
          throw new SalonAccessError(
            "This timesheet changed. Refresh and try again.",
            409,
          );
        throw error;
      }
      if (!updated)
        throw new SalonAccessError(
          "This timesheet changed. Refresh and try again.",
          409,
        );
      return Response.json({ week: updated });
    }
    if (action !== "save")
      throw new SalonAccessError("Unsupported action.", 400);
    if (week.status === "approved")
      throw new SalonAccessError(
        "Reopen an approved week before correcting it.",
        409,
      );
    const allowedLocations = await permittedStaffLocations(
      db,
      membership.organizationId,
      week.staffId,
    );
    const parsed = parseShifts(
      body.shifts,
      week.weekStartsOn,
      allowedLocations,
    );
    const guard = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: guardOrganizationId(),
      actorType: "staff",
      actorId: membership.id,
      action: "timesheet.week_corrected",
      entityType: "timesheet_week",
      entityId: week.id,
      detailsJson: JSON.stringify({
        revision: expectedRevision + 1,
        shiftCount: parsed.length,
      }),
    });
    const remove = db
      .delete(timesheetShifts)
      .where(
        and(
          eq(timesheetShifts.organizationId, membership.organizationId),
          eq(timesheetShifts.weekId, week.id),
          eq(timesheetShifts.staffId, week.staffId),
        ),
      );
    const update = db
      .update(timesheetWeeks)
      .set({
        revision: expectedRevision + 1,
        updatedByStaffId: membership.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(timesheetWeeks.id, week.id),
          eq(timesheetWeeks.organizationId, membership.organizationId),
          eq(timesheetWeeks.revision, expectedRevision),
        ),
      )
      .returning();
    let updated;
    try {
      if (parsed.length) {
        const results = await db.batch([
          guard,
          remove,
          db.insert(timesheetShifts).values(
            parsed.map((shift) => ({
              ...shift,
              organizationId: membership.organizationId,
              weekId: week.id,
              staffId: week.staffId,
            })),
          ),
          update,
        ]);
        updated = results[3][0];
      } else {
        const results = await db.batch([guard, remove, update]);
        updated = results[2][0];
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /constraint|null|unique/i.test(error.message)
      )
        throw new SalonAccessError(
          "This timesheet changed. Refresh and try again.",
          409,
        );
      throw error;
    }
    if (!updated)
      throw new SalonAccessError(
        "This timesheet changed. Refresh and try again.",
        409,
      );
    return Response.json({ week: updated });
  } catch (error) {
    return salonApiError(error, "The timesheet could not be updated.");
  }
}
