import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { resolveStorefront } from "../db/public-storefront";
import {
  appointmentReservations,
  appointments,
  auditEvents,
  clients,
  externalEntityLinks,
  integrationSyncStates,
  pets,
  salonSettings,
  services,
  staff,
} from "../db/schema";
import { normalizeClientPhone } from "./client-phone-auth";
import { squareConfig, squareRequest } from "./square";

export type SquareBooking = {
  id?: string;
  version?: number;
  status?: string;
  start_at?: string;
  location_id?: string;
  customer_id?: string;
  customer_note?: string;
  appointment_segments?: Array<{
    duration_minutes?: number;
    intermission_minutes?: number;
    service_variation_id?: string;
    team_member_id?: string;
  }>;
};

type SquareCustomer = {
  id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
};

type SquareCatalogObject = {
  id?: string;
  type?: string;
  item_data?: { name?: string };
  item_variation_data?: { name?: string; item_id?: string; price_money?: { amount?: number; currency?: string } };
};

type Db = ReturnType<typeof getDb>;
type EntityType = "appointment" | "client" | "location" | "service" | "staff";

const operationalStatuses = new Set(["arrived", "bathing", "drying", "grooming", "quality_check", "ready", "completed"]);

function clean(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

function squareStatus(status: string) {
  if (status === "PENDING") return "requested" as const;
  if (status === "NO_SHOW") return "no_show" as const;
  if (["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED"].includes(status)) return "cancelled" as const;
  return "confirmed" as const;
}

async function linkedLocalId(db: Db, organizationId: string, entityType: EntityType, externalEntityId: string) {
  if (!externalEntityId) return "";
  const [link] = await db.select({ localEntityId: externalEntityLinks.localEntityId }).from(externalEntityLinks).where(and(
    eq(externalEntityLinks.organizationId, organizationId),
    eq(externalEntityLinks.provider, "square"),
    eq(externalEntityLinks.entityType, entityType),
    eq(externalEntityLinks.externalEntityId, externalEntityId),
  )).limit(1);
  return link?.localEntityId || "";
}

async function linkEntity(db: Db, input: {
  organizationId: string;
  locationId?: string | null;
  entityType: EntityType;
  localEntityId: string;
  externalEntityId: string;
  externalVersion?: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await db.insert(externalEntityLinks).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    locationId: input.locationId || null,
    provider: "square",
    entityType: input.entityType,
    localEntityId: input.localEntityId,
    externalEntityId: input.externalEntityId,
    externalVersion: input.externalVersion || "",
    metadataJson: JSON.stringify(input.metadata || {}),
    lastSyncedAt: now,
  }).onConflictDoUpdate({
    target: [externalEntityLinks.organizationId, externalEntityLinks.provider, externalEntityLinks.entityType, externalEntityLinks.externalEntityId],
    set: {
      localEntityId: input.localEntityId,
      locationId: input.locationId || null,
      externalVersion: input.externalVersion || "",
      metadataJson: JSON.stringify(input.metadata || {}),
      lastSyncedAt: now,
    },
  });
}

async function resolveClient(db: Db, organizationId: string, locationId: string, externalCustomerId: string) {
  const linkedId = await linkedLocalId(db, organizationId, "client", externalCustomerId);
  const response = await squareRequest<{ customer?: SquareCustomer }>(`customers/${encodeURIComponent(externalCustomerId)}`);
  const customer = response.customer || {};
  const email = clean(customer.email_address, 180).toLowerCase();
  const phone = normalizeClientPhone(clean(customer.phone_number, 40)) || clean(customer.phone_number, 40);
  const name = clean([customer.given_name, customer.family_name].filter(Boolean).join(" ") || customer.company_name, 100) || "Square customer";
  let clientId = linkedId;
  if (clientId) {
    const [linked] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))).limit(1);
    if (!linked) clientId = "";
  }
  if (!clientId) {
    const digits = phoneDigits(phone);
    let matched: { id: string } | undefined;
    if (email || digits) {
      [matched] = await db.select({ id: clients.id }).from(clients).where(and(
        eq(clients.organizationId, organizationId),
        or(
          email ? eq(sql<string>`lower(${clients.email})`, email) : undefined,
          digits ? eq(sql<string>`substr(replace(replace(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), -10)`, digits) : undefined,
        ),
      )).limit(1);
    }
    clientId = matched?.id || crypto.randomUUID();
    if (!matched) await db.insert(clients).values({ id: clientId, organizationId, fullName: name, email, phone });
  }
  await db.update(clients).set({
    fullName: name,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)));
  await linkEntity(db, { organizationId, locationId, entityType: "client", localEntityId: clientId, externalEntityId: externalCustomerId });
  return clientId;
}

async function resolvePet(db: Db, organizationId: string, clientId: string) {
  const rows = await db.select({ id: pets.id, name: pets.name }).from(pets).where(and(eq(pets.organizationId, organizationId), eq(pets.clientId, clientId)));
  const realPets = rows.filter((pet) => pet.name !== "Pet to assign");
  if (realPets.length === 1) return realPets[0].id;
  const placeholder = rows.find((pet) => pet.name === "Pet to assign");
  if (placeholder) return placeholder.id;
  const petId = crypto.randomUUID();
  await db.insert(pets).values({
    id: petId,
    organizationId,
    clientId,
    name: "Pet to assign",
    species: "unknown",
    breed: "Square booking — assign pet",
    safetyLevel: "attention",
    handlingNotes: "Choose the correct pet before beginning care.",
  });
  return petId;
}

async function catalogService(externalServiceId: string) {
  const query = new URLSearchParams({ include_related_objects: "true" });
  const response = await squareRequest<{ object?: SquareCatalogObject; related_objects?: SquareCatalogObject[] }>(`catalog/object/${encodeURIComponent(externalServiceId)}`, { query });
  const variation = response.object;
  const itemId = variation?.item_variation_data?.item_id;
  const item = response.related_objects?.find((entry) => entry.id === itemId && entry.type === "ITEM");
  const itemName = clean(item?.item_data?.name, 100);
  const variationName = clean(variation?.item_variation_data?.name, 100);
  return {
    name: [itemName, variationName && variationName !== "Regular" ? variationName : ""].filter(Boolean).join(" · ") || "Square service",
    priceCents: Number(variation?.item_variation_data?.price_money?.amount || 0),
  };
}

async function resolveService(db: Db, organizationId: string, locationId: string, externalServiceId: string, durationMinutes: number) {
  const linkedId = await linkedLocalId(db, organizationId, "service", externalServiceId);
  if (linkedId) {
    const [linked] = await db.select({ id: services.id }).from(services).where(and(eq(services.id, linkedId), eq(services.organizationId, organizationId), eq(services.locationId, locationId))).limit(1);
    if (linked) return linked.id;
  }
  const catalog = await catalogService(externalServiceId).catch(() => ({ name: `Square service ${externalServiceId.slice(-6)}`, priceCents: 0 }));
  const [matched] = await db.select({ id: services.id }).from(services).where(and(
    eq(services.organizationId, organizationId),
    eq(services.locationId, locationId),
    eq(sql<string>`lower(${services.name})`, catalog.name.toLowerCase()),
  )).limit(1);
  const serviceId = matched?.id || crypto.randomUUID();
  if (!matched) await db.insert(services).values({
    id: serviceId,
    organizationId,
    locationId,
    name: catalog.name,
    description: "Imported from Square Appointments",
    durationMinutes,
    bufferMinutes: 0,
    priceFromCents: Math.max(0, catalog.priceCents),
    depositCents: 0,
    bathMinutes: 0,
    dryerMinutes: 0,
    groomingTableMinutes: durationMinutes,
    kennelMinutes: 0,
  });
  await linkEntity(db, { organizationId, locationId, entityType: "service", localEntityId: serviceId, externalEntityId: externalServiceId });
  return serviceId;
}

async function resolveStaff(db: Db, organizationId: string, locationId: string, externalStaffId: string) {
  if (!externalStaffId) return null;
  const linkedId = await linkedLocalId(db, organizationId, "staff", externalStaffId);
  if (linkedId) return linkedId;
  const response: { team_member?: { given_name?: string; family_name?: string; email_address?: string } } = await squareRequest<{ team_member?: { given_name?: string; family_name?: string; email_address?: string } }>(`team-members/${encodeURIComponent(externalStaffId)}`).catch(() => ({}));
  const email = clean(response.team_member?.email_address, 180).toLowerCase();
  const displayName = clean([response.team_member?.given_name, response.team_member?.family_name].filter(Boolean).join(" "), 100);
  if (!email && !displayName) return null;
  const [matched] = await db.select({ id: staff.id }).from(staff).where(and(
    eq(staff.organizationId, organizationId),
    eq(staff.locationId, locationId),
    or(
      email ? eq(sql<string>`lower(${staff.email})`, email) : undefined,
      displayName ? eq(sql<string>`lower(${staff.displayName})`, displayName.toLowerCase()) : undefined,
    ),
  )).limit(1);
  if (!matched) return null;
  await linkEntity(db, { organizationId, locationId, entityType: "staff", localEntityId: matched.id, externalEntityId: externalStaffId });
  return matched.id;
}

export async function syncSquareBooking(db: Db, booking: SquareBooking) {
  const config = squareConfig();
  const externalBookingId = clean(booking.id, 100);
  const externalCustomerId = clean(booking.customer_id, 100);
  const externalLocationId = clean(booking.location_id, 100);
  const startsAt = new Date(clean(booking.start_at, 50));
  const segments = booking.appointment_segments || [];
  const firstSegment = segments[0];
  const externalServiceId = clean(firstSegment?.service_variation_id, 100);
  if (!externalBookingId || !externalCustomerId || !externalLocationId || !externalServiceId || Number.isNaN(startsAt.valueOf())) throw new Error("Square booking is missing required scheduling data.");
  if (config.externalLocationId && externalLocationId !== config.externalLocationId) return { handled: false, reason: "location" };
  const storefront = await resolveStorefront({ organizationSlug: config.organizationSlug || undefined, locationSlug: config.locationSlug || undefined });
  const { organization, location } = storefront;
  const durationMinutes = Math.max(1, segments.reduce((total, segment) => total + Number(segment.duration_minutes || 0) + Number(segment.intermission_minutes || 0), 0));
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const [clientId, serviceId, staffId] = await Promise.all([
    resolveClient(db, organization.id, location.id, externalCustomerId),
    resolveService(db, organization.id, location.id, externalServiceId, durationMinutes),
    resolveStaff(db, organization.id, location.id, clean(firstSegment?.team_member_id, 100)),
  ]);
  const petId = await resolvePet(db, organization.id, clientId);
  const localStatus = squareStatus(clean(booking.status, 40));
  const existingId = await linkedLocalId(db, organization.id, "appointment", externalBookingId);
  const [existing] = existingId ? await db.select().from(appointments).where(and(eq(appointments.id, existingId), eq(appointments.organizationId, organization.id))).limit(1) : [undefined];
  const now = new Date().toISOString();
  const appointmentId = existing?.id || crypto.randomUUID();
  const nextStatus = existing && operationalStatuses.has(existing.status) && !["cancelled", "no_show"].includes(localStatus) ? existing.status : localStatus;
  if (existing) {
    await db.update(appointments).set({
      clientId,
      serviceId,
      staffId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: nextStatus,
      petId: existing.petId || petId,
      depositCents: 0,
      depositStatus: "not_required",
      updatedAt: now,
    }).where(and(eq(appointments.id, existing.id), eq(appointments.organizationId, organization.id)));
  } else {
    const [service] = await db.select({ priceFromCents: services.priceFromCents }).from(services).where(eq(services.id, serviceId)).limit(1);
    await db.insert(appointments).values({
      id: appointmentId,
      organizationId: organization.id,
      locationId: location.id,
      clientId,
      petId,
      serviceId,
      staffId,
      status: nextStatus,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      priceEstimateCents: service?.priceFromCents || 0,
      depositCents: 0,
      depositStatus: "not_required",
      currency: location.currency,
      clientNotes: clean(booking.customer_note, 1000),
    });
  }
  if (["cancelled", "no_show"].includes(nextStatus)) await db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, appointmentId));
  await Promise.all([
    linkEntity(db, { organizationId: organization.id, locationId: location.id, entityType: "appointment", localEntityId: appointmentId, externalEntityId: externalBookingId, externalVersion: String(booking.version ?? ""), metadata: { externalLocationId } }),
    linkEntity(db, { organizationId: organization.id, locationId: location.id, entityType: "location", localEntityId: location.id, externalEntityId: externalLocationId }),
    db.update(salonSettings).set({ allowOnlineBooking: false, requireOnlineDeposit: false, updatedAt: now }).where(and(eq(salonSettings.organizationId, organization.id), eq(salonSettings.locationId, location.id))),
    db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: organization.id, actorType: "system", action: existing ? "integration.square_booking_updated" : "integration.square_booking_created", entityType: "appointment", entityId: appointmentId, detailsJson: JSON.stringify({ externalBookingId, externalStatus: booking.status, localStatus: nextStatus }) }),
  ]);
  return { handled: true, appointmentId, organizationId: organization.id, locationId: location.id };
}

export async function retrieveAndSyncSquareBooking(db: Db, bookingId: string) {
  const response = await squareRequest<{ booking?: SquareBooking }>(`bookings/${encodeURIComponent(bookingId)}`);
  if (!response.booking) throw new Error("Square booking could not be retrieved.");
  return syncSquareBooking(db, response.booking);
}

export async function reconcileSquareBookings(db: Db = getDb(), now = new Date(), force = false) {
  const config = squareConfig();
  if (!config.syncConfigured) return { configured: false, synced: 0 };
  const storefront = await resolveStorefront({ organizationSlug: config.organizationSlug || undefined, locationSlug: config.locationSlug || undefined });
  const { organization, location } = storefront;
  const [state] = await db.select().from(integrationSyncStates).where(and(eq(integrationSyncStates.provider, "square"), eq(integrationSyncStates.locationId, location.id))).limit(1);
  if (!force && state?.lastStartedAt && new Date(state.lastStartedAt).getTime() > now.getTime() - 55 * 60_000) return { configured: true, synced: 0, skipped: true };
  const startedAt = now.toISOString();
  const stateId = state?.id || crypto.randomUUID();
  await db.insert(integrationSyncStates).values({ id: stateId, organizationId: organization.id, locationId: location.id, provider: "square", status: "running", lastStartedAt: startedAt, updatedAt: startedAt }).onConflictDoUpdate({ target: [integrationSyncStates.provider, integrationSyncStates.locationId], set: { status: "running", lastStartedAt: startedAt, error: "", updatedAt: startedAt } });
  try {
    let cursor = "";
    let synced = 0;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({
        limit: "100",
        start_at_min: new Date(now.getTime() - 30 * 86400000).toISOString(),
        start_at_max: new Date(now.getTime() + 180 * 86400000).toISOString(),
      });
      if (config.externalLocationId) query.set("location_id", config.externalLocationId);
      if (cursor) query.set("cursor", cursor);
      const response = await squareRequest<{ bookings?: SquareBooking[]; cursor?: string }>("bookings", { query });
      for (const booking of response.bookings || []) {
        const result = await syncSquareBooking(db, booking);
        if (result.handled) synced += 1;
      }
      cursor = response.cursor || "";
      if (!cursor) break;
    }
    const completedAt = new Date().toISOString();
    await db.update(integrationSyncStates).set({ status: "succeeded", lastSyncedAt: completedAt, error: "", updatedAt: completedAt }).where(eq(integrationSyncStates.id, stateId));
    return { configured: true, synced };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Square reconciliation failed").slice(0, 500);
    await db.update(integrationSyncStates).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(integrationSyncStates.id, stateId));
    throw error;
  }
}

export async function squareManagedAppointmentIds(db: Db, organizationId: string, appointmentIds: string[]) {
  if (!appointmentIds.length) return new Set<string>();
  const rows = await db.select({ id: externalEntityLinks.localEntityId }).from(externalEntityLinks).where(and(
    eq(externalEntityLinks.organizationId, organizationId),
    eq(externalEntityLinks.provider, "square"),
    eq(externalEntityLinks.entityType, "appointment"),
    inArray(externalEntityLinks.localEntityId, appointmentIds),
  ));
  return new Set(rows.map((row) => row.id));
}

export async function attachSolePetToSquareAppointments(db: Db, organizationId: string, clientId: string, petId: string) {
  const placeholders = await db.select({ id: pets.id }).from(pets).where(and(eq(pets.organizationId, organizationId), eq(pets.clientId, clientId), eq(pets.name, "Pet to assign")));
  if (!placeholders.length) return 0;
  const realPets = await db.select({ id: pets.id }).from(pets).where(and(eq(pets.organizationId, organizationId), eq(pets.clientId, clientId), sql`${pets.name} <> 'Pet to assign'`));
  if (realPets.length !== 1 || realPets[0].id !== petId) return 0;
  const managed = await squareManagedAppointmentIds(db, organizationId, (await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.organizationId, organizationId), eq(appointments.clientId, clientId), gte(appointments.startsAt, new Date().toISOString())))).map((row) => row.id));
  if (!managed.size) return 0;
  const updated = await db.update(appointments).set({ petId, updatedAt: new Date().toISOString() }).where(and(
    eq(appointments.organizationId, organizationId),
    eq(appointments.clientId, clientId),
    inArray(appointments.id, [...managed]),
    inArray(appointments.petId, placeholders.map((row) => row.id)),
  )).returning({ id: appointments.id });
  return updated.length;
}
