import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { appointmentReservations, appointments, auditEvents, clientPhoneIdentities, clientPhoneOtpChallenges, clients, consentRecords, invoiceLineItems, invoices, onlinePaymentSessions, paymentProviderAccounts, pets, portalAccessRequests, services } from "../../../db/schema";
import { queueBookingCommunications, queueClientTemplateMessage, queuePortalAccessMessage } from "../../../db/communications";
import { buildReservationRows, loadAvailability, reservationInsertStatements } from "../../../db/availability";
import { dateKeyInZone } from "../../../lib/time-zone";
import { issuePortalEmailSession, issuePortalSession, resolvePortalSession } from "../../../db/client-portal";
import { readVerifiedPhoneProof } from "../../../db/client-phone-auth";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";
import { CLIENT_PHONE_CHALLENGE_COOKIE, challengeCookie, cookieValue, normalizeClientPhone, portalCookie, requestSource, sha256Hex } from "../../../lib/client-phone-auth";
import { calculateInvoice } from "../../../lib/financial-ledger";
import { portalCookieRequestIsSameOrigin, portalCookieTokenFromRequest, requestIsSameOrigin } from "../../../lib/portal-request";
import { portalAccessUrl } from "../../../lib/portal-links";
import { stripeConfig, stripeRequest } from "../../../lib/stripe";

import { databaseErrorMessage } from "../../../db";
type BookingPayload = {
  salonSlug?: string;
  locationSlug?: string;
  clientName?: string;
  email?: string;
  phone?: string;
  petName?: string;
  petId?: string;
  breed?: string;
  serviceId?: string;
  startsAt?: string;
  clientNotes?: string;
  policyAccepted?: boolean;
  marketingConsent?: boolean;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type BookingDb = Awaited<ReturnType<typeof resolveStorefront>>["db"];

function secureClientBookingRequired() {
  return Response.json({
    intent: "secure_access_required",
    error: "For privacy, complete this booking through your secure client link. We prepared one using the contact already on file when possible.",
  }, { status: 409, headers: { "cache-control": "no-store" } });
}

function clientIdentityConstraint(error: unknown) {
  return error instanceof Error && /clients(?:_org_email_unique|\.(?:organization_id|email))/i.test(databaseErrorMessage(error));
}

function storedPhoneDigits() {
  return sql<string>`replace(replace(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')`;
}

async function prepareSecureBookingRecovery(db: BookingDb, input: {
  clientId: string;
  organizationId: string;
  organizationSlug: string;
  locationId: string;
  locationSlug: string;
  petName: string;
  serviceId: string;
  date: string;
  startsAt: string;
  origin: string;
}) {
  try {
    const [recoveryPet] = await db.select({ id: pets.id }).from(pets).where(and(
      eq(pets.organizationId, input.organizationId),
      eq(pets.clientId, input.clientId),
      eq(sql<string>`lower(${pets.name})`, input.petName.toLowerCase()),
    )).limit(1);
    const returnQuery = new URLSearchParams({ service: input.serviceId, date: input.date, startsAt: input.startsAt });
    if (recoveryPet) returnQuery.set("pet", recoveryPet.id);
    const returnTo = `/book/${encodeURIComponent(input.organizationSlug)}/${encodeURIComponent(input.locationSlug)}?${returnQuery.toString()}`;
    const recoverySession = await issuePortalEmailSession(db, input.clientId);
    await queuePortalAccessMessage(db, {
      clientId: input.clientId,
      locationId: input.locationId,
      portalUrl: portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || input.origin, recoverySession.token, returnTo),
      dedupeKey: `booking_recovery:${input.clientId}:${input.serviceId}:${input.date}:${recoveryPet?.id || "pet"}:${Math.floor(Date.now() / 600_000)}`,
    });
  } catch (recoveryError) {
    console.error("Secure returning-client recovery could not be prepared", recoveryError);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BookingPayload;
    let clientName = payload.clientName?.trim() ?? "";
    let email = payload.email?.trim().toLowerCase() ?? "";
    let phone = payload.phone?.trim() ?? "";
    let petName = payload.petName?.trim() ?? "";
    let breed = payload.breed?.trim() || "Not specified";
    const requestedPetId = payload.petId?.trim() ?? "";
    const serviceId = payload.serviceId?.trim() ?? "";
    const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;

    if (!serviceId || !startsAt || Number.isNaN(startsAt.valueOf())) return Response.json({ error: "Choose a service and appointment time." }, { status: 400 });
    if (!payload.policyAccepted) {
      return Response.json({ error: "The booking and cancellation policy must be accepted." }, { status: 400 });
    }
    const portalToken = portalCookieTokenFromRequest(request);
    const phoneProofCookie = cookieValue(request, CLIENT_PHONE_CHALLENGE_COOKIE);
    if (!portalCookieRequestIsSameOrigin(request) || (phoneProofCookie && !requestIsSameOrigin(request))) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
    const now = Date.now();
    const storefront = await resolveStorefront({ organizationSlug: payload.salonSlug, locationSlug: payload.locationSlug });
    const { db, organization, location, settings } = storefront;
    if (!settings?.allowOnlineBooking) return Response.json({ error: "Online booking is temporarily paused. Please contact the salon." }, { status: 409 });
    if (startsAt.valueOf() < now + settings.minimumLeadMinutes * 60_000 || startsAt.valueOf() > now + settings.bookingWindowDays * 86400000) {
      return Response.json({ error: `Choose a time at least ${settings.minimumLeadMinutes} minutes from now and within ${settings.bookingWindowDays} days.` }, { status: 400 });
    }
    const [selectedService] = await db.select().from(services).where(and(
      eq(services.id, serviceId),
      eq(services.organizationId, organization.id),
      eq(services.locationId, location.id),
      eq(services.active, true),
    )).limit(1);

    if (!selectedService) {
      return Response.json({ error: "That service is no longer available." }, { status: 404 });
    }
    const depositRequired = Boolean(settings.requireOnlineDeposit && selectedService.depositCents > 0);
    const [paymentAccount] = depositRequired ? await db.select().from(paymentProviderAccounts).where(and(eq(paymentProviderAccounts.organizationId, organization.id), eq(paymentProviderAccounts.chargesEnabled, true), eq(paymentProviderAccounts.payoutsEnabled, true))).limit(1) : [undefined];
    if (depositRequired && (!stripeConfig().configured || !stripeConfig().webhookSecret || !paymentAccount)) return Response.json({ error: "Secure deposits are temporarily unavailable. Please contact the salon before booking." }, { status: 503 });

    const date = dateKeyInZone(startsAt, location.timezone);
    const availability = await loadAvailability(serviceId, [date], { organizationId: organization.id, locationId: location.id });
    const slot = availability.slots.find((item) => item.startsAt === startsAt.toISOString());
    if (!slot?.staff.length || !availability.service) return Response.json({ error: "That time is no longer available. Please choose another live opening." }, { status: 409 });
    const assignedStaff = slot.staff[0]; const endsAt = new Date(slot.endsAt);

    let clientId = "";
    let petId = "";
    let authenticatedBooking = false;
    let reclaimedAbandonedProfile = false;
    let verifiedPhoneProof: { id: string; phoneE164: string } | null = null;
    if (requestedPetId) {
      if (!portalToken) return Response.json({ error: "A secure client session is required to book this pet." }, { status: 401 });
      const access = await resolvePortalSession(portalToken);
      if (!access.client || !access.session) return Response.json({ error: "A secure client session is required to book this pet." }, { status: 401 });
      if (access.client.organizationId !== organization.id) return Response.json({ error: "This pet is not available for this booking." }, { status: 404 });
      const [ownedPet] = await db.select({ id: pets.id, name: pets.name, breed: pets.breed }).from(pets).where(and(eq(pets.id, requestedPetId), eq(pets.organizationId, organization.id), eq(pets.clientId, access.client.id))).limit(1);
      if (!ownedPet) return Response.json({ error: "This pet is not available for this booking." }, { status: 404 });
      clientId = access.client.id;
      petId = ownedPet.id;
      clientName = access.client.fullName;
      email = access.client.email;
      phone = access.client.phone;
      petName = ownedPet.name;
      breed = ownedPet.breed || "Not specified";
      authenticatedBooking = true;
    } else {
      const phoneDigits = phone.replace(/\D/g, "");
      if (!clientName || !emailPattern.test(email) || phoneDigits.length < 10 || phoneDigits.length > 15 || !petName) {
        return Response.json({ error: "Please complete your name, email, phone, and pet." }, { status: 400 });
      }
      const requestedAt = new Date().toISOString();
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const recentEnough = sql<boolean>`(${portalAccessRequests.requestedAt})::timestamp >= (${cutoff})::timestamp`;
      const [emailHash, sourceHash] = await Promise.all([
        sha256Hex(`public-booking:${organization.id}:email:${email}`),
        sha256Hex(`public-booking:${organization.id}:source:${requestSource(request)}`),
      ]);
      const [recentEmail, recentSource] = await Promise.all([
        db.select({ id: portalAccessRequests.id }).from(portalAccessRequests).where(and(eq(portalAccessRequests.organizationId, organization.id), eq(portalAccessRequests.emailHash, emailHash), recentEnough)).limit(6),
        db.select({ id: portalAccessRequests.id }).from(portalAccessRequests).where(and(eq(portalAccessRequests.organizationId, organization.id), eq(portalAccessRequests.sourceHash, sourceHash), recentEnough)).limit(20),
      ]);
      if (recentEmail.length >= 6 || recentSource.length >= 20) return secureClientBookingRequired();
      await db.insert(portalAccessRequests).values({ id: crypto.randomUUID(), organizationId: organization.id, emailHash, sourceHash, requestedAt });
      const normalizedPhone = normalizeClientPhone(phone);
      const comparablePhoneDigits = normalizedPhone ? normalizedPhone.slice(-10) : phoneDigits;
      const phoneConflict = normalizedPhone
        ? eq(sql<string>`right(${storedPhoneDigits()}, 10)`, comparablePhoneDigits)
        : eq(storedPhoneDigits(), comparablePhoneDigits);
      const [contactConflict] = await db.select({ id: clients.id, email: clients.email, phone: clients.phone }).from(clients).where(and(
        eq(clients.organizationId, organization.id),
        or(eq(sql<string>`lower(${clients.email})`, email), phoneConflict),
      )).limit(1);
      if (contactConflict) {
        const storedContactDigits = contactConflict.phone.replace(/\D/g, "").slice(-10);
        const bothContactsMatch = contactConflict.email.trim().toLowerCase() === email && storedContactDigits === comparablePhoneDigits.slice(-10);
        const [matchingPets, priorHistoryRows] = bothContactsMatch ? await Promise.all([
          db.select({ id: pets.id }).from(pets).where(and(
            eq(pets.organizationId, organization.id),
            eq(pets.clientId, contactConflict.id),
            eq(sql<string>`lower(${pets.name})`, petName.toLowerCase()),
          )).limit(1),
          db.select({
            total: sql<number>`count(*)`,
            otherHistory: sql<number>`coalesce(sum(case when ${appointments.status} <> 'cancelled' or ${appointments.depositStatus} <> 'failed' then 1 else 0 end), 0)`,
          }).from(appointments).where(and(
            eq(appointments.organizationId, organization.id),
            eq(appointments.clientId, contactConflict.id),
          )),
        ]) : [[], []] as const;
        const priorHistory = priorHistoryRows[0];
        const onlyFailedDepositAttempts = Number(priorHistory?.total || 0) > 0 && Number(priorHistory?.otherHistory || 0) === 0;
        if (matchingPets[0] && onlyFailedDepositAttempts) {
          clientId = contactConflict.id;
          petId = matchingPets[0].id;
          reclaimedAbandonedProfile = true;
        } else {
          await prepareSecureBookingRecovery(db, {
            clientId: contactConflict.id,
            organizationId: organization.id,
            organizationSlug: organization.slug,
            locationId: location.id,
            locationSlug: location.slug,
            petName,
            serviceId,
            date,
            startsAt: slot.startsAt,
            origin: new URL(request.url).origin,
          });
          return secureClientBookingRequired();
        }
      }
      const proof = await readVerifiedPhoneProof(request, db, organization.id);
      if (proof && normalizedPhone === proof.phoneE164) {
        phone = proof.phoneE164;
        verifiedPhoneProof = proof;
      }
      if (!reclaimedAbandonedProfile) {
        clientId = crypto.randomUUID();
        petId = crypto.randomUUID();
      }
    }

    const appointmentId = crypto.randomUUID();
    const paymentExpiresAt = depositRequired ? new Date(Date.now() + settings.depositHoldMinutes * 60_000).toISOString() : null;
    // Keep a short local grace window so a successful payment is never released merely because its webhook arrived seconds late.
    const depositDueAt = paymentExpiresAt ? new Date(new Date(paymentExpiresAt).getTime() + 10 * 60_000).toISOString() : null;
    const reservationRows = await buildReservationRows(db, { appointmentId, organizationId: organization.id, locationId: location.id, staffId: assignedStaff.id, startsAt: slot.startsAt, endsAt: slot.endsAt, service: availability.service, capacity: availability.capacity, existingAppointments: availability.appointmentRows });
    if (!reservationRows) return Response.json({ error: "That time was just reserved. Please choose another live opening." }, { status: 409 });
    const appointmentInsert = db.insert(appointments).values({
      id: appointmentId,
      organizationId: organization.id,
      locationId: location.id,
      clientId,
      petId,
      serviceId,
      staffId: assignedStaff.id,
      status: depositRequired || settings.bookingMode === "request" ? "requested" : "confirmed",
      startsAt: slot.startsAt,
      endsAt: endsAt.toISOString(),
      priceEstimateCents: selectedService.priceFromCents,
      depositCents: selectedService.depositCents,
      depositStatus: depositRequired ? "pending" : "not_required",
      depositDueAt,
      currency: location.currency,
      clientNotes: payload.clientNotes?.trim() ?? "",
    }).returning();
    const consentInsert = db.insert(consentRecords).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      clientId,
      appointmentId,
      type: "booking_and_cancellation_policy",
      policyVersion: "2026-07-v1",
      accepted: true,
      source: "online_booking",
    });
    const auditInsert = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      actorType: "client",
      actorId: clientId,
      action: "appointment.created",
      entityType: "appointment",
      entityId: appointmentId,
      detailsJson: JSON.stringify({ serviceId, startsAt: slot.startsAt, staffId: assignedStaff.id, source: "online_booking", storefront: organization.slug, depositRequired, depositDueAt, identity: authenticatedBooking ? "portal_session" : reclaimedAbandonedProfile ? "reclaimed_failed_deposit_profile" : "new_public_client", phoneVerified: Boolean(verifiedPhoneProof) }),
    });
    const invoiceId = depositRequired ? crypto.randomUUID() : "";
    const invoiceTotals = depositRequired ? calculateInvoice({ subtotalCents: selectedService.priceFromCents, discountCents: 0, taxRateBps: location.taxRateBps, tipCents: 0 }) : null;
    const invoiceInsert = depositRequired && invoiceTotals ? db.insert(invoices).values({ id: invoiceId, organizationId: organization.id, locationId: location.id, appointmentId, invoiceNumber: `CC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${invoiceId.slice(0, 6).toUpperCase()}`, subtotalCents: selectedService.priceFromCents, taxLabel: location.taxLabel, taxRateBps: location.taxRateBps, taxCents: invoiceTotals.taxCents, totalCents: invoiceTotals.totalCents, currency: location.currency }) : null;
    const lineInsert = depositRequired ? db.insert(invoiceLineItems).values({ id: crypto.randomUUID(), organizationId: organization.id, invoiceId, kind: "service", description: `${selectedService.name} · ${petName}`, quantity: 1, unitPriceCents: selectedService.priceFromCents, totalCents: selectedService.priceFromCents }) : null;
    let appointment;
    try {
      if (authenticatedBooking || reclaimedAbandonedProfile) {
        const [created] = depositRequired && invoiceInsert && lineInsert
          ? await db.batch([appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert, invoiceInsert, lineInsert])
          : await db.batch([appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert]);
        appointment = created[0];
      } else {
        const clientInsert = db.insert(clients).values({ id: clientId, organizationId: organization.id, fullName: clientName, email, phone, marketingConsent: Boolean(payload.marketingConsent) });
        const petInsert = db.insert(pets).values({ id: petId, organizationId: organization.id, clientId, name: petName, breed });
        if (verifiedPhoneProof) {
          const committedAt = new Date().toISOString();
          const phoneIdentityInsert = db.insert(clientPhoneIdentities).values({
            id: crypto.randomUUID(),
            organizationId: organization.id,
            clientId,
            phoneE164: verifiedPhoneProof.phoneE164,
            verifiedAt: sql<string>`(select ${committedAt}::text from ${clientPhoneOtpChallenges} where ${clientPhoneOtpChallenges.id} = ${verifiedPhoneProof.id} and ${clientPhoneOtpChallenges.organizationId} = ${organization.id} and ${clientPhoneOtpChallenges.phoneE164} = ${verifiedPhoneProof.phoneE164} and ${clientPhoneOtpChallenges.verifiedAt} is not null and ${clientPhoneOtpChallenges.proofExpiresAt} > ${committedAt} and ${clientPhoneOtpChallenges.proofConsumedAt} is null limit 1)`,
            lastUsedAt: committedAt,
            createdAt: committedAt,
            updatedAt: committedAt,
          });
          const phoneProofClaim = db.update(clientPhoneOtpChallenges).set({ proofConsumedAt: committedAt }).where(and(
            eq(clientPhoneOtpChallenges.id, verifiedPhoneProof.id),
            eq(clientPhoneOtpChallenges.organizationId, organization.id),
            eq(clientPhoneOtpChallenges.phoneE164, verifiedPhoneProof.phoneE164),
            isNotNull(clientPhoneOtpChallenges.verifiedAt),
            gt(clientPhoneOtpChallenges.proofExpiresAt, committedAt),
            isNull(clientPhoneOtpChallenges.proofConsumedAt),
          ));
          const committed = depositRequired && invoiceInsert && lineInsert
            ? await db.batch([clientInsert, petInsert, phoneIdentityInsert, phoneProofClaim, appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert, invoiceInsert, lineInsert])
            : await db.batch([clientInsert, petInsert, phoneIdentityInsert, phoneProofClaim, appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert]);
          appointment = committed[4][0];
        } else {
          const [, , created] = depositRequired && invoiceInsert && lineInsert
            ? await db.batch([clientInsert, petInsert, appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert, invoiceInsert, lineInsert])
            : await db.batch([clientInsert, petInsert, appointmentInsert, ...reservationInsertStatements(db, reservationRows), consentInsert, auditInsert]);
          appointment = created[0];
        }
      }
    } catch (error) {
      if (clientIdentityConstraint(error)) {
        const [raceConflict] = await db.select({ id: clients.id }).from(clients).where(and(
          eq(clients.organizationId, organization.id),
          eq(sql<string>`lower(${clients.email})`, email),
        )).limit(1);
        if (raceConflict) await prepareSecureBookingRecovery(db, {
          clientId: raceConflict.id, organizationId: organization.id, organizationSlug: organization.slug,
          locationId: location.id, locationSlug: location.slug, petName, serviceId, date,
          startsAt: slot.startsAt, origin: new URL(request.url).origin,
        });
        return secureClientBookingRequired();
      }
      if (verifiedPhoneProof && error instanceof Error && /unique|constraint|null/i.test(databaseErrorMessage(error))) {
        const [raceIdentity] = await db.select({ clientId: clientPhoneIdentities.clientId }).from(clientPhoneIdentities).where(and(
          eq(clientPhoneIdentities.organizationId, organization.id),
          eq(clientPhoneIdentities.phoneE164, verifiedPhoneProof.phoneE164),
          isNull(clientPhoneIdentities.revokedAt),
        )).limit(1);
        if (raceIdentity?.clientId) await prepareSecureBookingRecovery(db, {
          clientId: raceIdentity.clientId, organizationId: organization.id, organizationSlug: organization.slug,
          locationId: location.id, locationSlug: location.slug, petName, serviceId, date,
          startsAt: slot.startsAt, origin: new URL(request.url).origin,
        });
        return secureClientBookingRequired();
      }
      if (error instanceof Error && /unique|constraint/i.test(databaseErrorMessage(error))) return Response.json({ error: "That time was just reserved. Please choose another live opening." }, { status: 409 });
      throw error;
    }

    let trustedPortalCookie = "";
    if (verifiedPhoneProof) {
      try {
        const trustedSession = await issuePortalSession(db, clientId, 30);
        trustedPortalCookie = portalCookie(trustedSession.token);
      } catch (sessionError) {
        console.error("Booking saved, but the trusted client session could not be issued", sessionError);
      }
    }
    let checkoutUrl = "", paymentPageUrl = "", recoveryPortalCookie = "";
    if (depositRequired && paymentAccount && depositDueAt && paymentExpiresAt) {
      const paymentSessionId = crypto.randomUUID(); const applicationFeeCents = Math.min(selectedService.depositCents - 1, Math.round(selectedService.depositCents * stripeConfig().applicationFeeBps / 10_000)); const origin = new URL(request.url).origin; let providerSessionId = "";
      paymentPageUrl = `${origin}/booking/payment/${paymentSessionId}`;
      try {
        const session = await stripeRequest<{ id: string; url?: string; expires_at?: number }>("checkout/sessions", {
          mode: "payment", "payment_method_types[0]": "card", "line_items[0][price_data][currency]": location.currency.toLowerCase(), "line_items[0][price_data][product_data][name]": `Booking deposit · ${petName} · ${selectedService.name}`, "line_items[0][price_data][unit_amount]": selectedService.depositCents, "line_items[0][quantity]": 1,
          ...(applicationFeeCents > 0 ? { "payment_intent_data[application_fee_amount]": applicationFeeCents } : {}), customer_email: email,
          success_url: `${paymentPageUrl}?result=success`, cancel_url: `${paymentPageUrl}?result=cancelled`, expires_at: Math.floor(new Date(paymentExpiresAt).getTime() / 1000),
          "metadata[organization_id]": organization.id, "metadata[location_id]": location.id, "metadata[appointment_id]": appointmentId, "metadata[invoice_id]": invoiceId, "metadata[purpose]": "deposit", "metadata[required_booking_deposit]": "true",
        }, { account: paymentAccount.connectedAccountId, idempotencyKey: `booking-deposit:${appointmentId}` });
        providerSessionId = session.id; if (!session.url) throw new Error("Stripe did not return a secure checkout URL."); checkoutUrl = session.url;
        await db.insert(onlinePaymentSessions).values({ id: paymentSessionId, organizationId: organization.id, locationId: location.id, clientId, appointmentId, invoiceId, purpose: "deposit", providerSessionId: session.id, amountCents: selectedService.depositCents, applicationFeeCents, currency: location.currency, checkoutUrl, idempotencyKey: `booking:${appointmentId}`, expiresAt: new Date((session.expires_at || Math.floor(new Date(paymentExpiresAt).getTime() / 1000)) * 1000).toISOString() });
      } catch (paymentError) {
        if (providerSessionId) await stripeRequest(`checkout/sessions/${providerSessionId}/expire`, {}, { account: paymentAccount.connectedAccountId }).catch(() => undefined);
        await db.batch([db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, appointmentId)), db.update(appointments).set({ status: "cancelled", depositStatus: "failed", updatedAt: new Date().toISOString() }).where(eq(appointments.id, appointmentId)), db.update(invoices).set({ status: "void", updatedAt: new Date().toISOString() }).where(eq(invoices.id, invoiceId))]);
        let recoveryCookie = trustedPortalCookie;
        if (!authenticatedBooking && !reclaimedAbandonedProfile && !recoveryCookie) {
          try {
            const recoverySession = await issuePortalSession(db, clientId, 15 / (24 * 60));
            recoveryCookie = portalCookie(recoverySession.token, 15 * 60);
          } catch (recoveryError) {
            console.error("Deposit checkout failed and a short retry session could not be issued", recoveryError);
          }
        }
        const recoveryHeaders = new Headers({ "cache-control": "no-store" });
        if (recoveryCookie) recoveryHeaders.append("set-cookie", recoveryCookie);
        if (verifiedPhoneProof) recoveryHeaders.append("set-cookie", challengeCookie("", 0));
        console.error("Booking deposit checkout failed", paymentError);
        return Response.json({
          error: "We couldn’t open secure deposit checkout, so the time was released. Your details are saved—choose another opening and try again.",
          recoveryAvailable: !authenticatedBooking && Boolean(recoveryCookie),
        }, { status: 503, headers: recoveryHeaders });
      }
      await queueClientTemplateMessage(db, { clientId, locationId: location.id, templateKey: "booking_deposit_required", dedupeKey: `booking_deposit_required:${appointmentId}`, variables: { pet_name: petName, service_name: selectedService.name, checkout_url: checkoutUrl, deposit_amount: new Intl.NumberFormat(location.currency === "USD" ? "en-US" : "en-CA", { style: "currency", currency: location.currency }).format(selectedService.depositCents / 100), hold_minutes: String(settings.depositHoldMinutes) } }).catch((communicationError) => console.error("Deposit hold saved, but its recovery email could not be queued", communicationError));
      if (!authenticatedBooking && !reclaimedAbandonedProfile && !trustedPortalCookie) {
        try {
          const recoveryMinutes = Math.min(120, Math.max(60, settings.depositHoldMinutes + 30));
          const recoverySession = await issuePortalSession(db, clientId, recoveryMinutes / (24 * 60));
          recoveryPortalCookie = portalCookie(recoverySession.token, recoveryMinutes * 60);
        } catch (sessionError) {
          console.error("Deposit hold saved, but short-lived browser recovery could not be issued", sessionError);
        }
      }
    } else {
      try {
        const portalSession = await issuePortalEmailSession(db, clientId);
        const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portalSession.token);
        await queueBookingCommunications(db, appointmentId, appointment.startsAt, appointment.status, { portal_url: portalUrl });
      } catch (communicationError) {
        console.error("Booking saved, but its private link or communications could not be prepared", communicationError);
      }
    }

    const responseHeaders = new Headers({ "cache-control": "no-store" });
    if (trustedPortalCookie) {
      responseHeaders.append("set-cookie", trustedPortalCookie);
      responseHeaders.append("set-cookie", challengeCookie("", 0));
    } else if (recoveryPortalCookie) {
      responseHeaders.append("set-cookie", recoveryPortalCookie);
    }
    return Response.json({
      appointment: {
        id: appointment.id,
        status: appointment.status,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        serviceName: selectedService.name,
        petName,
        depositCents: appointment.depositCents,
        currency: appointment.currency,
        depositStatus: appointment.depositStatus,
        depositDueAt: appointment.depositDueAt,
      },
      checkoutUrl: checkoutUrl || undefined,
      paymentPageUrl: paymentPageUrl || undefined,
      trustedSession: Boolean(trustedPortalCookie),
      recoverySession: Boolean(recoveryPortalCookie),
    }, { status: 201, headers: responseHeaders });
  } catch (error) {
    return storefrontError(error, "Booking could not be created.");
  }
}
