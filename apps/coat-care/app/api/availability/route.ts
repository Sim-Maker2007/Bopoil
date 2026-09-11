import { and, eq } from "drizzle-orm";
import { loadAvailability } from "../../../db/availability";
import { services } from "../../../db/schema";
import { dateKeyInZone, isValidDateKey } from "../../../lib/time-zone";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";
import { loadSquareAvailability, squarePublicBookingEnabled } from "../../../lib/square-public-booking";

function addDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const serviceId = String(url.searchParams.get("serviceId") || "").slice(0, 80);
    if (!serviceId) return Response.json({ error: "Choose a service first." }, { status: 400 });
    const storefront = await resolveStorefront({ organizationSlug: url.searchParams.get("salon"), locationSlug: url.searchParams.get("location") });
    if (squarePublicBookingEnabled()) {
      const [service] = await storefront.db.select().from(services).where(and(
        eq(services.id, serviceId),
        eq(services.organizationId, storefront.organization.id),
        eq(services.locationId, storefront.location.id),
        eq(services.active, true),
      )).limit(1);
      if (!service) return Response.json({ error: "That service is not available." }, { status: 404 });
      const today = dateKeyInZone(new Date(), storefront.location.timezone);
      const from = url.searchParams.get("from") || today;
      const requestedDays = Number(url.searchParams.get("days") || 14);
      if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 21) return Response.json({ error: "Choose a whole number of days from 1 to 21." }, { status: 400 });
      const bookingWindowEnd = addDays(today, storefront.settings.bookingWindowDays);
      if (!isValidDateKey(from) || from < today || from > bookingWindowEnd) return Response.json({ error: "Choose a valid date in the salon’s booking window." }, { status: 400 });
      const dates = Array.from({ length: requestedDays }, (_, index) => addDays(from, index)).filter((date) => date <= bookingWindowEnd);
      const through = dates.at(-1) || from;
      const slots = await loadSquareAvailability({
        db: storefront.db,
        organizationId: storefront.organization.id,
        locationId: storefront.location.id,
        timezone: storefront.location.timezone,
        serviceId,
        from,
        through,
      });
      const previousCandidate = addDays(from, -requestedDays);
      const nextCandidate = addDays(through, 1);
      return Response.json({
        location: { id: storefront.location.id, name: storefront.location.name, city: storefront.location.city, region: storefront.location.region, timezone: storefront.location.timezone, currency: storefront.location.currency },
        service: { id: service.id, name: service.name, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, priceFromCents: service.priceFromCents, depositCents: 0 },
        bookingMode: "automatic",
        managedBySquare: true,
        range: {
          from,
          through,
          bookingWindowEnd,
          previousFrom: from > today ? (previousCandidate < today ? today : previousCandidate) : null,
          nextFrom: nextCandidate <= bookingWindowEnd ? nextCandidate : null,
        },
        dates: dates.map((date) => ({ date, slots: slots.filter((slot) => slot.date === date) })),
      });
    }
    const options = { organizationId: storefront.organization.id, locationId: storefront.location.id };
    const provisional = await loadAvailability(serviceId, [new Date().toISOString().slice(0, 10)], options);
    if (!provisional.service) return Response.json({ error: "That service is not available." }, { status: 404 });
    const today = dateKeyInZone(new Date(), provisional.location.timezone);
    const from = url.searchParams.get("from") || today; const requestedDays = Number(url.searchParams.get("days") || 14);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 21) return Response.json({ error: "Choose a whole number of days from 1 to 21." }, { status: 400 });
    const days = requestedDays;
    const bookingWindowEnd = addDays(today, provisional.settings.bookingWindowDays);
    if (!isValidDateKey(from) || from < today || from > bookingWindowEnd) return Response.json({ error: "Choose a valid date in the salon’s booking window." }, { status: 400 });
    const dates = Array.from({ length: days }, (_, index) => addDays(from, index)).filter((date) => date <= bookingWindowEnd);
    const result = await loadAvailability(serviceId, dates, options);
    const through = dates.at(-1) || from;
    const previousCandidate = addDays(from, -days);
    const nextCandidate = addDays(through, 1);
    return Response.json({
      location: { id: result.location.id, name: result.location.name, city: result.location.city, region: result.location.region, timezone: result.location.timezone, currency: result.location.currency },
      service: { id: result.service!.id, name: result.service!.name, durationMinutes: result.service!.durationMinutes, bufferMinutes: result.service!.bufferMinutes, priceFromCents: result.service!.priceFromCents, depositCents: result.service!.depositCents },
      bookingMode: result.settings.bookingMode,
      range: {
        from,
        through,
        bookingWindowEnd,
        previousFrom: from > today ? (previousCandidate < today ? today : previousCandidate) : null,
        nextFrom: nextCandidate <= bookingWindowEnd ? nextCandidate : null,
      },
      dates: dates.map((date) => ({ date, slots: result.slots.filter((slot) => slot.date === date) })),
    });
  } catch (error) {
    return storefrontError(error, "Availability could not be loaded.");
  }
}
