import { and, asc, eq, gte, lt } from "drizzle-orm";
import { appointments, clients, locations, pets, services, squareBookings, squareCustomers, squareTeamMembers, staff } from "../../../../../db/schema";
import { dateKeyInZone, zonedDayBounds } from "../../../../../lib/time-zone";
import { squareCustomerName } from "../../../../../lib/square-data-sync";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../../salon-access";

// Square's own view of each reservation: its status there, where it was made
// (the salon, the booking site, a third party), who created it, the seller and
// customer notes, and the Coat & Care appointment it became.

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: string) { return dayPattern.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)); }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "calendar");
    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const params = new URL(request.url).searchParams;
    const today = dateKeyInZone(new Date(), location.timezone);
    const from = params.get("from") || new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const to = params.get("to") || new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    if (!validDay(from) || !validDay(to) || from > to) throw new SalonAccessError("Choose a valid date range.", 400);
    const start = zonedDayBounds(from, location.timezone).start.toISOString();
    const end = zonedDayBounds(to, location.timezone).end.toISOString();
    const rows = await db.select({
      id: squareBookings.id, status: squareBookings.status, source: squareBookings.source, startAt: squareBookings.startAt, durationMinutes: squareBookings.durationMinutes, sellerNote: squareBookings.sellerNote, customerNote: squareBookings.customerNote,
      creatorType: squareBookings.creatorType, creatorTeamMemberId: squareBookings.creatorTeamMemberId, locationType: squareBookings.locationType, squareCreatedAt: squareBookings.squareCreatedAt, squareUpdatedAt: squareBookings.squareUpdatedAt, customerId: squareBookings.customerId, appointmentId: squareBookings.appointmentId,
      appointmentStatus: appointments.status, petName: pets.name, clientId: appointments.clientId, clientName: clients.fullName, serviceName: services.name, staffName: staff.displayName,
      customerGivenName: squareCustomers.givenName, customerFamilyName: squareCustomers.familyName, customerCompanyName: squareCustomers.companyName, customerNickname: squareCustomers.nickname, customerEmail: squareCustomers.emailAddress, customerPhone: squareCustomers.phoneNumber,
      creatorGivenName: squareTeamMembers.givenName, creatorFamilyName: squareTeamMembers.familyName,
    }).from(squareBookings)
      .leftJoin(appointments, eq(squareBookings.appointmentId, appointments.id))
      .leftJoin(pets, eq(appointments.petId, pets.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(staff, eq(appointments.staffId, staff.id))
      .leftJoin(squareCustomers, eq(squareBookings.customerId, squareCustomers.id))
      .leftJoin(squareTeamMembers, eq(squareBookings.creatorTeamMemberId, squareTeamMembers.id))
      .where(and(eq(squareBookings.organizationId, membership.organizationId), eq(squareBookings.locationId, membership.locationId), gte(squareBookings.startAt, start), lt(squareBookings.startAt, end)))
      .orderBy(asc(squareBookings.startAt)).limit(600);
    const bookings = rows.map((row) => ({
      ...row,
      customerName: row.clientName || squareCustomerName({ givenName: row.customerGivenName || "", familyName: row.customerFamilyName || "", companyName: row.customerCompanyName || "", nickname: row.customerNickname || "", emailAddress: row.customerEmail || "", phoneNumber: row.customerPhone || "" }),
      creatorName: [row.creatorGivenName, row.creatorFamilyName].filter(Boolean).join(" "),
    }));
    return Response.json({ range: { from, to }, bookings }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square reservations unavailable.");
  }
}
