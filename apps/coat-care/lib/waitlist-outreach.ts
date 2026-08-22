import { and, asc, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { loadAvailability } from "../db/availability";
import { issuePortalEmailSession } from "../db/client-portal";
import { queueClientTemplateMessage } from "../db/communications";
import { auditEvents, clients, locations, messages, organizations, pets, services, waitlistEntries } from "../db/schema";
import { dateKeyInZone } from "./time-zone";
import { matchesWaitlistTime, waitlistDates } from "./waitlist";
import { portalAccessUrl, safePublicOrigin } from "./portal-links";

type Db = ReturnType<typeof getDb>;

type WaitingEntry = {
  id: string;
  organizationId: string;
  locationId: string;
  clientId: string;
  petId: string;
  serviceId: string;
  preferredFrom: string;
  preferredTo: string;
  timePreference: string;
  contactedAt: string | null;
  updatedAt: string;
  organizationSlug: string;
  locationSlug: string;
  timezone: string;
  clientName: string;
  petName: string;
  serviceName: string;
};

function displayDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date(value));
}

function displayTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

async function notifyEntry(db: Db, entry: WaitingEntry, publicOrigin: string) {
  const today = dateKeyInZone(new Date(), entry.timezone);
  const from = entry.preferredFrom < today ? today : entry.preferredFrom;
  if (from > entry.preferredTo) return false;
  const availability = await loadAvailability(entry.serviceId, waitlistDates(from, entry.preferredTo), {
    organizationId: entry.organizationId,
    locationId: entry.locationId,
  });
  const opening = availability.slots.find((slot) => matchesWaitlistTime(slot.startsAt, entry.timePreference, entry.timezone));
  if (!opening) {
    await db.update(waitlistEntries).set({ updatedAt: new Date().toISOString() }).where(and(
      eq(waitlistEntries.id, entry.id),
      eq(waitlistEntries.status, "waiting"),
      eq(waitlistEntries.updatedAt, entry.updatedAt),
    ));
    return false;
  }

  const changedAt = new Date().toISOString();
  const dedupeKey = `waitlist_opening_available:${entry.id}:${opening.startsAt}`;
  const [claimed] = await db.update(waitlistEntries).set({
    status: "contacted",
    contactedAt: changedAt,
    updatedAt: changedAt,
  }).where(and(
    eq(waitlistEntries.id, entry.id),
    eq(waitlistEntries.organizationId, entry.organizationId),
    eq(waitlistEntries.locationId, entry.locationId),
    eq(waitlistEntries.status, "waiting"),
    eq(waitlistEntries.updatedAt, entry.updatedAt),
  )).returning({ id: waitlistEntries.id });
  if (!claimed) return false;

  let message: Awaited<ReturnType<typeof queueClientTemplateMessage>>;
  try {
    [message] = await db.select().from(messages).where(and(
      eq(messages.organizationId, entry.organizationId),
      eq(messages.dedupeKey, dedupeKey),
    )).limit(1);
    if (!message) {
      const query = new URLSearchParams({
        pet: entry.petId,
        service: entry.serviceId,
        date: opening.date,
        startsAt: opening.startsAt,
      });
      const returnTo = `/book/${encodeURIComponent(entry.organizationSlug)}/${encodeURIComponent(entry.locationSlug)}?${query.toString()}`;
      const session = await issuePortalEmailSession(db, entry.clientId);
      const portalUrl = portalAccessUrl(publicOrigin, session.token, returnTo);
      message = await queueClientTemplateMessage(db, {
        clientId: entry.clientId,
        locationId: entry.locationId,
        templateKey: "waitlist_opening_available",
        dedupeKey,
        variables: {
          pet_name: entry.petName,
          service_name: entry.serviceName,
          opening_date: displayDate(opening.startsAt, entry.timezone),
          opening_time: displayTime(opening.startsAt, entry.timezone),
          portal_url: portalUrl,
        },
      });
    }
    if (!message) throw new Error("Waitlist opening template is unavailable.");
  } catch (error) {
    await db.update(waitlistEntries).set({
      status: "waiting",
      contactedAt: entry.contactedAt,
      updatedAt: changedAt,
    }).where(and(
      eq(waitlistEntries.id, entry.id),
      eq(waitlistEntries.status, "contacted"),
      eq(waitlistEntries.updatedAt, changedAt),
    ));
    throw error;
  }
  if (!["sent", "scheduled", "delivered"].includes(message.status)) {
    await db.update(waitlistEntries).set({
      status: "waiting",
      contactedAt: entry.contactedAt,
      updatedAt: changedAt,
    }).where(and(
      eq(waitlistEntries.id, entry.id),
      eq(waitlistEntries.status, "contacted"),
      eq(waitlistEntries.updatedAt, changedAt),
    ));
    return false;
  }
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    organizationId: entry.organizationId,
    actorType: "system",
    action: "waitlist.opening_notified",
    entityType: "waitlist_entry",
    entityId: entry.id,
    detailsJson: JSON.stringify({ startsAt: opening.startsAt, messageId: message.id }),
  }).catch((error) => console.error("Waitlist outreach was queued, but its audit event could not be saved", { waitlistId: entry.id, error }));
  return true;
}

export async function sweepWaitlistOpenings(db: Db, origin: string, limit = 5) {
  const publicOrigin = safePublicOrigin(origin);
  if (!publicOrigin) return { scanned: 0, notified: 0, skipped: "public_origin_unavailable" as const };
  const entries = await db.select({
    id: waitlistEntries.id,
    organizationId: waitlistEntries.organizationId,
    locationId: waitlistEntries.locationId,
    clientId: waitlistEntries.clientId,
    petId: waitlistEntries.petId,
    serviceId: waitlistEntries.serviceId,
    preferredFrom: waitlistEntries.preferredFrom,
    preferredTo: waitlistEntries.preferredTo,
    timePreference: waitlistEntries.timePreference,
    contactedAt: waitlistEntries.contactedAt,
    updatedAt: waitlistEntries.updatedAt,
    organizationSlug: organizations.slug,
    locationSlug: locations.slug,
    timezone: locations.timezone,
    clientName: clients.fullName,
    petName: pets.name,
    serviceName: services.name,
  }).from(waitlistEntries)
    .innerJoin(organizations, eq(waitlistEntries.organizationId, organizations.id))
    .innerJoin(locations, eq(waitlistEntries.locationId, locations.id))
    .innerJoin(clients, eq(waitlistEntries.clientId, clients.id))
    .innerJoin(pets, eq(waitlistEntries.petId, pets.id))
    .innerJoin(services, eq(waitlistEntries.serviceId, services.id))
    .where(eq(waitlistEntries.status, "waiting"))
    .orderBy(asc(waitlistEntries.updatedAt), asc(waitlistEntries.createdAt))
    .limit(Math.max(10, Math.min(100, limit * 10)));

  let notified = 0;
  for (const entry of entries) {
    if (notified >= limit) break;
    try {
      if (await notifyEntry(db, entry, publicOrigin)) notified += 1;
    } catch (error) {
      console.error("Automatic waitlist outreach could not be prepared", { waitlistId: entry.id, error });
    }
  }
  return { scanned: entries.length, notified };
}
