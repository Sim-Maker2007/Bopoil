import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { readVerifiedPhoneProof } from "../../../db/client-phone-auth";
import { issuePortalSession, resolvePortalSession } from "../../../db/client-portal";
import { queueClientTemplateMessage } from "../../../db/communications";
import {
  auditEvents,
  clientPhoneIdentities,
  clientPhoneOtpChallenges,
  clients,
  consentRecords,
  pets,
  portalAccessRequests,
  services,
  waitlistEntries,
} from "../../../db/schema";
import {
  challengeCookie,
  normalizeClientPhone,
  portalCookie,
  requestSource,
} from "../../../lib/client-phone-auth";
import {
  portalCookieTokenFromRequest,
  requestIsSameOrigin,
} from "../../../lib/portal-request";
import { dateKeyInZone, isValidDateKey } from "../../../lib/time-zone";
import { addCalendarDays, validWaitlistWindow } from "../../../lib/waitlist";
import { resolveStorefront, storefrontError } from "../../../db/public-storefront";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max = 120) { return String(value || "").trim().slice(0, max); }
async function hash(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join(""); }
function displayDate(day: string) { return new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
function storedPhoneDigits() {
  return sql<string>`replace(replace(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')`;
}
function secureClientWaitlistRequired() {
  return Response.json({
    error: "For privacy, join this waitlist through your secure client link. Use Manage booking to request a fresh link.",
  }, { status: 409, headers: { "cache-control": "no-store" } });
}
function clientIdentityConstraint(error: unknown) {
  return error instanceof Error && /clients(?:_org_email_unique|\.(?:organization_id|email))/i.test(error.message);
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) {
      return Response.json({ error: "Request origin could not be verified." }, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }
    const body = await request.json() as Record<string, unknown>;
    let clientName = clean(body.clientName, 100), email = clean(body.email, 160).toLowerCase(), phone = clean(body.phone, 40);
    let petName = clean(body.petName, 60), breed = clean(body.breed, 80) || "Not specified";
    const requestedPetId = clean(body.petId, 80), serviceId = clean(body.serviceId, 80);
    const preferredFrom = clean(body.preferredFrom, 10), preferredTo = clean(body.preferredTo, 10), timePreference = clean(body.timePreference, 12) || "anytime";
    const clientNotes = clean(body.clientNotes, 400);
    if (!serviceId || !isValidDateKey(preferredFrom) || !isValidDateKey(preferredTo)) return Response.json({ error: "Complete your service and preferred dates." }, { status: 400 });
    if (!["anytime", "morning", "afternoon"].includes(timePreference)) return Response.json({ error: "Choose a valid time preference." }, { status: 400 });
    if (body.contactConsent !== true) return Response.json({ error: "Please allow the salon to contact you about an opening." }, { status: 400 });

    const storefront = await resolveStorefront({ organizationSlug: body.salonSlug, locationSlug: body.locationSlug });
    const { db, organization, location, settings } = storefront;
    const [service] = await db.select().from(services).where(and(eq(services.id, serviceId), eq(services.organizationId, organization.id), eq(services.locationId, location.id), eq(services.active, true))).limit(1);
    if (!service) return Response.json({ error: "That service is no longer available." }, { status: 404 });
    const today = dateKeyInZone(new Date(), location.timezone), lastBookable = addCalendarDays(today, settings.bookingWindowDays);
    if (!validWaitlistWindow(preferredFrom, preferredTo, today, lastBookable)) return Response.json({ error: "Choose a date range of up to 14 days inside the salon’s booking window." }, { status: 400 });

    let clientId = "";
    let petId = "";
    let authenticatedWaitlist = false;
    let verifiedPhoneProof: { id: string; phoneE164: string } | null = null;
    if (requestedPetId) {
      const token = portalCookieTokenFromRequest(request);
      if (!token) return Response.json({ error: "A secure client session is required to join for this pet." }, { status: 401 });
      const access = await resolvePortalSession(token);
      if (!access.client || !access.session) return Response.json({ error: "A secure client session is required to join for this pet." }, { status: 401 });
      if (access.client.organizationId !== organization.id) return Response.json({ error: "This pet is not available for this waitlist." }, { status: 404 });
      const [ownedPet] = await db.select({
        id: pets.id,
        name: pets.name,
        breed: pets.breed,
      }).from(pets).where(and(
        eq(pets.id, requestedPetId),
        eq(pets.organizationId, organization.id),
        eq(pets.clientId, access.client.id),
      )).limit(1);
      if (!ownedPet) return Response.json({ error: "This pet is not available for this waitlist." }, { status: 404 });
      clientId = access.client.id;
      petId = ownedPet.id;
      clientName = access.client.fullName;
      email = access.client.email;
      phone = access.client.phone;
      petName = ownedPet.name;
      breed = ownedPet.breed || "Not specified";
      authenticatedWaitlist = true;
    } else {
      const phoneDigits = phone.replace(/\D/g, "");
      if (!clientName || !emailPattern.test(email) || phoneDigits.length < 10 || phoneDigits.length > 15 || !petName) {
        return Response.json({ error: "Complete your contact and pet details." }, { status: 400 });
      }
      clientId = crypto.randomUUID();
      petId = crypto.randomUUID();
    }

    const sourceHash = await hash(`public-waitlist:${organization.id}:source:${requestSource(request)}`);
    const emailHash = await hash(`public-waitlist:${organization.id}:email:${email}`);
    const attemptedAt = new Date().toISOString();
    const recent = new Date(Date.now() - 60 * 60_000).toISOString();
    const attempts = await db.select({ id: portalAccessRequests.id }).from(portalAccessRequests).where(and(
      eq(portalAccessRequests.organizationId, organization.id),
      eq(portalAccessRequests.sourceHash, sourceHash),
      sql`datetime(${portalAccessRequests.requestedAt}) >= datetime(${recent})`,
    )).limit(10);
    if (attempts.length >= 10) return Response.json({ error: "Too many waitlist requests were sent recently. Please try again later." }, { status: 429 });
    await db.insert(portalAccessRequests).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      emailHash,
      sourceHash,
      requestedAt: attemptedAt,
    });

    if (!authenticatedWaitlist) {
      const normalizedPhone = normalizeClientPhone(phone);
      const phoneDigits = phone.replace(/\D/g, "");
      const comparablePhoneDigits = normalizedPhone ? normalizedPhone.slice(-10) : phoneDigits;
      const phoneConflict = normalizedPhone
        ? eq(sql<string>`substr(${storedPhoneDigits()}, -10)`, comparablePhoneDigits)
        : eq(storedPhoneDigits(), comparablePhoneDigits);
      const [contactConflict] = await db.select({ id: clients.id }).from(clients).where(and(
        eq(clients.organizationId, organization.id),
        or(eq(sql<string>`lower(${clients.email})`, email), phoneConflict),
      )).limit(1);
      if (contactConflict) return secureClientWaitlistRequired();
      const proof = await readVerifiedPhoneProof(request, db, organization.id);
      if (proof && normalizedPhone === proof.phoneE164) {
        phone = proof.phoneE164;
        verifiedPhoneProof = proof;
      }
    }

    const now = new Date().toISOString();
    const [existing] = authenticatedWaitlist
      ? await db.select().from(waitlistEntries).where(and(
        eq(waitlistEntries.organizationId, organization.id),
        eq(waitlistEntries.locationId, location.id),
        eq(waitlistEntries.clientId, clientId),
        eq(waitlistEntries.petId, petId),
        eq(waitlistEntries.serviceId, serviceId),
        inArray(waitlistEntries.status, ["waiting", "contacted"]),
      )).limit(1)
      : [undefined];
    let entryId = existing?.id || crypto.randomUUID();
    let updatedExisting = Boolean(existing);
    const updateEntry = (id: string) => db.update(waitlistEntries).set({
      preferredFrom,
      preferredTo,
      timePreference: timePreference as "anytime" | "morning" | "afternoon",
      clientNotes,
      status: "waiting" as const,
      sourceHash,
      contactedAt: null,
      updatedAt: now,
    }).where(and(
      eq(waitlistEntries.id, id),
      eq(waitlistEntries.organizationId, organization.id),
      eq(waitlistEntries.locationId, location.id),
      eq(waitlistEntries.clientId, clientId),
      eq(waitlistEntries.petId, petId),
    ));
    const consentInsert = () => db.insert(consentRecords).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      clientId,
      type: "waitlist_availability_contact",
      policyVersion: "2026-07-v1",
      accepted: true,
      source: "online_waitlist",
    });
    const auditInsert = (action: "waitlist.joined" | "waitlist.updated", id: string) => db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      actorType: "client",
      actorId: clientId,
      action,
      entityType: "waitlist_entry",
      entityId: id,
      detailsJson: JSON.stringify({
        serviceId,
        preferredFrom,
        preferredTo,
        timePreference,
        storefront: organization.slug,
        identity: authenticatedWaitlist ? "portal_session" : "new_public_client",
        phoneVerified: Boolean(verifiedPhoneProof),
      }),
    });
    if (existing) {
      await db.batch([
        updateEntry(existing.id),
        consentInsert(),
        auditInsert("waitlist.updated", existing.id),
      ]);
    } else {
      try {
        const waitlistInsert = db.insert(waitlistEntries).values({
          id: entryId,
          organizationId: organization.id,
          locationId: location.id,
          clientId,
          petId,
          serviceId,
          preferredFrom,
          preferredTo,
          timePreference: timePreference as "anytime" | "morning" | "afternoon",
          clientNotes,
          sourceHash,
        });
        if (authenticatedWaitlist) {
          await db.batch([
            waitlistInsert,
            consentInsert(),
            auditInsert("waitlist.joined", entryId),
          ]);
        } else {
          const clientInsert = db.insert(clients).values({
            id: clientId,
            organizationId: organization.id,
            fullName: clientName,
            email,
            phone,
          });
          const petInsert = db.insert(pets).values({
            id: petId,
            organizationId: organization.id,
            clientId,
            name: petName,
            breed,
          });
          if (verifiedPhoneProof) {
            const phoneIdentityInsert = db.insert(clientPhoneIdentities).values({
              id: crypto.randomUUID(),
              organizationId: organization.id,
              clientId,
              phoneE164: verifiedPhoneProof.phoneE164,
              verifiedAt: sql<string>`(select ${now} from ${clientPhoneOtpChallenges} where ${clientPhoneOtpChallenges.id} = ${verifiedPhoneProof.id} and ${clientPhoneOtpChallenges.organizationId} = ${organization.id} and ${clientPhoneOtpChallenges.phoneE164} = ${verifiedPhoneProof.phoneE164} and ${clientPhoneOtpChallenges.verifiedAt} is not null and ${clientPhoneOtpChallenges.proofExpiresAt} > ${now} and ${clientPhoneOtpChallenges.proofConsumedAt} is null limit 1)`,
              lastUsedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            const phoneProofClaim = db.update(clientPhoneOtpChallenges).set({
              proofConsumedAt: now,
            }).where(and(
              eq(clientPhoneOtpChallenges.id, verifiedPhoneProof.id),
              eq(clientPhoneOtpChallenges.organizationId, organization.id),
              eq(clientPhoneOtpChallenges.phoneE164, verifiedPhoneProof.phoneE164),
              isNotNull(clientPhoneOtpChallenges.verifiedAt),
              gt(clientPhoneOtpChallenges.proofExpiresAt, now),
              isNull(clientPhoneOtpChallenges.proofConsumedAt),
            ));
            await db.batch([
              clientInsert,
              petInsert,
              phoneIdentityInsert,
              phoneProofClaim,
              waitlistInsert,
              consentInsert(),
              auditInsert("waitlist.joined", entryId),
            ]);
          } else {
            await db.batch([
              clientInsert,
              petInsert,
              waitlistInsert,
              consentInsert(),
              auditInsert("waitlist.joined", entryId),
            ]);
          }
        }
      } catch (error) {
        if (clientIdentityConstraint(error)) return secureClientWaitlistRequired();
        if (verifiedPhoneProof && error instanceof Error && /unique|constraint|null/i.test(error.message)) return secureClientWaitlistRequired();
        if (!authenticatedWaitlist || !(error instanceof Error) || !/unique|constraint/i.test(error.message)) throw error;
        const [concurrent] = await db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(and(
          eq(waitlistEntries.organizationId, organization.id),
          eq(waitlistEntries.locationId, location.id),
          eq(waitlistEntries.clientId, clientId),
          eq(waitlistEntries.petId, petId),
          eq(waitlistEntries.serviceId, serviceId),
          inArray(waitlistEntries.status, ["waiting", "contacted"]),
        )).limit(1);
        if (!concurrent) throw error;
        entryId = concurrent.id;
        updatedExisting = true;
        await db.batch([
          updateEntry(concurrent.id),
          consentInsert(),
          auditInsert("waitlist.updated", concurrent.id),
        ]);
      }
    }

    let trustedPortalCookie = "";
    if (verifiedPhoneProof) {
      try {
        const trustedSession = await issuePortalSession(db, clientId, 30);
        trustedPortalCookie = portalCookie(trustedSession.token);
      } catch (error) {
        console.error("Waitlist saved, but the trusted client session could not be issued", error);
      }
    }
    await queueClientTemplateMessage(db, { clientId, locationId: location.id, templateKey: "waitlist_joined", dedupeKey: `waitlist_joined:${entryId}:${preferredFrom}`, variables: { pet_name: petName, service_name: service.name, preferred_from: displayDate(preferredFrom), preferred_to: displayDate(preferredTo) } }).catch((error) => console.error("Waitlist saved, but confirmation could not be queued", error));
    const responseHeaders = new Headers({ "cache-control": "no-store" });
    if (trustedPortalCookie) responseHeaders.append("set-cookie", trustedPortalCookie);
    if (verifiedPhoneProof) responseHeaders.append("set-cookie", challengeCookie("", 0));
    return Response.json({
      waitlist: { id: entryId, status: "waiting", preferredFrom, preferredTo },
      trustedSession: Boolean(trustedPortalCookie),
      message: `${petName} is on the priority list. We’ll contact you when a safe opening matches.`,
    }, { status: updatedExisting ? 200 : 201, headers: responseHeaders });
  } catch (error) { return storefrontError(error, "The waitlist request could not be saved."); }
}
