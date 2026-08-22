import { and, asc, eq } from "drizzle-orm";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";
import { services } from "../../../db/schema";
import { publicDeliveryConfig } from "../../../lib/message-delivery";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storefront = await resolveStorefront({ organizationSlug: url.searchParams.get("salon"), locationSlug: url.searchParams.get("location") });
    const rows = await storefront.db.select().from(services).where(and(
      eq(services.organizationId, storefront.organization.id), eq(services.locationId, storefront.location.id), eq(services.active, true),
    )).orderBy(asc(services.priceFromCents));
    return Response.json({
      organization: {
        name: storefront.organization.name, slug: storefront.organization.slug,
        contactPhone: storefront.organization.contactPhone, contactEmail: storefront.organization.contactEmail,
      },
      location: {
        id: storefront.location.id, name: storefront.location.name, slug: storefront.location.slug,
        city: storefront.location.city, region: storefront.location.region,
        currency: storefront.location.currency, timezone: storefront.location.timezone,
      },
      locations: storefront.locations.map((location) => ({ slug: location.slug, name: location.name, city: location.city, region: location.region })),
      booking: {
        allowOnlineBooking: storefront.settings.allowOnlineBooking, bookingMode: storefront.settings.bookingMode,
        minimumLeadMinutes: storefront.settings.minimumLeadMinutes, bookingWindowDays: storefront.settings.bookingWindowDays,
        requireOnlineDeposit: storefront.settings.requireOnlineDeposit, depositHoldMinutes: storefront.settings.depositHoldMinutes,
      },
      delivery: publicDeliveryConfig(),
      services: rows.map((service) => ({
        id: service.id, name: service.name, description: service.description,
        durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes,
        priceFromCents: service.priceFromCents, depositCents: service.depositCents,
      })),
    }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (error) { return storefrontError(error, "Catalog unavailable"); }
}
