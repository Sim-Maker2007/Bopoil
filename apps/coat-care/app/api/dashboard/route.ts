import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { requireSalonAccess, salonApiError } from "../../salon-access";
import { appointments, clients, locations, messages, organizations, pets, services, staff } from "../../../db/schema";
import { squareManagedAppointmentIds } from "../../../lib/square-sync";

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

    const squareManaged = await squareManagedAppointmentIds(db, membership.organizationId, rows.map((row) => row.id));
    const dashboardRows = rows.map((row) => ({ ...row, managedBySquare: squareManaged.has(row.id) }));
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
      },
      appointments: dashboardRows,
    });
  } catch (error) {
    return salonApiError(error, "Dashboard unavailable");
  }
}
