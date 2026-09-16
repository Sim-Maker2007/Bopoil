import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appointments, clients, externalEntityLinks, pets, services } from "../db/schema";
import { normalizeClientPhone } from "./client-phone-auth";
import { squareConfig, squareRequest } from "./square";
import { sameSquareInstant } from "./square-instant";
import { linkEntity, syncSquareBooking, type SquareBooking } from "./square-sync";
import { dateKeyInZone, zonedDayBounds } from "./time-zone";

type Db = ReturnType<typeof getDb>;

type SquareCustomer = {
  id?: string;
  version?: number;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
  reference_id?: string;
};

type SquareCatalogVariation = {
  id?: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_variation_data?: {
    name?: string;
    price_money?: { amount?: number | string; currency?: string };
    service_duration?: number;
    available_for_booking?: boolean;
  };
};

type SquareCatalogItem = {
  id?: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: {
    name?: string;
    description?: string;
    product_type?: string;
    variations?: SquareCatalogVariation[];
  };
};

export type SquareAvailability = {
  start_at?: string;
  location_id?: string;
  appointment_segments?: Array<{
    duration_minutes?: number;
    intermission_minutes?: number;
    service_variation_id?: string;
    service_variation_version?: number;
    team_member_id?: string;
  }>;
};

function clean(value: unknown, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function presentAtLocation(object: {
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
}, locationId: string) {
  if (object.absent_at_location_ids?.includes(locationId)) return false;
  if (object.present_at_all_locations === true) return true;
  if (object.present_at_location_ids?.includes(locationId)) return true;
  return object.present_at_all_locations !== false && !object.present_at_location_ids?.length;
}

function displayServiceName(itemName: string, variationName: string) {
  return [itemName, variationName && variationName.toLowerCase() !== "regular" ? variationName : ""].filter(Boolean).join(" · ");
}

export function squarePublicBookingEnabled() {
  return squareConfig().publicBookingConfigured;
}

export async function syncSquareBookableServices(db: Db, organizationId: string, locationId: string) {
  const config = squareConfig();
  if (!config.publicBookingConfigured) return [];
  const response = await squareRequest<{ items?: SquareCatalogItem[] }>("catalog/search-catalog-items", {
    body: {
      product_types: ["APPOINTMENTS_SERVICE"],
      archived_state: "ARCHIVED_STATE_NOT_ARCHIVED",
      enabled_location_ids: [config.externalLocationId],
      limit: 100,
    },
  });
  const currentLinks = await db.select({ localEntityId: externalEntityLinks.localEntityId, externalEntityId: externalEntityLinks.externalEntityId })
    .from(externalEntityLinks).where(and(
      eq(externalEntityLinks.organizationId, organizationId),
      eq(externalEntityLinks.provider, "square"),
      eq(externalEntityLinks.entityType, "service"),
    ));
  const localByExternal = new Map(currentLinks.map((link) => [link.externalEntityId, link.localEntityId]));
  const activeIds: string[] = [];
  for (const item of response.items || []) {
    if (item.is_deleted || item.item_data?.product_type !== "APPOINTMENTS_SERVICE" || !presentAtLocation(item, config.externalLocationId)) continue;
    const itemName = clean(item.item_data.name, 100) || "Square service";
    for (const variation of item.item_data.variations || []) {
      if (!variation.id || variation.is_deleted || variation.item_variation_data?.available_for_booking === false || !presentAtLocation(variation, config.externalLocationId)) continue;
      const variationName = clean(variation.item_variation_data?.name, 100);
      const name = displayServiceName(itemName, variationName) || itemName;
      const durationMinutes = Math.max(1, Math.round(Number(variation.item_variation_data?.service_duration || 3_600_000) / 60_000));
      const priceFromCents = Math.max(0, Number(variation.item_variation_data?.price_money?.amount || 0));
      let serviceId = localByExternal.get(variation.id) || "";
      if (!serviceId) {
        const [matched] = await db.select({ id: services.id }).from(services).where(and(
          eq(services.organizationId, organizationId),
          eq(services.locationId, locationId),
          eq(sql<string>`lower(${services.name})`, name.toLowerCase()),
        )).limit(1);
        serviceId = matched?.id || crypto.randomUUID();
        if (!matched) await db.insert(services).values({
          id: serviceId,
          organizationId,
          locationId,
          name,
          description: clean(item.item_data.description, 500) || "Réservation gérée dans Square Appointments",
          durationMinutes,
          bufferMinutes: 0,
          priceFromCents,
          depositCents: 0,
          bathMinutes: 0,
          dryerMinutes: 0,
          groomingTableMinutes: durationMinutes,
          kennelMinutes: 0,
        });
      }
      await db.update(services).set({
        name,
        description: clean(item.item_data.description, 500) || "Réservation gérée dans Square Appointments",
        durationMinutes,
        priceFromCents,
        depositCents: 0,
        active: true,
      }).where(and(eq(services.id, serviceId), eq(services.organizationId, organizationId), eq(services.locationId, locationId)));
      await linkEntity(db, {
        organizationId,
        locationId,
        entityType: "service",
        localEntityId: serviceId,
        externalEntityId: variation.id,
        externalVersion: String(variation.version || ""),
        metadata: { catalogItemId: item.id || "" },
      });
      activeIds.push(serviceId);
    }
  }
  const previouslyLinked = [...new Set(currentLinks.map((link) => link.localEntityId))];
  const inactiveIds = previouslyLinked.filter((id) => !activeIds.includes(id));
  if (inactiveIds.length) await db.update(services).set({ active: false }).where(and(
    eq(services.organizationId, organizationId),
    eq(services.locationId, locationId),
    inArray(services.id, inactiveIds),
  ));
  return [...new Set(activeIds)];
}

async function squareServiceId(db: Db, organizationId: string, localServiceId: string) {
  const [link] = await db.select({ externalEntityId: externalEntityLinks.externalEntityId }).from(externalEntityLinks).where(and(
    eq(externalEntityLinks.organizationId, organizationId),
    eq(externalEntityLinks.provider, "square"),
    eq(externalEntityLinks.entityType, "service"),
    eq(externalEntityLinks.localEntityId, localServiceId),
  )).orderBy(desc(externalEntityLinks.lastSyncedAt)).limit(1);
  return link?.externalEntityId || "";
}

async function searchSquareCustomers(field: "reference_id" | "email_address" | "phone_number", exact: string) {
  if (!exact) return [];
  const response = await squareRequest<{ customers?: SquareCustomer[] }>("customers/search", {
    body: { query: { filter: { [field]: { exact } } }, limit: 20 },
  });
  return response.customers || [];
}

function nameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { givenName: parts.shift() || "BOPOIL", familyName: parts.join(" ") };
}

export async function ensureSquareCustomer(db: Db, organizationId: string, locationId: string, clientId: string) {
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))).limit(1);
  if (!client) throw new Error("The Coat & Care client profile could not be found.");
  const phone = normalizeClientPhone(client.phone);
  if (!phone) throw new Error("Add a valid mobile number to the client profile before booking in Square.");
  const referenceId = `coat-care:${client.id}`;
  const [linked] = await db.select({ externalEntityId: externalEntityLinks.externalEntityId }).from(externalEntityLinks).where(and(
    eq(externalEntityLinks.organizationId, organizationId),
    eq(externalEntityLinks.provider, "square"),
    eq(externalEntityLinks.entityType, "client"),
    eq(externalEntityLinks.localEntityId, client.id),
  )).orderBy(desc(externalEntityLinks.lastSyncedAt)).limit(1);
  let customer: SquareCustomer | undefined;
  if (linked?.externalEntityId) {
    const retrieved: { customer?: SquareCustomer } = await squareRequest<{ customer?: SquareCustomer }>(`customers/${encodeURIComponent(linked.externalEntityId)}`).catch(() => ({}));
    customer = retrieved.customer;
  }
  if (!customer?.id) {
    const byReference = await searchSquareCustomers("reference_id", referenceId);
    if (byReference.length > 1) throw new Error("More than one Square profile is linked to this Coat & Care client. Staff review is required.");
    customer = byReference[0];
  }
  if (!customer?.id) {
    const [byEmail, byPhone] = await Promise.all([
      searchSquareCustomers("email_address", client.email.toLowerCase()),
      searchSquareCustomers("phone_number", phone),
    ]);
    const candidates = [...new Map([...byEmail, ...byPhone].filter((item) => item.id).map((item) => [item.id!, item])).values()];
    if (candidates.length > 1) throw new Error("Square contains multiple possible customer profiles. Merge or select the correct profile before booking.");
    customer = candidates[0];
  }
  const { givenName, familyName } = nameParts(client.fullName);
  if (!customer?.id) {
    const created = await squareRequest<{ customer?: SquareCustomer }>("customers", {
      body: {
        idempotency_key: `coat-care-customer:${client.id}`,
        given_name: givenName,
        family_name: familyName,
        email_address: client.email || undefined,
        phone_number: phone,
        reference_id: referenceId,
      },
    });
    customer = created.customer;
  } else {
    const currentCustomerId = customer.id;
    const current = await squareRequest<{ customer?: SquareCustomer }>(`customers/${encodeURIComponent(currentCustomerId)}`);
    customer = { ...customer, ...current.customer, id: current.customer?.id || currentCustomerId };
    if (typeof customer.version !== "number") throw new Error("Square did not return the customer version required for a safe update.");
    const updateCustomerId = customer.id || currentCustomerId;
    const updated = await squareRequest<{ customer?: SquareCustomer }>(`customers/${encodeURIComponent(updateCustomerId)}`, {
      method: "PUT",
      body: {
        version: customer.version,
        given_name: givenName,
        family_name: familyName,
        email_address: client.email || undefined,
        phone_number: phone,
        reference_id: referenceId,
      },
    });
    customer = { ...customer, ...updated.customer, id: updated.customer?.id || updateCustomerId };
  }
  if (!customer?.id) throw new Error("Square did not return a customer profile.");
  await linkEntity(db, { organizationId, locationId, entityType: "client", localEntityId: client.id, externalEntityId: customer.id });
  return customer.id;
}

async function searchAvailability(externalLocationId: string, externalServiceId: string, start: Date, end: Date) {
  const response = await squareRequest<{ availabilities?: SquareAvailability[] }>("bookings/availability/search", {
    body: {
      query: {
        filter: {
          start_at_range: { start_at: start.toISOString(), end_at: end.toISOString() },
          location_id: externalLocationId,
          segment_filters: [{ service_variation_id: externalServiceId }],
        },
      },
    },
  });
  return response.availabilities || [];
}

export async function loadSquareAvailability(input: {
  db: Db;
  organizationId: string;
  locationId: string;
  timezone: string;
  serviceId: string;
  from: string;
  through: string;
}) {
  const config = squareConfig();
  if (!config.publicBookingConfigured) throw new Error("Square online booking is not configured.");
  const externalServiceId = await squareServiceId(input.db, input.organizationId, input.serviceId);
  if (!externalServiceId) throw new Error("That service is not connected to Square Appointments.");
  const start = zonedDayBounds(input.from, input.timezone).start;
  const end = zonedDayBounds(input.through, input.timezone).end;
  const availabilities = await searchAvailability(config.externalLocationId, externalServiceId, start, end);
  const slots = new Map<string, {
    startsAt: string;
    endsAt: string;
    date: string;
    timeLabel: string;
    staff: Array<{ id: string; name: string }>;
    remainingCapacity: number;
  }>();
  for (const availability of availabilities) {
    const rawStartsAt = clean(availability.start_at, 50);
    if (!rawStartsAt || Number.isNaN(new Date(rawStartsAt).valueOf())) continue;
    const startsAt = new Date(rawStartsAt).toISOString();
    const durationMinutes = Math.max(1, (availability.appointment_segments || []).reduce((total, segment) => total + Number(segment.duration_minutes || 0) + Number(segment.intermission_minutes || 0), 0));
    const existing = slots.get(startsAt);
    const teamMemberId = clean(availability.appointment_segments?.[0]?.team_member_id, 100);
    if (existing) {
      if (teamMemberId && !existing.staff.some((person) => person.id === teamMemberId)) existing.staff.push({ id: teamMemberId, name: "the BOPOIL team" });
      existing.remainingCapacity = existing.staff.length;
      continue;
    }
    slots.set(startsAt, {
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
      date: dateKeyInZone(new Date(startsAt), input.timezone),
      timeLabel: new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(startsAt)),
      staff: teamMemberId ? [{ id: teamMemberId, name: "the BOPOIL team" }] : [],
      remainingCapacity: 1,
    });
  }
  return [...slots.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

export async function createSquareAppointment(input: {
  db: Db;
  organizationId: string;
  locationId: string;
  timezone: string;
  clientId: string;
  petId: string;
  serviceId: string;
  startsAt: string;
  clientNotes?: string;
}) {
  const config = squareConfig();
  if (!config.publicBookingConfigured) throw new Error("Square online booking is not configured.");
  const [[pet], externalServiceId] = await Promise.all([
    input.db.select({ id: pets.id, name: pets.name }).from(pets).where(and(
      eq(pets.id, input.petId), eq(pets.clientId, input.clientId), eq(pets.organizationId, input.organizationId),
    )).limit(1),
    squareServiceId(input.db, input.organizationId, input.serviceId),
  ]);
  if (!pet) throw new Error("Choose a pet from the secure client profile.");
  if (!externalServiceId) throw new Error("That service is not connected to Square Appointments.");
  const requestedStart = new Date(input.startsAt);
  if (Number.isNaN(requestedStart.valueOf())) throw new Error("Choose a valid appointment time.");
  const searchStart = new Date(requestedStart.getTime() - 60 * 60_000);
  const searchEnd = new Date(searchStart.getTime() + 25 * 60 * 60_000);
  const availabilities = await searchAvailability(config.externalLocationId, externalServiceId, searchStart, searchEnd);
  const availability = availabilities.find((slot) => sameSquareInstant(slot.start_at, input.startsAt));
  if (!availability?.appointment_segments?.length) throw new Error("That Square opening is no longer available. Choose another time.");
  const squareCustomerId = await ensureSquareCustomer(input.db, input.organizationId, input.locationId, input.clientId);
  const response = await squareRequest<{ booking?: SquareBooking }>("bookings", {
    body: {
      idempotency_key: `coat-care-booking:${input.clientId}:${input.petId}:${input.serviceId}:${requestedStart.toISOString()}`,
      booking: {
        location_id: config.externalLocationId,
        start_at: requestedStart.toISOString(),
        customer_id: squareCustomerId,
        customer_note: clean(input.clientNotes, 700),
        seller_note: `Pet: ${pet.name} · Care profile maintained in Coat & Care`,
        appointment_segments: availability.appointment_segments.map((segment) => ({
          duration_minutes: segment.duration_minutes,
          service_variation_id: segment.service_variation_id,
          service_variation_version: segment.service_variation_version,
          team_member_id: segment.team_member_id,
        })),
      },
    },
  });
  if (!response.booking?.id) throw new Error("Square did not return the new appointment.");
  const synced = await syncSquareBooking(input.db, response.booking, { clientId: input.clientId, petId: input.petId });
  if (!synced.handled || !synced.appointmentId) throw new Error("The Square appointment could not be connected to Coat & Care.");
  await input.db.update(appointments).set({
    clientId: input.clientId,
    petId: input.petId,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(appointments.id, synced.appointmentId), eq(appointments.organizationId, input.organizationId)));
  const [appointment] = await input.db.select().from(appointments).where(eq(appointments.id, synced.appointmentId)).limit(1);
  return appointment;
}
