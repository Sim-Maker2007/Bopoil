import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { appointments, locations, pets, services } from "../../../db/schema";
import { hasVerifiedPhoneIdentity } from "../../../db/client-phone-auth";
import { resolvePortalSession } from "../../../db/client-portal";
import { resolveStorefront } from "../../../db/public-storefront";
import { portalTokenFromRequest } from "../../../lib/portal-request";

const visibleStatuses = ["requested", "confirmed", "arrived", "bathing", "drying", "grooming", "quality_check", "ready", "completed"] as const;
const privateHeaders = { "cache-control": "private, no-store", vary: "cookie" };

function noContext() {
  return new Response(null, { status: 204, headers: privateHeaders });
}

export async function GET(request: Request) {
  try {
    const access = await resolvePortalSession(portalTokenFromRequest(request));
    if (!access.client || !access.session) return noContext();

    const url = new URL(request.url);
    const storefront = await resolveStorefront({
      organizationSlug: url.searchParams.get("salon"),
      locationSlug: url.searchParams.get("location"),
    });
    if (storefront.organization.id !== access.client.organizationId) return noContext();

    const { client, db } = access;
    const [fastPhoneSignInEnabled, petRows, appointmentRows] = await Promise.all([
      hasVerifiedPhoneIdentity(db, client.organizationId, client.id),
      db.select({
        id: pets.id,
        name: pets.name,
        breed: pets.breed,
      }).from(pets).where(and(
        eq(pets.organizationId, client.organizationId),
        eq(pets.clientId, client.id),
      )).orderBy(asc(pets.name)),
      db.select({
        petId: appointments.petId,
        status: appointments.status,
        startsAt: appointments.startsAt,
        serviceId: services.id,
        serviceName: services.name,
        locationId: locations.id,
        locationSlug: locations.slug,
        locationName: locations.name,
      }).from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .innerJoin(locations, eq(appointments.locationId, locations.id))
        .where(and(
          eq(appointments.organizationId, client.organizationId),
          eq(appointments.clientId, client.id),
          eq(services.organizationId, client.organizationId),
          eq(services.active, true),
          eq(locations.organizationId, client.organizationId),
          eq(locations.active, true),
          inArray(appointments.status, visibleStatuses),
        ))
        .orderBy(desc(appointments.startsAt), desc(appointments.createdAt)),
    ]);

    const latestRelevant = new Map<string, typeof appointmentRows[number]>();
    const latestCompleted = new Map<string, typeof appointmentRows[number]>();
    for (const appointment of appointmentRows) {
      if (!latestRelevant.has(appointment.petId)) latestRelevant.set(appointment.petId, appointment);
      if (appointment.status === "completed" && !latestCompleted.has(appointment.petId)) latestCompleted.set(appointment.petId, appointment);
    }
    const lastAppointment = appointmentRows.find((appointment) => appointment.status === "completed") || appointmentRows[0];
    const firstName = client.fullName.trim().split(/\s+/)[0]?.slice(0, 60) || "there";

    return Response.json({
      firstName,
      fastPhoneSignInEnabled,
      organization: {
        slug: storefront.organization.slug,
      },
      lastLocation: lastAppointment ? {
        id: lastAppointment.locationId,
        slug: lastAppointment.locationSlug,
        name: lastAppointment.locationName,
      } : {
        id: storefront.location.id,
        slug: storefront.location.slug,
        name: storefront.location.name,
      },
      pets: petRows.map((pet) => {
        const recommendation = latestCompleted.get(pet.id) || latestRelevant.get(pet.id);
        return {
          ...pet,
          recommendation: recommendation ? {
            serviceId: recommendation.serviceId,
            serviceName: recommendation.serviceName,
            locationId: recommendation.locationId,
            locationSlug: recommendation.locationSlug,
            locationName: recommendation.locationName,
          } : null,
        };
      }),
    }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: "Booking preferences are temporarily unavailable." }, { status: 503, headers: privateHeaders });
  }
}
