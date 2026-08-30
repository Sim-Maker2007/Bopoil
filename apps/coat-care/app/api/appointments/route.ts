import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { DbBatchItem } from "../../../db";
import { requireSalonAccess, requireSalonManager, requireSchedulingAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { appointmentChangeClaims, appointmentReservations, appointments, auditEvents, clients, locations, onlinePaymentSessions, paymentProviderAccounts, pets, services } from "../../../db/schema";
import { canTransitionAppointment } from "../../../lib/appointment-workflow";
import { cancelPendingAppointmentMessages, queueAppointmentMessage, queueBookingCommunications } from "../../../db/communications";
import { issuePortalEmailSession } from "../../../db/client-portal";
import { stripeRequest } from "../../../lib/stripe";
import { buildReservationRows, loadAvailability, reservationInsertStatements } from "../../../db/availability";
import { dateKeyInZone } from "../../../lib/time-zone";
import { portalAccessUrl } from "../../../lib/portal-links";
import { squareManagedAppointmentIds } from "../../../lib/square-sync";

import { databaseErrorMessage } from "../../../db";
type StaffBookingPayload = {
  clientName?: string; email?: string; phone?: string; petName?: string; breed?: string;
  clientId?: string; petId?: string; serviceId?: string; staffId?: string; startsAt?: string;
  clientNotes?: string; walkIn?: boolean; addPetToExisting?: boolean;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const operationalStageTargets = new Set(["arrived", "bathing", "drying", "grooming", "quality_check", "ready"]);

function requireAppointmentWriteAccess(membership: { role: string; permissions?: Parameters<typeof requireWorkspacePermission>[0]["permissions"] }, nextStatus: string, action: string) {
  if (!action && operationalStageTargets.has(nextStatus)) {
    requireWorkspacePermission(membership, "calendar");
    if (["owner", "manager", "receptionist", "groomer", "bather"].includes(membership.role)) return;
  }
  requireSchedulingAccess(membership);
}

function addDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

function dateDistance(from: string, to: string) {
  return Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function changedTimestamp(previous: string) {
  const previousTime = new Date(previous).getTime();
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireSchedulingAccess(membership);
    const url = new URL(request.url);
    if (url.searchParams.has("clientQuery")) {
      requireWorkspacePermission(membership, "clients");
      const query = url.searchParams.get("clientQuery")?.trim().slice(0, 80) ?? "";
      if (query.length < 2) return Response.json({ clients: [] }, { headers: { "cache-control": "private, no-store" } });
      const needle = query.toLowerCase();
      const phoneNeedle = query.replace(/\D/g, "");
      const clientRows = await db.select({
        id: clients.id,
        fullName: clients.fullName,
        email: clients.email,
        phone: clients.phone,
      }).from(clients).where(and(
        eq(clients.organizationId, membership.organizationId),
        or(
          sql`strpos(lower(${clients.fullName}), ${needle}) > 0`,
          sql`strpos(lower(${clients.email}), ${needle}) > 0`,
          sql`strpos(lower(${clients.phone}), ${needle}) > 0`,
          phoneNeedle.length >= 3 ? sql`strpos(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), ${phoneNeedle}) > 0` : undefined,
          sql`exists (
            select 1 from ${pets}
            where ${pets.clientId} = ${clients.id}
              and ${pets.organizationId} = ${membership.organizationId}
              and (
                strpos(lower(${pets.name}), ${needle}) > 0
                or strpos(lower(${pets.breed}), ${needle}) > 0
              )
          )`,
        ),
      )).orderBy(asc(clients.fullName)).limit(8);
      const clientIds = clientRows.map((client) => client.id);
      const petRows = clientIds.length ? await db.select({
        id: pets.id,
        clientId: pets.clientId,
        name: pets.name,
        breed: pets.breed,
      }).from(pets).where(and(
        eq(pets.organizationId, membership.organizationId),
        inArray(pets.clientId, clientIds),
      )).orderBy(asc(pets.name)) : [];
      return Response.json({
        clients: clientRows.map((client) => ({
          ...client,
          pets: petRows.filter((pet) => pet.clientId === client.id).map((pet) => ({ id: pet.id, name: pet.name, breed: pet.breed })),
        })),
      }, { headers: { "cache-control": "private, no-store" } });
    }

    const serviceId = url.searchParams.get("serviceId")?.trim() ?? "";
    if (!serviceId) throw new SalonAccessError("Choose a service to see live openings.", 400);
    const [currentLocation] = await db.select().from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId), eq(locations.active, true))).limit(1);
    if (!currentLocation) throw new SalonAccessError("The salon location is unavailable.", 404);
    const excludeAppointmentId = url.searchParams.get("excludeAppointmentId")?.trim() ?? "";
    if (excludeAppointmentId) {
      const [ownedAppointment] = await db.select({ id: appointments.id, serviceId: appointments.serviceId }).from(appointments).where(and(
        eq(appointments.id, excludeAppointmentId),
        eq(appointments.organizationId, membership.organizationId),
        eq(appointments.locationId, membership.locationId),
      )).limit(1);
      if (!ownedAppointment || ownedAppointment.serviceId !== serviceId) throw new SalonAccessError("Appointment not found for this service.", 404);
    }
    const today = dateKeyInZone(new Date(), currentLocation.timezone);
    const walkIn = url.searchParams.get("walkIn") === "1";
    const availabilityOptions = {
      organizationId: membership.organizationId,
      locationId: membership.locationId,
      includeWhenOnlineBookingPaused: true,
      excludeAppointmentId: excludeAppointmentId || undefined,
      minimumLeadMinutesOverride: walkIn ? 0 : undefined,
    };
    const probe = await loadAvailability(serviceId, [today], availabilityOptions);
    if (!probe.settings || !probe.service) throw new SalonAccessError("That service is no longer available at this location.", 404);
    const requestedFrom = url.searchParams.get("from")?.trim() || today;
    if (!validDateKey(requestedFrom)) throw new SalonAccessError("Choose a valid starting date.", 400);
    const from = requestedFrom < today ? today : requestedFrom;
    const bookingWindowEnd = walkIn ? today : addDays(today, probe.settings.bookingWindowDays);
    if (from > bookingWindowEnd) {
      return Response.json({ service: { id: probe.service.id, name: probe.service.name }, timezone: probe.location.timezone, slots: [], bookingWindowEnd, hasMore: false, nextFrom: null });
    }
    const requestedDays = Number(url.searchParams.get("days") || 14);
    const pageSize = Math.max(1, Math.min(21, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 14));
    const dayCount = Math.min(pageSize, dateDistance(from, bookingWindowEnd) + 1);
    const dates = Array.from({ length: dayCount }, (_, index) => addDays(from, index));
    const availability = await loadAvailability(serviceId, dates, availabilityOptions);
    const nextFrom = addDays(from, dayCount);
    return Response.json({
      service: { id: availability.service?.id, name: availability.service?.name },
      timezone: availability.location?.timezone,
      slots: availability.slots,
      bookingWindowEnd,
      hasMore: nextFrom <= bookingWindowEnd,
      nextFrom: nextFrom <= bookingWindowEnd ? nextFrom : null,
    });
  } catch (error) {
    return salonApiError(error, "Live openings are unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireSchedulingAccess(membership);
    requireWorkspacePermission(membership, "clients");
    const payload = await request.json() as StaffBookingPayload;
    const clientName = payload.clientName?.trim() ?? "";
    const email = payload.email?.trim().toLowerCase() ?? "";
    const phone = payload.phone?.trim() ?? "";
    const phoneDigits = phone.replace(/\D/g, "");
    const petName = payload.petName?.trim() ?? "";
    const breed = payload.breed?.trim() || "Not specified";
    const serviceId = payload.serviceId?.trim() ?? "";
    const requestedStaffId = payload.staffId?.trim() ?? "";
    const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
    const clientNotes = payload.clientNotes?.trim().slice(0, 1000) ?? "";
    const requestedClientId = payload.clientId?.trim() ?? "";
    const requestedPetId = payload.petId?.trim() ?? "";
    const addingPetToExisting = payload.addPetToExisting === true;
    const usingExistingProfile = Boolean(requestedClientId && requestedPetId);
    if (addingPetToExisting && (!requestedClientId || requestedPetId || !petName)) throw new SalonAccessError("Choose an existing client and enter the new pet's name.", 400);
    if (!addingPetToExisting && Boolean(requestedClientId || requestedPetId) && !usingExistingProfile) throw new SalonAccessError("Choose both an existing client and one of their pets.", 400);
    if (!usingExistingProfile && !addingPetToExisting && (!clientName || !emailPattern.test(email) || phoneDigits.length < 10 || phoneDigits.length > 15 || !petName)) throw new SalonAccessError("Complete the client name, email, phone, and pet.", 400);
    if (!serviceId || !startsAt || Number.isNaN(startsAt.valueOf())) throw new SalonAccessError("Choose a service and current live opening.", 400);

    let clientId = requestedClientId;
    let petId = requestedPetId;
    let bookedPetName = petName;
    let clientInsert: DbBatchItem | null = null;
    let petInsert: DbBatchItem | null = null;
    if (usingExistingProfile) {
      const [[ownedClient], [ownedPet]] = await Promise.all([
        db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, requestedClientId), eq(clients.organizationId, membership.organizationId))).limit(1),
        db.select({ id: pets.id, name: pets.name }).from(pets).where(and(eq(pets.id, requestedPetId), eq(pets.clientId, requestedClientId), eq(pets.organizationId, membership.organizationId))).limit(1),
      ]);
      if (!ownedClient || !ownedPet) throw new SalonAccessError("That client or pet is no longer available in this salon.", 404);
      bookedPetName = ownedPet.name;
    } else if (addingPetToExisting) {
      const [[ownedClient], [sameNamePet]] = await Promise.all([
        db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, requestedClientId), eq(clients.organizationId, membership.organizationId))).limit(1),
        db.select({ id: pets.id }).from(pets).where(and(
          eq(pets.clientId, requestedClientId),
          eq(pets.organizationId, membership.organizationId),
          eq(sql<string>`lower(${pets.name})`, petName.toLowerCase()),
        )).limit(1),
      ]);
      if (!ownedClient) throw new SalonAccessError("That client is no longer available in this salon.", 404);
      if (sameNamePet) throw new SalonAccessError("This client already has a pet with that name. Choose the saved pet instead.", 409, "existing_pet_selection_required");
      clientId = ownedClient.id;
      petId = crypto.randomUUID();
      petInsert = db.insert(pets).values({ id: petId, organizationId: membership.organizationId, clientId, name: petName, breed });
    } else {
      const [exactClient] = await db.select({ id: clients.id }).from(clients).where(and(
        eq(clients.organizationId, membership.organizationId),
        or(
          eq(sql<string>`lower(${clients.email})`, email),
          eq(sql<string>`right(replace(replace(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)`, phoneDigits.slice(-10)),
        ),
      )).limit(1);
      if (exactClient) throw new SalonAccessError("That email or phone already belongs to a salon client. Choose Existing client and confirm the correct pet.", 409, "existing_client_selection_required");
      clientId = crypto.randomUUID();
      petId = crypto.randomUUID();
      clientInsert = db.insert(clients).values({ id: clientId, organizationId: membership.organizationId, fullName: clientName, email, phone });
      petInsert = db.insert(pets).values({ id: petId, organizationId: membership.organizationId, clientId, name: petName, breed });
    }

    const [selectedService] = await db.select().from(services).where(and(eq(services.id, serviceId), eq(services.organizationId, membership.organizationId), eq(services.locationId, membership.locationId), eq(services.active, true))).limit(1);
    if (!selectedService) throw new SalonAccessError("That service is no longer available at this location.", 404);

    const [currentLocation] = await db.select().from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId), eq(locations.active, true))).limit(1);
    if (!currentLocation) throw new SalonAccessError("The salon location is unavailable.", 409);
    const date = dateKeyInZone(startsAt, currentLocation.timezone);
    const walkIn = payload.walkIn === true;
    const today = dateKeyInZone(new Date(), currentLocation.timezone);
    if (walkIn && date !== today) throw new SalonAccessError("Walk-ins must use an opening today.", 400);
    const availability = await loadAvailability(serviceId, [date], {
      organizationId: membership.organizationId,
      locationId: membership.locationId,
      includeWhenOnlineBookingPaused: true,
      minimumLeadMinutesOverride: walkIn ? 0 : undefined,
    });
    const slot = availability.slots.find((item) => item.startsAt === startsAt.toISOString());
    if (!slot?.staff.length || !availability.service || !availability.capacity) throw new SalonAccessError("That opening was just taken. Choose another live time.", 409);
    const assignedStaff = slot.staff.find((person) => person.id === requestedStaffId) || slot.staff[0];

    const appointmentId = crypto.randomUUID();
    const reservationRows = await buildReservationRows(db, { appointmentId, organizationId: membership.organizationId, locationId: membership.locationId, staffId: assignedStaff.id, startsAt: slot.startsAt, endsAt: slot.endsAt, service: availability.service, capacity: availability.capacity, existingAppointments: availability.appointmentRows });
    if (!reservationRows) throw new SalonAccessError("That opening was just reserved. Choose another live time.", 409);
    const appointmentInsert = db.insert(appointments).values({
      id: appointmentId, organizationId: membership.organizationId, locationId: membership.locationId,
      clientId, petId, serviceId, staffId: assignedStaff.id, status: walkIn ? "arrived" : "confirmed",
      startsAt: slot.startsAt, endsAt: slot.endsAt, priceEstimateCents: selectedService.priceFromCents,
      depositCents: selectedService.depositCents, depositStatus: "not_required", currency: currentLocation.currency, clientNotes,
    }).returning();
    const auditInsert = db.insert(auditEvents).values({
      id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id,
      action: "appointment.created", entityType: "appointment", entityId: appointmentId,
      detailsJson: JSON.stringify({ serviceId, startsAt: slot.startsAt, staffId: assignedStaff.id, source: "staff_quick_booking", bookingMode: walkIn ? "walk_in" : "scheduled", existingProfile: usingExistingProfile || addingPetToExisting, newPetForExistingClient: addingPetToExisting, policyConsentRecorded: false }),
    });
    let appointment;
    try {
      const prefix = [clientInsert, petInsert].filter((statement): statement is DbBatchItem => Boolean(statement));
      const appointmentIndex = prefix.length;
      const statements = [...prefix, appointmentInsert, ...reservationInsertStatements(db, reservationRows), auditInsert] as unknown as [DbBatchItem, ...DbBatchItem[]];
      const results = await db.batch(statements);
      appointment = (results[appointmentIndex] as Array<typeof appointments.$inferSelect>)[0];
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(databaseErrorMessage(error))) throw new SalonAccessError("That opening was just reserved. Choose another live time.", 409);
      throw error;
    }
    if (!appointment) throw new SalonAccessError("The appointment changed before it could be saved. Try again.", 409);
    try {
      const portal = await issuePortalEmailSession(db, clientId);
      await queueBookingCommunications(db, appointmentId, appointment.startsAt, appointment.status, { portal_url: portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portal.token) }, "staff-quick-booking");
    } catch (communicationError) {
      console.error("Staff booking saved, but its private link or confirmation could not be prepared", communicationError);
    }
    return Response.json({ appointment: { id: appointment.id, status: appointment.status, startsAt: appointment.startsAt, endsAt: appointment.endsAt, petName: bookedPetName, serviceName: selectedService.name, staffName: assignedStaff.name } }, { status: 201 });
  } catch (error) {
    return salonApiError(error, "Appointment could not be created.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    const payload = await request.json() as { appointmentId?: string; status?: string; action?: string; startsAt?: string; staffId?: string };
    const appointmentId = payload.appointmentId?.trim() ?? "";
    const nextStatus = payload.status?.trim() ?? "";
    const action = payload.action?.trim() ?? "";
    requireAppointmentWriteAccess(membership, nextStatus, action);
    if (!appointmentId || (!nextStatus && !["waive_deposit", "reschedule"].includes(action))) return Response.json({ error: "Appointment and status are required." }, { status: 400 });

    const [existing] = await db.select().from(appointments).where(and(
      eq(appointments.id, appointmentId),
      eq(appointments.organizationId, membership.organizationId),
      eq(appointments.locationId, membership.locationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Appointment not found." }, { status: 404 });
    const squareManaged = (await squareManagedAppointmentIds(db, membership.organizationId, [existing.id])).has(existing.id);
    if (squareManaged && (action === "reschedule" || action === "waive_deposit" || (!action && ["requested", "confirmed", "cancelled", "no_show"].includes(nextStatus)))) {
      throw new SalonAccessError("This appointment is managed in Square. Change its schedule or booking status in Square; Coat & Care will synchronize it automatically.", 409);
    }
    if (
      !action
      && operationalStageTargets.has(nextStatus)
      && ["groomer", "bather"].includes(membership.role)
      && existing.staffId !== membership.id
    ) {
      throw new SalonAccessError("Only the team member assigned to this appointment can advance its care stage.", 403);
    }

    if (action === "reschedule") {
      if (!["requested", "confirmed"].includes(existing.status)) throw new SalonAccessError("Only upcoming requested or confirmed appointments can be rescheduled.", 409);
      const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
      if (!startsAt || Number.isNaN(startsAt.valueOf())) throw new SalonAccessError("Choose a valid live opening.", 400);
      const [currentLocation] = await db.select().from(locations).where(and(
        eq(locations.id, membership.locationId),
        eq(locations.organizationId, membership.organizationId),
        eq(locations.active, true),
      )).limit(1);
      if (!currentLocation) throw new SalonAccessError("The salon location is unavailable.", 409);
      const availability = await loadAvailability(existing.serviceId, [dateKeyInZone(startsAt, currentLocation.timezone)], {
        organizationId: membership.organizationId,
        locationId: membership.locationId,
        excludeAppointmentId: existing.id,
        includeWhenOnlineBookingPaused: true,
      });
      const slot = availability.slots.find((item) => item.startsAt === startsAt.toISOString());
      if (!slot?.staff.length || !availability.service || !availability.capacity) throw new SalonAccessError("That opening is no longer available.", 409);
      const requestedStaffId = payload.staffId?.trim() ?? "";
      const assignedStaff = slot.staff.find((person) => person.id === requestedStaffId) || slot.staff[0];
      const reservationRows = await buildReservationRows(db, {
        appointmentId,
        organizationId: membership.organizationId,
        locationId: membership.locationId,
        excludeAppointmentId: existing.id,
        staffId: assignedStaff.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        service: availability.service,
        capacity: availability.capacity,
        existingAppointments: availability.appointmentRows,
      });
      if (!reservationRows) throw new SalonAccessError("That opening was just reserved. Choose another live time.", 409);
      const changedAt = changedTimestamp(existing.updatedAt);
      const claim = db.insert(appointmentChangeClaims).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        appointmentId,
        expectedUpdatedAt: sql<string>`(
          select updated_at from appointments
          where id = ${appointmentId}
            and organization_id = ${membership.organizationId}
            and location_id = ${membership.locationId}
            and status = ${existing.status}
            and updated_at = ${existing.updatedAt}
        )`,
        actorType: "staff",
        actorId: membership.id,
      });
      const appointmentWrite = db.update(appointments).set({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        staffId: assignedStaff.id,
        updatedAt: changedAt,
      }).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, membership.organizationId),
        eq(appointments.locationId, membership.locationId),
        eq(appointments.status, existing.status),
        eq(appointments.updatedAt, existing.updatedAt),
      )).returning();
      const audit = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        actorType: "staff",
        actorId: membership.id,
        action: "appointment.rescheduled_by_staff",
        entityType: "appointment",
        entityId: appointmentId,
        detailsJson: JSON.stringify({ from: existing.startsAt, to: slot.startsAt, staffId: assignedStaff.id }),
      });
      let updated;
      try {
        const results = await db.batch([
          claim,
          db.delete(appointmentReservations).where(and(
            eq(appointmentReservations.organizationId, membership.organizationId),
            eq(appointmentReservations.locationId, membership.locationId),
            eq(appointmentReservations.appointmentId, appointmentId),
          )),
          appointmentWrite,
          ...reservationInsertStatements(db, reservationRows),
          audit,
        ]);
        updated = results[2][0];
      } catch (error) {
        if (error instanceof Error && /unique|constraint|null/i.test(databaseErrorMessage(error))) throw new SalonAccessError("That opening or appointment just changed. Refresh and try again.", 409);
        throw error;
      }
      if (!updated) throw new SalonAccessError("This appointment changed. Refresh and try again.", 409);
      await cancelPendingAppointmentMessages(db, appointmentId, membership.id).catch((communicationError) => {
        console.error("Appointment was rescheduled, but old messages could not all be cancelled", communicationError);
      });
      try {
        const portal = await issuePortalEmailSession(db, existing.clientId);
        await queueBookingCommunications(db, appointmentId, updated.startsAt, updated.status, { portal_url: portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portal.token) }, `staff-rescheduled-${changedAt}`);
      } catch (communicationError) {
        console.error("Appointment was rescheduled, but updated communications could not be prepared", communicationError);
      }
      return Response.json({ appointment: { id: updated.id, status: updated.status, startsAt: updated.startsAt, endsAt: updated.endsAt, staffId: updated.staffId, staffName: assignedStaff.name, updatedAt: updated.updatedAt } });
    }

    if (action === "waive_deposit") {
      requireSalonManager(membership); if (existing.depositStatus !== "pending") throw new SalonAccessError("This appointment does not have a pending deposit.", 409);
      if (["cancelled", "no_show", "completed"].includes(existing.status)) throw new SalonAccessError("A closed appointment cannot have its deposit waived.", 409);
      const [[session], [account]] = await Promise.all([db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.locationId, membership.locationId), eq(onlinePaymentSessions.appointmentId, appointmentId), eq(onlinePaymentSessions.status, "open"), eq(onlinePaymentSessions.purpose, "deposit"))).limit(1), db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1)]);
      if (session && !account) throw new SalonAccessError("The payout connection is unavailable, so the live payment link could not be closed safely.", 409);
      if (session && account) { try { await stripeRequest(`checkout/sessions/${session.providerSessionId}/expire`, {}, { account: account.connectedAccountId, idempotencyKey: `waive-deposit:${appointmentId}:${existing.updatedAt}` }); } catch { throw new SalonAccessError("The payment session is already changing. Refresh the appointment before waiving the deposit.", 409); } }
      const changedAt = changedTimestamp(existing.updatedAt);
      const claim = db.insert(appointmentChangeClaims).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        appointmentId,
        expectedUpdatedAt: sql<string>`(
          select updated_at from appointments
          where id = ${appointmentId}
            and organization_id = ${membership.organizationId}
            and location_id = ${membership.locationId}
            and status = ${existing.status}
            and deposit_status = 'pending'
            and updated_at = ${existing.updatedAt}
        )`,
        actorType: "staff",
        actorId: membership.id,
      });
      const appointmentWrite = db.update(appointments).set({ depositStatus: "waived", status: "confirmed", updatedAt: changedAt }).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.organizationId, membership.organizationId),
        eq(appointments.locationId, membership.locationId),
        eq(appointments.status, existing.status),
        eq(appointments.depositStatus, "pending"),
        eq(appointments.updatedAt, existing.updatedAt),
      )).returning();
      const audit = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "booking.deposit_waived", entityType: "appointment", entityId: appointmentId, detailsJson: JSON.stringify({ from: existing.status, changedAt }) });
      let updated;
      try {
        if (session) {
          const results = await db.batch([
            claim,
            appointmentWrite,
            db.update(onlinePaymentSessions).set({ status: "cancelled", updatedAt: changedAt }).where(and(eq(onlinePaymentSessions.id, session.id), eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.status, "open"))),
            audit,
          ]);
          updated = results[1][0];
        } else {
          const results = await db.batch([claim, appointmentWrite, audit]);
          updated = results[1][0];
        }
      } catch (error) {
        if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new SalonAccessError("The deposit state changed. Refresh and try again.", 409);
        throw error;
      }
      if (!updated) throw new SalonAccessError("The deposit state changed. Refresh and try again.", 409);
      try {
        const portal = await issuePortalEmailSession(db, existing.clientId);
        await queueBookingCommunications(db, appointmentId, updated.startsAt, "confirmed", { portal_url: portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portal.token) }, "deposit-waived");
      } catch (communicationError) {
        console.error("Deposit waived, but its private link or confirmation could not be prepared", communicationError);
      }
      return Response.json({ appointment: { id: updated.id, status: updated.status, depositStatus: updated.depositStatus, updatedAt: updated.updatedAt } });
    }

    if (existing.depositStatus === "pending" && nextStatus === "confirmed") return Response.json({ error: "This opening is awaiting its required deposit. A manager can waive it explicitly instead." }, { status: 409 });
    if (!canTransitionAppointment(existing.status, nextStatus)) {
      return Response.json({ error: `A ${existing.status.replaceAll("_", " ")} appointment cannot move directly to ${nextStatus.replaceAll("_", " ")}.` }, { status: 409 });
    }
    let depositSessionId = "";
    if (existing.depositStatus === "pending" && nextStatus === "cancelled") {
      const [[session], [account]] = await Promise.all([db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.locationId, membership.locationId), eq(onlinePaymentSessions.appointmentId, appointmentId), eq(onlinePaymentSessions.status, "open"), eq(onlinePaymentSessions.purpose, "deposit"))).limit(1), db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1)]);
      if (session && !account) throw new SalonAccessError("The live payment link could not be closed safely. Try again after the payout connection recovers.", 409);
      if (session && account) { try { await stripeRequest(`checkout/sessions/${session.providerSessionId}/expire`, {}, { account: account.connectedAccountId, idempotencyKey: `cancel-deposit:${appointmentId}:${existing.updatedAt}` }); } catch { throw new SalonAccessError("The payment session is already changing. Refresh before cancelling.", 409); } depositSessionId = session.id; }
    }

    const changedAt = changedTimestamp(existing.updatedAt);
    const claim = db.insert(appointmentChangeClaims).values({
      id: crypto.randomUUID(),
      organizationId: membership.organizationId,
      appointmentId,
      expectedUpdatedAt: sql<string>`(
        select updated_at from appointments
        where id = ${appointmentId}
          and organization_id = ${membership.organizationId}
          and location_id = ${membership.locationId}
          and status = ${existing.status}
          and updated_at = ${existing.updatedAt}
      )`,
      actorType: "staff",
      actorId: membership.id,
    });
    const appointmentWrite = db.update(appointments).set({ status: nextStatus as typeof existing.status, depositStatus: nextStatus === "cancelled" && existing.depositStatus === "pending" ? "failed" : existing.depositStatus, updatedAt: changedAt }).where(and(
      eq(appointments.id, appointmentId),
      eq(appointments.organizationId, membership.organizationId),
      eq(appointments.locationId, membership.locationId),
      eq(appointments.status, existing.status),
      eq(appointments.updatedAt, existing.updatedAt),
    )).returning();
    const audit = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: membership.organizationId,
      actorType: "staff",
      actorId: membership.id,
      action: "appointment.status_changed",
      entityType: "appointment",
      entityId: appointmentId,
      detailsJson: JSON.stringify({ from: existing.status, to: nextStatus, changedAt }),
    });
    const releaseReservations = ["cancelled", "no_show"].includes(nextStatus);
    let updated;
    try {
      if (depositSessionId && releaseReservations) {
        const results = await db.batch([
          claim,
          appointmentWrite,
          db.update(onlinePaymentSessions).set({ status: "cancelled", updatedAt: changedAt }).where(and(eq(onlinePaymentSessions.id, depositSessionId), eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.status, "open"))),
          db.delete(appointmentReservations).where(and(eq(appointmentReservations.organizationId, membership.organizationId), eq(appointmentReservations.locationId, membership.locationId), eq(appointmentReservations.appointmentId, appointmentId))),
          audit,
        ]);
        updated = results[1][0];
      } else if (depositSessionId) {
        const results = await db.batch([
          claim,
          appointmentWrite,
          db.update(onlinePaymentSessions).set({ status: "cancelled", updatedAt: changedAt }).where(and(eq(onlinePaymentSessions.id, depositSessionId), eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.status, "open"))),
          audit,
        ]);
        updated = results[1][0];
      } else if (releaseReservations) {
        const results = await db.batch([
          claim,
          appointmentWrite,
          db.delete(appointmentReservations).where(and(eq(appointmentReservations.organizationId, membership.organizationId), eq(appointmentReservations.locationId, membership.locationId), eq(appointmentReservations.appointmentId, appointmentId))),
          audit,
        ]);
        updated = results[1][0];
      } else {
        const results = await db.batch([claim, appointmentWrite, audit]);
        updated = results[1][0];
      }
    } catch (error) {
      if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new SalonAccessError("This appointment changed. Refresh and try again.", 409);
      throw error;
    }
    if (!updated) throw new SalonAccessError("This appointment changed. Refresh and try again.", 409);

    if (nextStatus === "ready") {
      await queueAppointmentMessage(db, { appointmentId, templateKey: "ready_pickup", dedupeKey: `ready_pickup:${appointmentId}` }).catch((communicationError) => {
        console.error("Appointment updated, but the pickup message could not be queued", communicationError);
      });
    }
    if (existing.status === "requested" && nextStatus === "confirmed") {
      try {
        const session = await issuePortalEmailSession(db, existing.clientId); const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, session.token);
        await queueBookingCommunications(db, appointmentId, updated.startsAt, "confirmed", { portal_url: portalUrl });
      } catch (communicationError) {
        console.error("Booking confirmed, but its private link or communications could not be prepared", communicationError);
      }
    }
    if (["cancelled", "no_show"].includes(nextStatus)) {
      await cancelPendingAppointmentMessages(db, appointmentId, membership.id).catch((communicationError) => {
        console.error("Appointment closed, but pending messages could not be cancelled", communicationError);
      });
    }

    return Response.json({ appointment: { id: updated.id, status: updated.status, updatedAt: updated.updatedAt } });
  } catch (error) {
    return salonApiError(error, "Appointment could not be updated.");
  }
}
