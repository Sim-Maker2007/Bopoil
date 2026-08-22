import { and, asc, eq, gt, gte, lt, ne } from "drizzle-orm";
import { getDb } from ".";
import { PILOT, ensurePilotData } from "./pilot";
import { appointmentReservations, appointments, locationHours, locations, salonSettings, services, staff, staffAvailability, staffLocations, staffServiceSkills } from "./schema";
import { appointmentUsesSegment, generateAvailability, ResourceKind, segmentsForAppointment, ServiceProfile } from "../lib/availability-engine";
import { zonedDayBounds } from "../lib/time-zone";
import { releaseExpiredBookingHolds } from "./booking-holds";

type Db = ReturnType<typeof getDb>;
const RESERVATION_INSERT_SIZE = 10;

// D1 currently enforces SQLite's low bind-variable ceiling. Each reservation
// row binds seven values, so keep inserts comfortably below that ceiling while
// allowing callers to include every statement in one atomic db.batch().
export function reservationInsertStatements(db: Db, rows: Array<typeof appointmentReservations.$inferInsert>) {
  const statements = [];
  for (let index = 0; index < rows.length; index += RESERVATION_INSERT_SIZE) {
    statements.push(db.insert(appointmentReservations).values(rows.slice(index, index + RESERVATION_INSERT_SIZE)));
  }
  return statements;
}

export async function loadAvailability(serviceId: string, dates: string[], options: { now?: Date; organizationId?: string; locationId?: string; excludeAppointmentId?: string; includeWhenOnlineBookingPaused?: boolean; minimumLeadMinutesOverride?: number } = {}) {
  await ensurePilotData();
  const db = getDb(); const organizationId = options.organizationId || PILOT.organizationId; const locationId = options.locationId || PILOT.locationId; const now = options.now || new Date();
  await releaseExpiredBookingHolds(db, locationId, now);
  const first = dates[0], last = dates.at(-1);
  if (!first || !last) throw new Error("Choose at least one date.");
  const [[location], [settings], [service], hours, staffRows] = await Promise.all([
    db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.organizationId, organizationId), eq(locations.active, true))).limit(1),
    db.select().from(salonSettings).where(eq(salonSettings.locationId, locationId)).limit(1),
    db.select().from(services).where(and(eq(services.id, serviceId), eq(services.locationId, locationId), eq(services.active, true))).limit(1),
    db.select().from(locationHours).where(eq(locationHours.locationId, locationId)).orderBy(asc(locationHours.weekday)),
    db.select({ id: staff.id, name: staff.displayName, weekday: staffAvailability.weekday, startTime: staffAvailability.startTime, endTime: staffAvailability.endTime })
      .from(staffServiceSkills).innerJoin(staff, eq(staffServiceSkills.staffId, staff.id)).innerJoin(staffLocations, and(eq(staffLocations.staffId, staff.id), eq(staffLocations.locationId, locationId))).innerJoin(staffAvailability, and(eq(staffAvailability.staffId, staff.id), eq(staffAvailability.locationId, locationId)))
      .where(and(eq(staffServiceSkills.locationId, locationId), eq(staffServiceSkills.serviceId, serviceId), eq(staffLocations.active, true), eq(staff.active, true), eq(staffAvailability.active, true))).orderBy(asc(staff.displayName)),
  ]);
  if (!location || !settings || !service) return { db, location, settings, service: null, hours, staffRows, appointmentRows: [], slots: [] };
  const rangeStart = zonedDayBounds(first, location.timezone).start; const rangeEnd = zonedDayBounds(last, location.timezone).end;
  const appointmentRows = await db.select({ id: appointments.id, staffId: appointments.staffId, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, bathMinutes: services.bathMinutes, dryerMinutes: services.dryerMinutes, groomingTableMinutes: services.groomingTableMinutes, kennelMinutes: services.kennelMinutes })
    .from(appointments).innerJoin(services, eq(appointments.serviceId, services.id)).where(and(eq(appointments.locationId, locationId), lt(appointments.startsAt, rangeEnd.toISOString()), gt(appointments.endsAt, rangeStart.toISOString()), options.excludeAppointmentId ? ne(appointments.id, options.excludeAppointmentId) : undefined));
  const profile: ServiceProfile = service;
  const capacity = { pet_capacity: settings.maxConcurrentPets, bath: settings.bathStations, table: settings.groomingTables, dryer: settings.dryers, kennel: settings.kennels };
  const minimumLeadMinutes = options.minimumLeadMinutesOverride == null
    ? settings.minimumLeadMinutes
    : Math.max(0, options.minimumLeadMinutesOverride);
  const slots = settings.allowOnlineBooking || options.includeWhenOnlineBookingPaused ? generateAvailability({ dates, timezone: location.timezone, now, minimumLeadMinutes, bookingWindowDays: settings.bookingWindowDays, service: profile, hours, staff: staffRows, appointments: appointmentRows, capacity }) : [];
  return { db, location, settings, service, hours, staffRows, appointmentRows, capacity, slots };
}

export async function buildReservationRows(db: Db, input: { appointmentId: string; organizationId?: string; locationId?: string; excludeAppointmentId?: string; staffId: string; startsAt: string; endsAt: string; service: ServiceProfile; capacity: Record<ResourceKind, number>; existingAppointments: Array<{ id: string; staffId: string | null; startsAt: string; endsAt: string; status: string; bathMinutes: number; dryerMinutes: number; groomingTableMinutes: number; kennelMinutes: number }> }) {
  const organizationId = input.organizationId || PILOT.organizationId;
  const locationId = input.locationId || PILOT.locationId;
  const segments = segmentsForAppointment(input.startsAt, input.endsAt, input.service);
  const allSegments = Object.values(segments).flat().sort(); const min = allSegments[0], max = allSegments.at(-1);
  const existingReservations = min && max ? await db.select({ appointmentId: appointmentReservations.appointmentId, kind: appointmentReservations.kind, resourceKey: appointmentReservations.resourceKey, segmentStart: appointmentReservations.segmentStart })
    .from(appointmentReservations).innerJoin(appointments, eq(appointmentReservations.appointmentId, appointments.id)).where(and(eq(appointmentReservations.locationId, locationId), gte(appointmentReservations.segmentStart, min), lt(appointmentReservations.segmentStart, new Date(new Date(max).getTime() + 15 * 60_000).toISOString()), ne(appointments.status, "cancelled"), ne(appointments.status, "no_show"), input.excludeAppointmentId ? ne(appointments.id, input.excludeAppointmentId) : undefined)) : [];
  const values: Array<typeof appointmentReservations.$inferInsert> = [];
  for (const segment of segments.pet_capacity) values.push({ id: crypto.randomUUID(), organizationId, locationId, appointmentId: input.appointmentId, kind: "staff", resourceKey: input.staffId, segmentStart: segment });
  for (const kind of ["pet_capacity", "bath", "table", "dryer", "kennel"] as const) {
    for (const segment of segments[kind]) {
      const reservations = existingReservations.filter((item) => item.kind === kind && item.segmentStart === segment);
      const reservedAppointmentIds = new Set(reservations.map((item) => item.appointmentId));
      const legacyCount = input.existingAppointments.filter((item) => !reservedAppointmentIds.has(item.id) && !["cancelled", "no_show"].includes(item.status) && appointmentUsesSegment(item, kind, segment)).length;
      const unavailable = new Set(reservations.map((item) => item.resourceKey));
      for (let index = 0; index < legacyCount; index += 1) unavailable.add(String(index));
      let lane = -1; for (let index = 0; index < input.capacity[kind]; index += 1) if (!unavailable.has(String(index))) { lane = index; break; }
      if (lane < 0) return null;
      values.push({ id: crypto.randomUUID(), organizationId, locationId, appointmentId: input.appointmentId, kind, resourceKey: String(lane), segmentStart: segment });
    }
  }
  return values;
}
