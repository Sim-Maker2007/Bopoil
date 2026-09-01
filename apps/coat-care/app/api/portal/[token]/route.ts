import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { issuePortalEmailSession, PORTAL_EMAIL_LINK_TTL_MS, renewPortalSession, resolvePortalSession } from "../../../../db/client-portal";
import { buildReservationRows, loadAvailability, reservationInsertStatements } from "../../../../db/availability";
import { releaseExpiredBookingHolds } from "../../../../db/booking-holds";
import { cancelPendingAppointmentMessages, queueBookingCommunications } from "../../../../db/communications";
import { appointmentCareRecords, appointmentChangeClaims, appointmentReservations, appointments, auditEvents, clientPhoneIdentities, clientPhoneOtpChallenges, clientPortalSessions, clients, invoices, locations, onlinePaymentSessions, organizations, pets, salonSettings, services, staff, vaccinationRecords } from "../../../../db/schema";
import { clientPhoneChanged, normalizeClientPhone, portalCookie } from "../../../../lib/client-phone-auth";
import { dateKeyInZone, isValidDateKey } from "../../../../lib/time-zone";
import { portalCookieTokenFromRequest, portalTokenFromRequest, requestIsSameOrigin } from "../../../../lib/portal-request";
import { portalAccessUrl } from "../../../../lib/portal-links";
import { squareManagedAppointmentIds } from "../../../../lib/square-sync";

import { databaseErrorMessage } from "../../../../db";
function clean(value: unknown, max = 120) { return String(value || "").trim().slice(0, max); }
function validDate(value: string, optional = false) { return (optional && !value) || isValidDateKey(value); }

async function portalPayload(token: string) {
  const access = await resolvePortalSession(token); if (!access.client || !access.session) return { ...access, payload: null };
  const { db, client } = access;
  const nowIso = new Date().toISOString();
  const depositLocations = await db.select({ locationId: onlinePaymentSessions.locationId }).from(onlinePaymentSessions).where(and(
    eq(onlinePaymentSessions.organizationId, client.organizationId),
    eq(onlinePaymentSessions.clientId, client.id),
    eq(onlinePaymentSessions.purpose, "deposit"),
    eq(onlinePaymentSessions.status, "open"),
  ));
  for (const locationId of new Set(depositLocations.map((item) => item.locationId))) await releaseExpiredBookingHolds(db, locationId);
  const [[organization], petRows, appointmentRows, vaccines, openDepositRows] = await Promise.all([
    db.select({ name: organizations.name, slug: organizations.slug, contactEmail: organizations.contactEmail, contactPhone: organizations.contactPhone }).from(organizations).where(eq(organizations.id, client.organizationId)).limit(1),
    db.select({ id: pets.id, name: pets.name, species: pets.species, breed: pets.breed, weightKg: pets.weightKg, dateOfBirth: pets.dateOfBirth, sex: pets.sex, color: pets.color, clientNotes: pets.clientNotes }).from(pets).where(and(eq(pets.organizationId, client.organizationId), eq(pets.clientId, client.id))).orderBy(asc(pets.name)),
    db.select({ id: appointments.id, petId: appointments.petId, status: appointments.status, startsAt: appointments.startsAt, endsAt: appointments.endsAt, updatedAt: appointments.updatedAt, priceEstimateCents: appointments.priceEstimateCents, currency: appointments.currency, serviceId: services.id, serviceName: services.name, serviceActive: services.active, serviceDurationMinutes: services.durationMinutes, locationId: locations.id, locationSlug: locations.slug, locationName: locations.name, locationActive: locations.active, city: locations.city, region: locations.region, timezone: locations.timezone, cancellationHours: salonSettings.cancellationHours, staffName: staff.displayName, reportPublished: appointmentCareRecords.reportPublished, clientReport: appointmentCareRecords.clientReport, invoiceStatus: invoices.status })
      .from(appointments).innerJoin(services, eq(appointments.serviceId, services.id)).innerJoin(locations, eq(appointments.locationId, locations.id)).innerJoin(salonSettings, eq(appointments.locationId, salonSettings.locationId)).leftJoin(staff, eq(appointments.staffId, staff.id)).leftJoin(appointmentCareRecords, eq(appointments.id, appointmentCareRecords.appointmentId)).leftJoin(invoices, eq(appointments.id, invoices.appointmentId)).where(and(eq(appointments.organizationId, client.organizationId), eq(appointments.clientId, client.id))).orderBy(desc(appointments.startsAt)),
    db.select().from(vaccinationRecords).innerJoin(pets, eq(vaccinationRecords.petId, pets.id)).where(and(eq(vaccinationRecords.organizationId, client.organizationId), eq(pets.clientId, client.id))).orderBy(asc(vaccinationRecords.expiresOn)),
    db.select({
      id: onlinePaymentSessions.id,
      appointmentId: appointments.id,
      expiresAt: onlinePaymentSessions.expiresAt,
      petId: pets.id,
      petName: pets.name,
      serviceId: services.id,
      serviceName: services.name,
      locationSlug: locations.slug,
      locationName: locations.name,
    }).from(onlinePaymentSessions)
      .innerJoin(appointments, eq(onlinePaymentSessions.appointmentId, appointments.id))
      .innerJoin(pets, eq(appointments.petId, pets.id))
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .innerJoin(locations, eq(appointments.locationId, locations.id))
      .where(and(
        eq(onlinePaymentSessions.organizationId, client.organizationId),
        eq(onlinePaymentSessions.clientId, client.id),
        eq(onlinePaymentSessions.purpose, "deposit"),
        eq(onlinePaymentSessions.status, "open"),
        gt(onlinePaymentSessions.expiresAt, nowIso),
        eq(appointments.organizationId, client.organizationId),
        eq(appointments.clientId, client.id),
        eq(appointments.depositStatus, "pending"),
        eq(pets.organizationId, client.organizationId),
        eq(pets.clientId, client.id),
      )).orderBy(desc(onlinePaymentSessions.createdAt)),
  ]);
  const now = Date.now();
  const squareManaged = await squareManagedAppointmentIds(db, client.organizationId, appointmentRows.map((item) => item.id));
  const records = appointmentRows.map((item) => { const changeDeadline = new Date(item.startsAt).getTime() - item.cancellationHours * 3600000; const managedBySquare = squareManaged.has(item.id); const eligible = !managedBySquare && ["requested", "confirmed"].includes(item.status) && now < changeDeadline && !item.invoiceStatus; return { ...item, managedBySquare, canCancel: eligible, canReschedule: eligible, changeDeadline: new Date(changeDeadline).toISOString() }; });
  return { ...access, payload: { organizationName: organization?.name || "", organizationSlug: organization?.slug || "", contactEmail: organization?.contactEmail || "", contactPhone: organization?.contactPhone || "", client: { id: client.id, fullName: client.fullName, email: client.email, phone: client.phone, marketingConsent: client.marketingConsent }, pets: petRows, vaccinations: vaccines.map(({ vaccination_records }) => { const expiry = new Date(`${vaccination_records.expiresOn}T23:59:59Z`).getTime(); return { ...vaccination_records, expiryState: expiry < now ? "expired" : expiry < now + 30 * 86400000 ? "soon" : "valid" }; }), appointments: records, openDeposits: openDepositRows.map((deposit) => ({ appointmentId: deposit.appointmentId, petId: deposit.petId, petName: deposit.petName, serviceId: deposit.serviceId, serviceName: deposit.serviceName, locationSlug: deposit.locationSlug, locationName: deposit.locationName, expiresAt: deposit.expiresAt, resumePath: `/booking/payment/${encodeURIComponent(deposit.id)}` })), sessionExpiresAt: access.session.expiresAt } };
}

export async function GET(request: Request) {
  try {
    const cookieToken = portalCookieTokenFromRequest(request);
    const result = await portalPayload(portalTokenFromRequest(request));
    if (!result.payload || !result.session) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401, headers: { "cache-control": "private, no-store" } });
    const headers = new Headers({ "cache-control": "private, no-store", vary: "cookie" });
    let payload = result.payload;
    const cookieBackedSessionRoute = new URL(request.url).pathname === "/api/portal/session" && Boolean(cookieToken);
    const sessionCreatedAt = new Date(result.session.createdAt.includes("T") ? result.session.createdAt : `${result.session.createdAt.replace(" ", "T")}Z`);
    const trustedSession = new Date(result.session.expiresAt).getTime() - sessionCreatedAt.getTime() > PORTAL_EMAIL_LINK_TTL_MS * 2;
    if (cookieBackedSessionRoute && trustedSession) {
      const expiresAt = await renewPortalSession(result.db, result.session.id);
      if (expiresAt) {
        payload = { ...payload, sessionExpiresAt: expiresAt };
        const maxAgeSeconds = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
        headers.append("set-cookie", portalCookie(cookieToken, maxAgeSeconds));
      }
    }
    return Response.json(payload, { headers });
  }
  catch { return Response.json({ error: "Your pet portal is temporarily unavailable." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
    const token = portalTokenFromRequest(request); const result = await portalPayload(token); if (!result.payload || !result.client || !result.session) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 });
    const { db, client } = result; const body = await request.json() as Record<string, unknown>; const action = clean(body.action, 30);
    if (action === "profile") {
      const fullName = clean(body.fullName, 100), phone = clean(body.phone, 40); if (fullName.length < 2 || phone.length < 7) return Response.json({ error: "Enter your name and a valid phone number." }, { status: 400 });
      const changedAt = new Date().toISOString();
      const nextPhoneE164 = normalizeClientPhone(phone), phoneChanged = clientPhoneChanged(client.phone, phone);
      const clientUpdate = db.update(clients).set({ fullName, phone, marketingConsent: body.marketingConsent === true, updatedAt: changedAt }).where(and(eq(clients.id, client.id), eq(clients.organizationId, client.organizationId)));
      const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, actorType: "client", actorId: client.id, action: "client.profile_updated", entityType: "client", entityId: client.id, detailsJson: JSON.stringify({ phoneChanged }) });
      if (phoneChanged) {
        const activeIdentity = and(eq(clientPhoneIdentities.organizationId, client.organizationId), eq(clientPhoneIdentities.clientId, client.id), isNull(clientPhoneIdentities.revokedAt));
        const pendingEnrollment = and(eq(clientPhoneOtpChallenges.organizationId, client.organizationId), eq(clientPhoneOtpChallenges.enrollmentClientId, client.id), isNull(clientPhoneOtpChallenges.proofConsumedAt));
        await db.batch([
          clientUpdate,
          db.update(clientPhoneIdentities).set({ revokedAt: changedAt, updatedAt: changedAt }).where(nextPhoneE164 ? and(activeIdentity, ne(clientPhoneIdentities.phoneE164, nextPhoneE164)) : activeIdentity),
          db.update(clientPhoneOtpChallenges).set({ expiresAt: changedAt, proofConsumedAt: changedAt }).where(nextPhoneE164 ? and(pendingEnrollment, ne(clientPhoneOtpChallenges.phoneE164, nextPhoneE164)) : pendingEnrollment),
          db.update(clientPortalSessions).set({ revokedAt: changedAt }).where(and(eq(clientPortalSessions.organizationId, client.organizationId), eq(clientPortalSessions.clientId, client.id), ne(clientPortalSessions.id, result.session.id), isNull(clientPortalSessions.revokedAt))),
          auditInsert,
        ]);
      } else {
        await db.batch([clientUpdate, auditInsert]);
      }
    } else if (action === "add_pet") {
      const name = clean(body.name, 60), breed = clean(body.breed, 80); if (name.length < 2 || !breed) return Response.json({ error: "Enter your pet’s name and breed." }, { status: 400 });
      const [existing] = await db.select({ id: pets.id }).from(pets).where(and(eq(pets.clientId, client.id), eq(pets.name, name))).limit(1); if (existing) return Response.json({ error: "That pet is already in your profile." }, { status: 409 });
      const petId = crypto.randomUUID(); await db.batch([
        db.insert(pets).values({ id: petId, organizationId: client.organizationId, clientId: client.id, name, breed }),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, actorType: "client", actorId: client.id, action: "pet.created_by_client", entityType: "pet", entityId: petId }),
      ]);
    } else if (action === "pet") {
      const petId = clean(body.petId, 80); const [pet] = await db.select({ id: pets.id }).from(pets).where(and(eq(pets.id, petId), eq(pets.clientId, client.id), eq(pets.organizationId, client.organizationId))).limit(1); if (!pet) return Response.json({ error: "Pet not found." }, { status: 404 });
      const breed = clean(body.breed, 80), color = clean(body.color, 60), dateOfBirth = clean(body.dateOfBirth, 10), sex = clean(body.sex, 10), clientNotes = clean(body.clientNotes, 500); const weightKg = body.weightKg === "" || body.weightKg == null ? null : Number(body.weightKg);
      if (!breed || !validDate(dateOfBirth, true) || !["unknown", "female", "male"].includes(sex) || (weightKg !== null && (!Number.isInteger(weightKg) || weightKg < 1 || weightKg > 150))) return Response.json({ error: "Check the pet profile details." }, { status: 400 });
      await db.batch([
        db.update(pets).set({ breed, color, dateOfBirth, sex: sex as "unknown" | "female" | "male", weightKg, clientNotes, updatedAt: new Date().toISOString() }).where(eq(pets.id, petId)),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, actorType: "client", actorId: client.id, action: "pet.profile_updated_by_client", entityType: "pet", entityId: petId }),
      ]);
    } else if (action === "cancel") {
      const appointmentId = clean(body.appointmentId, 80); const appointment = result.payload.appointments.find((item) => item.id === appointmentId); if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 }); if (!appointment.canCancel) return Response.json({ error: `Online cancellation closed ${appointment.cancellationHours} hours before this visit. Please contact the salon.` }, { status: 409 });
      const now = new Date().toISOString(); const claimId = crypto.randomUUID(); let updated: { id: string } | undefined;
      try { const results = await db.batch([db.insert(appointmentChangeClaims).values({ id: claimId, organizationId: client.organizationId, appointmentId, expectedUpdatedAt: sql`(select updated_at from appointments where id = ${appointmentId} and updated_at = ${appointment.updatedAt})`, actorType: "client", actorId: client.id }), db.update(appointments).set({ status: "cancelled", updatedAt: now }).where(and(eq(appointments.id, appointmentId), eq(appointments.clientId, client.id), eq(appointments.status, appointment.status), eq(appointments.updatedAt, appointment.updatedAt))).returning(), db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, appointmentId)), db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, actorType: "client", actorId: client.id, action: "appointment.cancelled_by_client", entityType: "appointment", entityId: appointmentId })]); updated = results[1][0]; }
      catch (error) { if (error instanceof Error && /unique|constraint|null/i.test(databaseErrorMessage(error))) return Response.json({ error: "This appointment changed. Refresh and try again." }, { status: 409 }); throw error; }
      if (!updated) return Response.json({ error: "This appointment changed. Refresh and try again." }, { status: 409 });
      await cancelPendingAppointmentMessages(db, appointmentId, client.id, "client").catch((error) => console.error("Appointment was cancelled, but pending messages could not all be cancelled", error));
    } else if (action === "reschedule") {
      const appointmentId = clean(body.appointmentId, 80), startsAt = new Date(clean(body.startsAt, 40)); const appointment = result.payload.appointments.find((item) => item.id === appointmentId); if (!appointment) return Response.json({ error: "Appointment not found." }, { status: 404 }); if (!appointment.canReschedule) return Response.json({ error: `Online changes closed ${appointment.cancellationHours} hours before this visit. Please contact the salon.` }, { status: 409 }); if (Number.isNaN(startsAt.valueOf())) return Response.json({ error: "Choose a valid live opening." }, { status: 400 });
      const availability = await loadAvailability(appointment.serviceId, [dateKeyInZone(startsAt, appointment.timezone)], { organizationId: client.organizationId, locationId: appointment.locationId, excludeAppointmentId: appointment.id }); const slot = availability.slots.find((item) => item.startsAt === startsAt.toISOString()); if (!slot?.staff.length || !availability.service) return Response.json({ error: "That opening is no longer available." }, { status: 409 });
      const staffMember = slot.staff[0]; const reservations = await buildReservationRows(db, { appointmentId, organizationId: client.organizationId, locationId: appointment.locationId, excludeAppointmentId: appointment.id, staffId: staffMember.id, startsAt: slot.startsAt, endsAt: slot.endsAt, service: availability.service, capacity: availability.capacity, existingAppointments: availability.appointmentRows }); if (!reservations) return Response.json({ error: "That opening was just reserved." }, { status: 409 });
      const changedAt = new Date().toISOString();
      const claimId = crypto.randomUUID();
      try { await db.batch([db.insert(appointmentChangeClaims).values({ id: claimId, organizationId: client.organizationId, appointmentId, expectedUpdatedAt: sql`(select updated_at from appointments where id = ${appointmentId} and updated_at = ${appointment.updatedAt})`, actorType: "client", actorId: client.id }), db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, appointmentId)), db.update(appointments).set({ startsAt: slot.startsAt, endsAt: slot.endsAt, staffId: staffMember.id, updatedAt: changedAt }).where(and(eq(appointments.id, appointmentId), eq(appointments.clientId, client.id), eq(appointments.updatedAt, appointment.updatedAt))), ...reservationInsertStatements(db, reservations), db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, actorType: "client", actorId: client.id, action: "appointment.rescheduled_by_client", entityType: "appointment", entityId: appointmentId, detailsJson: JSON.stringify({ from: appointment.startsAt, to: slot.startsAt, staffId: staffMember.id }) })]); }
      catch (error) { if (error instanceof Error && /unique|constraint/i.test(databaseErrorMessage(error))) return Response.json({ error: "That opening was just reserved." }, { status: 409 }); throw error; }
      await cancelPendingAppointmentMessages(db, appointmentId, client.id, "client").catch((error) => console.error("Appointment was rescheduled, but old messages could not all be cancelled", error));
      try {
        const emailSession = await issuePortalEmailSession(db, client.id);
        const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, emailSession.token);
        await queueBookingCommunications(db, appointmentId, slot.startsAt, appointment.status, { portal_url: portalUrl }, `rescheduled-${Date.now()}`);
      } catch (error) {
        console.error("Appointment was rescheduled, but its updated confirmation could not be prepared", error);
      }
    } else return Response.json({ error: "Unknown portal action." }, { status: 400 });
    const updated = await portalPayload(token); return Response.json(updated.payload);
  } catch (error) { console.error("Client portal mutation failed", error); return Response.json({ error: "Your change could not be saved." }, { status: 500 }); }
}
