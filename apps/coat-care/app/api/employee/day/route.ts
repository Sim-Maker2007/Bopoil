import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  appointmentCareRecords,
  appointments,
  locations,
  petWarnings,
  pets,
  services,
  staffClockStates,
  staffLocations,
  timeEntries,
} from "../../../../db/schema";
import { requireEmployeeSession } from "../../../../lib/employee-auth";
import { dateKeyInZone, isValidDateKey } from "../../../../lib/time-zone";

const employeeNextStage: Record<string, string> = {
  confirmed: "arrived",
  arrived: "bathing",
  bathing: "drying",
  drying: "grooming",
  grooming: "quality_check",
  quality_check: "ready",
};
const careCaptureStatuses = new Set(["confirmed", "arrived", "bathing", "drying", "grooming", "quality_check", "ready"]);

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "My Day could not be loaded.";
  return Response.json({ error: message === "EMPLOYEE_AUTH_REQUIRED" ? "Sign-in required." : message }, { status: message === "EMPLOYEE_AUTH_REQUIRED" ? 401 : 400 });
}

export async function GET(request: Request) {
  try {
    const { db, organizationId, staffId, displayName } = await requireEmployeeSession();
    const assignedLocations = await db.select({
      id: locations.id,
      name: locations.name,
      timezone: locations.timezone,
      currency: locations.currency,
    }).from(staffLocations).innerJoin(locations, eq(staffLocations.locationId, locations.id)).where(and(
      eq(staffLocations.organizationId, organizationId),
      eq(staffLocations.staffId, staffId),
      eq(staffLocations.active, true),
      eq(locations.organizationId, organizationId),
      eq(locations.active, true),
    )).orderBy(asc(locations.name));
    if (!assignedLocations.length) return Response.json({ employee: { displayName }, date: "", locations: [], appointments: [], clock: { states: [], recentEntries: [] } });

    const requestedDate = new URL(request.url).searchParams.get("date");
    const day = requestedDate || dateKeyInZone(new Date(), assignedLocations[0].timezone);
    if (!isValidDateKey(day)) throw new Error("Choose a valid date.");
    const locationIds = assignedLocations.map((location) => location.id);
    const noon = new Date(`${day}T12:00:00.000Z`).getTime();
    const broadStart = new Date(noon - 36 * 60 * 60 * 1000).toISOString();
    const broadEnd = new Date(noon + 36 * 60 * 60 * 1000).toISOString();

    const appointmentRows = await db.select({
      id: appointments.id,
      locationId: appointments.locationId,
      locationName: locations.name,
      timezone: locations.timezone,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      clientNotes: appointments.clientNotes,
      petId: pets.id,
      petName: pets.name,
      breed: pets.breed,
      weightKg: pets.weightKg,
      petNotes: pets.clientNotes,
      handlingNotes: pets.handlingNotes,
      safetyLevel: pets.safetyLevel,
      serviceName: services.name,
    }).from(appointments)
      .innerJoin(pets, eq(appointments.petId, pets.id))
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .innerJoin(locations, eq(appointments.locationId, locations.id))
      .where(and(
        eq(appointments.organizationId, organizationId),
        eq(appointments.staffId, staffId),
        inArray(appointments.locationId, locationIds),
        gte(appointments.startsAt, broadStart),
        lt(appointments.startsAt, broadEnd),
      ))
      .orderBy(asc(appointments.startsAt));
    const assignedToday = appointmentRows.filter((appointment) => dateKeyInZone(new Date(appointment.startsAt), appointment.timezone) === day && !["cancelled", "no_show"].includes(appointment.status));
    const appointmentIds = assignedToday.map((appointment) => appointment.id);
    const petIds = [...new Set(assignedToday.map((appointment) => appointment.petId))];
    const [warningRows, careRows, states, recentEntries] = await Promise.all([
      petIds.length ? db.select().from(petWarnings).where(and(
        eq(petWarnings.organizationId, organizationId),
        inArray(petWarnings.petId, petIds),
        eq(petWarnings.active, true),
      )).orderBy(asc(petWarnings.createdAt)) : Promise.resolve([]),
      appointmentIds.length ? db.select().from(appointmentCareRecords).where(and(
        eq(appointmentCareRecords.organizationId, organizationId),
        inArray(appointmentCareRecords.appointmentId, appointmentIds),
      )) : Promise.resolve([]),
      db.select().from(staffClockStates).where(and(
        eq(staffClockStates.organizationId, organizationId),
        eq(staffClockStates.staffId, staffId),
        inArray(staffClockStates.locationId, locationIds),
      )),
      db.select().from(timeEntries).where(and(
        eq(timeEntries.organizationId, organizationId),
        eq(timeEntries.staffId, staffId),
        inArray(timeEntries.locationId, locationIds),
        gte(timeEntries.clockIn, new Date(Date.now() - 14 * 86400000).toISOString()),
      )).orderBy(desc(timeEntries.clockIn)).limit(12),
    ]);
    const locationNames = new Map(assignedLocations.map((location) => [location.id, location.name]));
    const careByAppointment = new Map(careRows.map((care) => [care.appointmentId, care]));

    return Response.json({
      employee: { displayName },
      date: day,
      locations: assignedLocations,
      appointments: assignedToday.map((appointment) => ({
        ...appointment,
        nextStage: employeeNextStage[appointment.status] || null,
        careEditable: careCaptureStatuses.has(appointment.status),
        warnings: warningRows.filter((warning) => warning.petId === appointment.petId),
        care: careByAppointment.get(appointment.id) || null,
      })),
      clock: {
        states,
        recentEntries: recentEntries.map((entry) => ({ ...entry, locationName: locationNames.get(entry.locationId) || "Salon" })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
