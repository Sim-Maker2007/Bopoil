import { isPublicCareService } from "../../../lib/care-options";
import { and, eq } from "drizzle-orm";
import { consentRecords, pets, services } from "../../../db/schema";
import { issuePortalEmailSession, resolvePortalSession } from "../../../db/client-portal";
import { queuePortalAccessMessage } from "../../../db/communications";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";
import { portalCookieRequestIsSameOrigin, portalCookieTokenFromRequest } from "../../../lib/portal-request";
import { portalAccessUrl } from "../../../lib/portal-links";
import { createSquareAppointment, squarePublicBookingEnabled } from "../../../lib/square-public-booking";

type Payload = {
  salonSlug?: string;
  locationSlug?: string;
  petId?: string;
  serviceId?: string;
  startsAt?: string;
  clientNotes?: string;
  policyAccepted?: boolean;
  informationCurrent?: boolean;
};

function bookingError(error: unknown) {
  const message = error instanceof Error ? error.message : "The Square appointment could not be created.";
  const status = /no longer available|ambiguous|multiple|staff review|merge or select/i.test(message) ? 409
    : /choose|add a valid|not connected|not configured/i.test(message) ? 400
      : 503;
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (!squarePublicBookingEnabled()) return Response.json({ error: "Square online booking is not configured." }, { status: 503 });
    if (!portalCookieRequestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
    const payload = await request.json() as Payload;
    if (!payload.policyAccepted) return Response.json({ error: "The booking and cancellation policy must be accepted." }, { status: 400 });
    if (!payload.informationCurrent) return Response.json({ error: "Confirm that your contact and pet information is current for this appointment." }, { status: 400 });
    const petId = String(payload.petId || "").slice(0, 80);
    const serviceId = String(payload.serviceId || "").slice(0, 80);
    const startsAt = String(payload.startsAt || "").slice(0, 50);
    if (!petId || !serviceId || !startsAt) return Response.json({ error: "Choose a saved pet, service, and appointment time." }, { status: 400 });
    const access = await resolvePortalSession(portalCookieTokenFromRequest(request));
    if (!access.client || !access.session) return Response.json({
      intent: "secure_access_required",
      error: "Open your secure BOPOIL profile before booking so Square uses the correct customer record.",
    }, { status: 401, headers: { "cache-control": "no-store" } });
    const storefront = await resolveStorefront({ organizationSlug: payload.salonSlug, locationSlug: payload.locationSlug });
    if (access.client.organizationId !== storefront.organization.id) return Response.json({ error: "This client profile is not available for this salon." }, { status: 404 });
    const [[pet], [service]] = await Promise.all([
      storefront.db.select({ id: pets.id, name: pets.name }).from(pets).where(and(
        eq(pets.id, petId), eq(pets.clientId, access.client.id), eq(pets.organizationId, storefront.organization.id),
      )).limit(1),
      storefront.db.select({ id: services.id, name: services.name }).from(services).where(and(
        eq(services.id, serviceId), eq(services.organizationId, storefront.organization.id), eq(services.locationId, storefront.location.id), eq(services.active, true),
      )).limit(1),
    ]);
    if (!pet || !service) return Response.json({ error: "The selected pet or service is no longer available." }, { status: 404 });
    if (!isPublicCareService(service.name)) return Response.json({ error: "Ce soin se réserve par téléphone. Veuillez appeler le salon." }, { status: 400 });
    const appointment = await createSquareAppointment({
      db: storefront.db,
      organizationId: storefront.organization.id,
      locationId: storefront.location.id,
      timezone: storefront.location.timezone,
      clientId: access.client.id,
      petId: pet.id,
      serviceId: service.id,
      startsAt,
      clientNotes: payload.clientNotes,
    });
    await storefront.db.batch([
      storefront.db.insert(consentRecords).values({ id: `square-booking-policy:${appointment.id}`, organizationId: storefront.organization.id, clientId: access.client.id, appointmentId: appointment.id, type: "booking_and_cancellation_policy", policyVersion: "2026-08-square-v1", accepted: true, source: "square_api_booking" }).onConflictDoNothing(),
      storefront.db.insert(consentRecords).values({ id: `square-information-current:${appointment.id}`, organizationId: storefront.organization.id, clientId: access.client.id, appointmentId: appointment.id, type: "client_information_current", policyVersion: "2026-08-v1", accepted: true, source: "square_api_booking" }).onConflictDoNothing(),
    ]);
    try {
      const portalSession = await issuePortalEmailSession(storefront.db, access.client.id);
      await queuePortalAccessMessage(storefront.db, {
        clientId: access.client.id,
        locationId: storefront.location.id,
        portalUrl: portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portalSession.token),
        dedupeKey: `square_booking_portal:${appointment.id}`,
      });
    } catch (deliveryError) {
      console.error("Square appointment saved, but secure returning-client access could not be queued", deliveryError);
    }
    return Response.json({
      appointment: {
        id: appointment.id,
        status: appointment.status,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        serviceName: service.name,
        petName: pet.name,
        depositCents: 0,
        currency: appointment.currency,
        depositStatus: "not_required",
      },
      trustedSession: true,
      managedBySquare: true,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const handled = storefrontError(error, "The Square appointment could not be created.");
    if (handled.status < 500) return handled;
    return bookingError(error);
  }
}
