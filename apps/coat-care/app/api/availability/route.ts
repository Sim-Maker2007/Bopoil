import { loadAvailability } from "../../../db/availability";
import { dateKeyInZone, isValidDateKey } from "../../../lib/time-zone";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";

function addDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const serviceId = String(url.searchParams.get("serviceId") || "").slice(0, 80);
    if (!serviceId) return Response.json({ error: "Choose a service first." }, { status: 400 });
    const storefront = await resolveStorefront({ organizationSlug: url.searchParams.get("salon"), locationSlug: url.searchParams.get("location") });
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
