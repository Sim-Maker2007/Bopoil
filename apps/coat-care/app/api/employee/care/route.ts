import { and, eq, sql } from "drizzle-orm";
import {
  appointmentCareRecords,
  appointmentChangeClaims,
  appointments,
  auditEvents,
  locations,
  staffLocations,
} from "../../../../db/schema";
import { queueAppointmentMessage } from "../../../../db/communications";
import { canTransitionAppointment } from "../../../../lib/appointment-workflow";
import { requireEmployeeSession } from "../../../../lib/employee-auth";

const employeeStageTargets = new Set(["arrived", "bathing", "drying", "grooming", "quality_check", "ready"]);
const careStatuses = new Set(["confirmed", "arrived", "bathing", "drying", "grooming", "quality_check", "ready"]);
const coatConditions = ["not_assessed", "healthy", "tangled", "matted", "severely_matted", "skin_concern"] as const;

class EmployeeCareError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "EMPLOYEE_AUTH_REQUIRED") {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }
  if (error instanceof EmployeeCareError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Send a valid visit update." }, { status: 400 });
  }
  console.error("Employee care update failed", error);
  return Response.json({ error: "The visit could not be updated." }, { status: 500 });
}

function changedTimestamp(previous: string) {
  const previousTime = new Date(previous).getTime();
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

function appointmentAssignmentGuard(
  appointmentId: string,
  organizationId: string,
  locationId: string,
  staffId: string,
  status: string,
  updatedAt: string,
) {
  return sql<string>`(
    select ${appointments.updatedAt}
    from ${appointments}
    where ${appointments.id} = ${appointmentId}
      and ${appointments.organizationId} = ${organizationId}
      and ${appointments.locationId} = ${locationId}
      and ${appointments.staffId} = ${staffId}
      and ${appointments.status} = ${status}
      and ${appointments.updatedAt} = ${updatedAt}
      and exists (
        select 1
        from ${staffLocations}
        inner join ${locations}
          on ${locations.id} = ${staffLocations.locationId}
          and ${locations.organizationId} = ${organizationId}
          and ${locations.active} = true
        where ${staffLocations.organizationId} = ${organizationId}
          and ${staffLocations.staffId} = ${staffId}
          and ${staffLocations.locationId} = ${locationId}
          and ${staffLocations.active} = true
      )
  )`;
}

async function assignedAppointment(
  db: ReturnType<typeof import("../../../../db").getDb>,
  appointmentId: string,
  organizationId: string,
  staffId: string,
) {
  const [appointment] = await db.select({
    id: appointments.id,
    organizationId: appointments.organizationId,
    locationId: appointments.locationId,
    staffId: appointments.staffId,
    status: appointments.status,
    updatedAt: appointments.updatedAt,
  }).from(appointments)
    .innerJoin(staffLocations, and(
      eq(staffLocations.organizationId, appointments.organizationId),
      eq(staffLocations.locationId, appointments.locationId),
      eq(staffLocations.staffId, staffId),
      eq(staffLocations.active, true),
    ))
    .innerJoin(locations, and(
      eq(locations.id, appointments.locationId),
      eq(locations.organizationId, appointments.organizationId),
      eq(locations.active, true),
    ))
    .where(and(
      eq(appointments.id, appointmentId),
      eq(appointments.organizationId, organizationId),
      eq(appointments.staffId, staffId),
    ))
    .limit(1);
  if (!appointment) throw new EmployeeCareError("This appointment is not assigned to you.", 404);
  return appointment;
}

export async function PATCH(request: Request) {
  try {
    const { db, organizationId, staffId } = await requireEmployeeSession();
    const body = await request.json() as Record<string, unknown>;
    const appointmentId = String(body.appointmentId || "").trim();
    const action = String(body.action || "").trim();
    if (!appointmentId) throw new EmployeeCareError("Choose an assigned appointment.");
    const appointment = await assignedAppointment(db, appointmentId, organizationId, staffId);

    if (action === "advance_stage") {
      const nextStatus = String(body.status || "").trim();
      if (!employeeStageTargets.has(nextStatus) || !canTransitionAppointment(appointment.status, nextStatus)) {
        throw new EmployeeCareError(`A ${appointment.status.replaceAll("_", " ")} appointment cannot move directly to ${nextStatus.replaceAll("_", " ")}.`, 409);
      }
      const changedAt = changedTimestamp(appointment.updatedAt);
      const claim = db.insert(appointmentChangeClaims).values({
        id: crypto.randomUUID(),
        organizationId,
        appointmentId,
        expectedUpdatedAt: appointmentAssignmentGuard(
          appointmentId,
          organizationId,
          appointment.locationId,
          staffId,
          appointment.status,
          appointment.updatedAt,
        ),
        actorType: "staff",
        actorId: staffId,
      });
      const appointmentWrite = db.update(appointments).set({
        status: nextStatus as typeof appointment.status,
        updatedAt: changedAt,
      }).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, organizationId),
        eq(appointments.locationId, appointment.locationId),
        eq(appointments.staffId, staffId),
        eq(appointments.status, appointment.status),
        eq(appointments.updatedAt, appointment.updatedAt),
      )).returning();
      const audit = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId,
        actorType: "staff",
        actorId: staffId,
        action: "appointment.status_changed",
        entityType: "appointment",
        entityId: appointmentId,
        detailsJson: JSON.stringify({
          from: appointment.status,
          to: nextStatus,
          changedAt,
          source: "employee_pin_portal",
        }),
      });
      let updated;
      try {
        const results = await db.batch([claim, appointmentWrite, audit]);
        updated = results[1][0];
      } catch {
        throw new EmployeeCareError("This appointment changed. Refresh My Day and try again.", 409);
      }
      if (!updated) throw new EmployeeCareError("This appointment changed. Refresh My Day and try again.", 409);
      if (nextStatus === "ready") {
        await queueAppointmentMessage(db, {
          appointmentId,
          templateKey: "ready_pickup",
          dedupeKey: `ready_pickup:${appointmentId}`,
        }).catch((communicationError) => {
          console.error("Appointment updated from the employee portal, but the pickup message could not be queued", communicationError);
        });
      }
      return Response.json({ appointment: { id: updated.id, status: updated.status, updatedAt: updated.updatedAt } });
    }

    if (action === "save_care") {
      if (!careStatuses.has(appointment.status)) throw new EmployeeCareError("Care notes are closed for this appointment.", 409);
      const coatCondition = String(body.coatCondition || "not_assessed") as typeof coatConditions[number];
      const styleNotes = String(body.styleNotes || "").trim();
      const productsUsed = String(body.productsUsed || "").trim();
      const internalNotes = String(body.internalNotes || "").trim();
      if (!coatConditions.includes(coatCondition)) throw new EmployeeCareError("Choose a valid coat condition.");
      if (styleNotes.length > 3000) throw new EmployeeCareError("Style notes must be 3,000 characters or fewer.");
      if (productsUsed.length > 1200) throw new EmployeeCareError("Products used must be 1,200 characters or fewer.");
      if (internalNotes.length > 3000) throw new EmployeeCareError("Team notes must be 3,000 characters or fewer.");

      const [existingCare] = await db.select({
        id: appointmentCareRecords.id,
        updatedAt: appointmentCareRecords.updatedAt,
      }).from(appointmentCareRecords).where(and(
        eq(appointmentCareRecords.appointmentId, appointmentId),
        eq(appointmentCareRecords.organizationId, organizationId),
        eq(appointmentCareRecords.locationId, appointment.locationId),
      )).limit(1);
      const expectedCareUpdatedAt = body.expectedUpdatedAt === null || body.expectedUpdatedAt === undefined
        ? null
        : String(body.expectedUpdatedAt);
      if ((existingCare?.updatedAt || null) !== expectedCareUpdatedAt) {
        throw new EmployeeCareError("These care notes changed. Refresh My Day before saving.", 409);
      }
      const careChangedAt = changedTimestamp(existingCare?.updatedAt || appointment.updatedAt);
      const careVersionGuard = existingCare
        ? sql`exists (
            select 1 from ${appointmentCareRecords}
            where ${appointmentCareRecords.appointmentId} = ${appointmentId}
              and ${appointmentCareRecords.organizationId} = ${organizationId}
              and ${appointmentCareRecords.locationId} = ${appointment.locationId}
              and ${appointmentCareRecords.updatedAt} = ${existingCare.updatedAt}
          )`
        : sql`not exists (
            select 1 from ${appointmentCareRecords}
            where ${appointmentCareRecords.appointmentId} = ${appointmentId}
          )`;
      const guardAndAudit = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: sql<string>`(
          select ${appointments.organizationId}
          from ${appointments}
          where ${appointments.id} = ${appointmentId}
            and ${appointments.organizationId} = ${organizationId}
            and ${appointments.locationId} = ${appointment.locationId}
            and ${appointments.staffId} = ${staffId}
            and ${appointments.status} = ${appointment.status}
            and ${appointments.updatedAt} = ${appointment.updatedAt}
            and ${careVersionGuard}
            and exists (
              select 1
              from ${staffLocations}
              inner join ${locations}
                on ${locations.id} = ${staffLocations.locationId}
                and ${locations.organizationId} = ${organizationId}
                and ${locations.active} = true
              where ${staffLocations.organizationId} = ${organizationId}
                and ${staffLocations.staffId} = ${staffId}
                and ${staffLocations.locationId} = ${appointment.locationId}
                and ${staffLocations.active} = true
            )
        )`,
        actorType: "staff",
        actorId: staffId,
        action: "appointment.care_record_updated",
        entityType: "appointment",
        entityId: appointmentId,
        detailsJson: JSON.stringify({
          coatCondition,
          source: "employee_pin_portal",
          updatedAt: careChangedAt,
        }),
      });
      const careWrite = db.insert(appointmentCareRecords).values({
        id: existingCare?.id || `care_${appointmentId}`,
        organizationId,
        locationId: appointment.locationId,
        appointmentId,
        coatCondition,
        styleNotes,
        productsUsed,
        internalNotes,
        completedByStaffId: staffId,
        updatedAt: careChangedAt,
      }).onConflictDoUpdate({
        target: appointmentCareRecords.appointmentId,
        set: {
          coatCondition,
          styleNotes,
          productsUsed,
          internalNotes,
          completedByStaffId: staffId,
          updatedAt: careChangedAt,
        },
      }).returning();
      try {
        const results = await db.batch([guardAndAudit, careWrite]);
        const record = results[1][0];
        if (!record) throw new EmployeeCareError("Care notes could not be saved.", 409);
        return Response.json({ care: record });
      } catch (error) {
        if (error instanceof EmployeeCareError) throw error;
        throw new EmployeeCareError("This appointment or its care notes changed. Refresh My Day and try again.", 409);
      }
    }

    throw new EmployeeCareError("Choose a valid visit action.");
  } catch (error) {
    return errorResponse(error);
  }
}
