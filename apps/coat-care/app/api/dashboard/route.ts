import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { requireSalonAccess, salonApiError } from "../../salon-access";
import { appointments, clients, locations, messages, organizations, paymentEvents, pets, services, squareBookings, staff } from "../../../db/schema";
import { squareManagedAppointmentIds } from "../../../lib/square-sync";
import { squareSalesBetween } from "../../../lib/square-ledger";
import { dateKeyInZone, zonedDayBounds } from "../../../lib/time-zone";

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();

    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30).toISOString();
    const rows = membership.permissions.includes("calendar") ? await db.select({
      id: appointments.id,
      clientId: clients.id,
      petId: pets.id,
      serviceId: services.id,
      staffId: staff.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      depositStatus: appointments.depositStatus,
      depositDueAt: appointments.depositDueAt,
      priceEstimateCents: appointments.priceEstimateCents,
      petName: pets.name,
      breed: pets.breed,
      safetyLevel: pets.safetyLevel,
      handlingNotes: pets.handlingNotes,
      clientName: clients.fullName,
      clientEmail: clients.email,
      clientPhone: clients.phone,
      serviceName: services.name,
      staffName: staff.displayName,
    }).from(appointments)
      .innerJoin(pets, eq(appointments.petId, pets.id))
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(staff, eq(appointments.staffId, staff.id))
      .where(and(
        eq(appointments.organizationId, membership.organizationId),
        eq(appointments.locationId, membership.locationId),
        gte(appointments.startsAt, dayStart),
        lt(appointments.startsAt, dayEnd),
      )).orderBy(asc(appointments.startsAt)) : [];

    const [squareManaged, squareDetails] = await Promise.all([
      squareManagedAppointmentIds(db, membership.organizationId, rows.map((row) => row.id)),
      rows.length ? db.select({ appointmentId: squareBookings.appointmentId, status: squareBookings.status, source: squareBookings.source, sellerNote: squareBookings.sellerNote, customerNote: squareBookings.customerNote, creatorType: squareBookings.creatorType, squareCreatedAt: squareBookings.squareCreatedAt })
        .from(squareBookings).where(and(eq(squareBookings.organizationId, membership.organizationId), inArray(squareBookings.appointmentId, rows.map((row) => row.id)))) : Promise.resolve([]),
    ]);
    const squareByAppointment = new Map(squareDetails.map((detail) => [detail.appointmentId, detail]));
    const dashboardRows = rows.map((row) => {
      const square = squareByAppointment.get(row.id);
      return { ...row, managedBySquare: squareManaged.has(row.id), square: square ? { status: square.status, source: square.source, sellerNote: square.sellerNote, customerNote: square.customerNote, creatorType: square.creatorType, createdAt: square.squareCreatedAt } : null };
    });
    const [actionableMessages] = membership.permissions.includes("messages") ? await db.select({
      count: sql<number>`count(*)`.mapWith(Number),
    }).from(messages).where(and(
      eq(messages.organizationId, membership.organizationId),
      eq(messages.locationId, membership.locationId),
      or(
        inArray(messages.status, ["action_required", "failed"]),
        and(
          eq(messages.status, "scheduled"),
          lte(messages.scheduledFor, new Date().toISOString()),
          eq(messages.providerMessageId, ""),
        ),
      ),
    )) : [{ count: 0 }];
    const [salon] = await db.select({ name: organizations.name, slug: organizations.slug, location: locations.name, locationSlug: locations.slug, city: locations.city, region: locations.region, currency: locations.currency, timezone: locations.timezone }).from(locations).innerJoin(organizations, eq(locations.organizationId, organizations.id)).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    const revenueCents = dashboardRows.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.priceEstimateCents, 0);
    // Money actually taken today: Square's terminal, point of sale and online
    // store, plus payments recorded in this workspace's checkout.
    const timezone = salon?.timezone || "America/Toronto";
    const todayBounds = zonedDayBounds(dateKeyInZone(new Date(), timezone), timezone);
    const canSeeMoney = membership.permissions.includes("finance") || membership.permissions.includes("checkout");
    const [square, [ledger]] = canSeeMoney ? await Promise.all([
      squareSalesBetween(db, membership, todayBounds.start.toISOString(), todayBounds.end.toISOString()),
      db.select({ paymentsCents: sql<number>`coalesce(sum(case when ${paymentEvents.kind} = 'payment' then ${paymentEvents.amountCents} else -${paymentEvents.amountCents} end), 0)`.mapWith(Number), count: sql<number>`count(*)`.mapWith(Number) })
        .from(paymentEvents).where(and(eq(paymentEvents.organizationId, membership.organizationId), eq(paymentEvents.locationId, membership.locationId), eq(paymentEvents.status, "succeeded"), gte(paymentEvents.occurredAt, todayBounds.start.toISOString()), lt(paymentEvents.occurredAt, todayBounds.end.toISOString()))),
    ]) : [null, [{ paymentsCents: 0, count: 0 }]];
    return Response.json({
      user: { id: membership.id, displayName: membership.displayName, role: membership.role, permissions: membership.permissions },
      salon,
      locations: membership.locations,
      organizations: membership.organizations,
      metrics: {
        revenueCents,
        appointments: dashboardRows.length,
        activePets: dashboardRows.filter((row) => ["arrived", "bathing", "drying", "grooming", "quality_check", "ready"].includes(row.status)).length,
        actionableMessages: actionableMessages?.count || 0,
        collectedToday: canSeeMoney ? { totalCents: (square?.totals.netCents || 0) + (ledger?.paymentsCents || 0), squareCents: square?.totals.netCents || 0, squareCount: square?.totals.count || 0, ledgerCents: ledger?.paymentsCents || 0, ledgerCount: ledger?.count || 0 } : null,
      },
      appointments: dashboardRows,
    });
  } catch (error) {
    return salonApiError(error, "Dashboard unavailable");
  }
}
