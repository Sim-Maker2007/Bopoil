import { and, eq } from "drizzle-orm";
import { loadAvailability } from "../../../../../db/availability";
import { resolvePortalSession } from "../../../../../db/client-portal";
import { appointments, locations, salonSettings } from "../../../../../db/schema";
import { dateKeyInZone, isValidDateKey } from "../../../../../lib/time-zone";
import { portalTokenFromRequest } from "../../../../../lib/portal-request";

function addDays(day: string, amount: number) { const [year, month, date] = day.split("-").map(Number); return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10); }

export async function GET(request: Request) {
  try {
    const token = portalTokenFromRequest(request); const url = new URL(request.url); const appointmentId = url.searchParams.get("appointmentId") || ""; const access = await resolvePortalSession(token);
    if (!access.client) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 });
    const [appointment] = await access.db.select({ id: appointments.id, serviceId: appointments.serviceId, locationId: appointments.locationId, timezone: locations.timezone, bookingWindowDays: salonSettings.bookingWindowDays }).from(appointments).innerJoin(locations, eq(appointments.locationId, locations.id)).innerJoin(salonSettings, eq(appointments.locationId, salonSettings.locationId)).where(and(eq(appointments.id, appointmentId), eq(appointments.clientId, access.client.id), eq(appointments.organizationId, access.client.organizationId), eq(salonSettings.organizationId, access.client.organizationId))).limit(1);
    if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 });
    const today = dateKeyInZone(new Date(), appointment.timezone);
    const bookingWindowEnd = addDays(today, appointment.bookingWindowDays);
    const from = url.searchParams.get("from") || today;
    const requestedDays = Number(url.searchParams.get("days") || 14);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 21) return Response.json({ error: "Choose a whole number of days from 1 to 21." }, { status: 400 });
    if (!isValidDateKey(from) || from < today || from > bookingWindowEnd) return Response.json({ error: "Choose a valid date in the salon’s booking window." }, { status: 400 });
    const dates = Array.from({ length: requestedDays }, (_, index) => addDays(from, index)).filter((date) => date <= bookingWindowEnd);
    const availability = await loadAvailability(appointment.serviceId, dates, { organizationId: access.client.organizationId, locationId: appointment.locationId, excludeAppointmentId: appointment.id });
    const through = dates.at(-1) || from;
    const nextCandidate = addDays(through, 1);
    return Response.json({
      range: { from, through, bookingWindowEnd, nextFrom: nextCandidate <= bookingWindowEnd ? nextCandidate : null },
      dates: dates.map((date) => ({ date, slots: availability.slots.filter((slot) => slot.date === date) })),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: "Live openings could not be loaded." }, { status: 500 }); }
}
