import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { buildReservationRows, loadAvailability, reservationInsertStatements } from "../../../../db/availability";
import { issuePortalEmailSession } from "../../../../db/client-portal";
import { queueBookingCommunications } from "../../../../db/communications";
import { appointments, auditEvents, clients, pets, services, waitlistConversionClaims, waitlistEntries } from "../../../../db/schema";
import { dateKeyInZone } from "../../../../lib/time-zone";
import { portalAccessUrl } from "../../../../lib/portal-links";
import { matchesWaitlistTime, waitlistDates } from "../../../../lib/waitlist";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

function clean(value: unknown, max = 200) { return String(value || "").trim().slice(0, max); }
function requireWaitlistAccess(role: string) { if (!["owner", "manager", "receptionist"].includes(role)) throw new SalonAccessError("Waitlist access requires owner, manager, or receptionist access.", 403); }

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "calendar"); requireWaitlistAccess(membership.role);
    const entries = await db.select({ id: waitlistEntries.id, clientId: waitlistEntries.clientId, petId: waitlistEntries.petId, serviceId: waitlistEntries.serviceId, preferredFrom: waitlistEntries.preferredFrom, preferredTo: waitlistEntries.preferredTo, timePreference: waitlistEntries.timePreference, status: waitlistEntries.status, clientNotes: waitlistEntries.clientNotes, staffNotes: waitlistEntries.staffNotes, contactedAt: waitlistEntries.contactedAt, createdAt: waitlistEntries.createdAt, updatedAt: waitlistEntries.updatedAt, clientName: clients.fullName, email: clients.email, phone: clients.phone, petName: pets.name, breed: pets.breed, serviceName: services.name, priceFromCents: services.priceFromCents })
      .from(waitlistEntries).innerJoin(clients, eq(waitlistEntries.clientId, clients.id)).innerJoin(pets, eq(waitlistEntries.petId, pets.id)).innerJoin(services, eq(waitlistEntries.serviceId, services.id))
      .where(and(eq(waitlistEntries.organizationId, membership.organizationId), eq(waitlistEntries.locationId, membership.locationId), inArray(waitlistEntries.status, ["waiting", "contacted"]))).orderBy(asc(waitlistEntries.createdAt)).limit(60);
    const todayProbe = entries[0] ? await loadAvailability(entries[0].serviceId, [new Date().toISOString().slice(0, 10)], { organizationId: membership.organizationId, locationId: membership.locationId }) : null;
    const timezone = todayProbe?.location?.timezone || "America/Toronto"; const today = dateKeyInZone(new Date(), timezone);
    const grouped = new Map<string, Promise<Awaited<ReturnType<typeof loadAvailability>>>>();
    for (const entry of entries) {
      const from = entry.preferredFrom < today ? today : entry.preferredFrom; if (from > entry.preferredTo) continue;
      const key = `${entry.serviceId}:${from}:${entry.preferredTo}`;
      if (!grouped.has(key)) grouped.set(key, loadAvailability(entry.serviceId, waitlistDates(from, entry.preferredTo), { organizationId: membership.organizationId, locationId: membership.locationId }));
    }
    const rows = await Promise.all(entries.map(async (entry) => {
      const from = entry.preferredFrom < today ? today : entry.preferredFrom; const key = `${entry.serviceId}:${from}:${entry.preferredTo}`; const availability = grouped.get(key) ? await grouped.get(key)! : null;
      const matches = (availability?.slots || []).filter((slot) => matchesWaitlistTime(slot.startsAt, entry.timePreference, timezone)).slice(0, 3).map((slot) => ({ startsAt: slot.startsAt, endsAt: slot.endsAt, timeLabel: slot.timeLabel, date: slot.date, staffName: slot.staff[0]?.name || "First available" }));
      return { ...entry, matches };
    }));
    return Response.json({
      entries: rows,
      summary: {
        waiting: rows.filter((item) => item.status === "waiting").length,
        contacted: rows.filter((item) => item.status === "contacted").length,
        matched: rows.filter((item) => item.matches.length > 0).length,
      },
      timezone,
      refreshedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return salonApiError(error, "Waitlist unavailable"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "calendar"); requireWaitlistAccess(membership.role);
    const body = await request.json() as Record<string, unknown>; const action = clean(body.action, 20), waitlistId = clean(body.waitlistId, 80), staffNotes = clean(body.staffNotes, 500);
    const [entry] = await db.select().from(waitlistEntries).where(and(eq(waitlistEntries.id, waitlistId), eq(waitlistEntries.organizationId, membership.organizationId), eq(waitlistEntries.locationId, membership.locationId))).limit(1);
    if (!entry) throw new SalonAccessError("Waitlist request not found.", 404);
    const now = new Date().toISOString();
    if (["contacted", "closed", "restore"].includes(action)) {
      const allowed = (action === "contacted" && entry.status === "waiting") || (action === "restore" && entry.status === "contacted") || (action === "closed" && ["waiting", "contacted"].includes(entry.status));
      if (!allowed) throw new SalonAccessError("This request has already moved to another state.", 409);
      const status = action === "restore" ? "waiting" : action as "contacted" | "closed";
      const [updated] = await db.update(waitlistEntries).set({ status, staffNotes, contactedAt: status === "contacted" ? now : entry.contactedAt, updatedAt: now }).where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.updatedAt, entry.updatedAt))).returning();
      if (!updated) throw new SalonAccessError("This request changed. Refresh and try again.", 409);
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: `waitlist.${status}`, entityType: "waitlist_entry", entityId: entry.id, detailsJson: JSON.stringify({ staffNotes }) });
      return Response.json({ entry: updated });
    }
    if (action !== "book") throw new SalonAccessError("Unknown waitlist action.", 400);
    if (!["waiting", "contacted"].includes(entry.status)) throw new SalonAccessError("This request is already closed.", 409);
    const startsAt = new Date(clean(body.startsAt, 40)); if (Number.isNaN(startsAt.valueOf())) throw new SalonAccessError("Choose a valid live opening.", 400);
    const probe = await loadAvailability(entry.serviceId, [entry.preferredFrom], { organizationId: membership.organizationId, locationId: membership.locationId });
    const availability = await loadAvailability(entry.serviceId, [dateKeyInZone(startsAt, probe.location.timezone)], { organizationId: membership.organizationId, locationId: membership.locationId });
    const slot = availability.slots.find((item) => item.startsAt === startsAt.toISOString());
    if (!slot?.staff.length || !availability.service || slot.date < entry.preferredFrom || slot.date > entry.preferredTo || !matchesWaitlistTime(slot.startsAt, entry.timePreference, availability.location.timezone)) throw new SalonAccessError("That opening no longer matches this request.", 409);
    const appointmentId = crypto.randomUUID(), assignedStaff = slot.staff[0];
    const reservations = await buildReservationRows(db, { appointmentId, organizationId: membership.organizationId, locationId: membership.locationId, staffId: assignedStaff.id, startsAt: slot.startsAt, endsAt: slot.endsAt, service: availability.service, capacity: availability.capacity, existingAppointments: availability.appointmentRows });
    if (!reservations) throw new SalonAccessError("That opening was just reserved.", 409);
    const claimId = crypto.randomUUID(), changedAt = new Date().toISOString();
    try {
      await db.batch([
        db.insert(appointments).values({ id: appointmentId, organizationId: membership.organizationId, locationId: membership.locationId, clientId: entry.clientId, petId: entry.petId, serviceId: entry.serviceId, staffId: assignedStaff.id, status: "confirmed", startsAt: slot.startsAt, endsAt: slot.endsAt, priceEstimateCents: availability.service.priceFromCents, depositCents: availability.service.depositCents, currency: availability.location.currency, clientNotes: entry.clientNotes }),
        db.insert(waitlistConversionClaims).values({ id: claimId, organizationId: membership.organizationId, waitlistEntryId: entry.id, expectedUpdatedAt: sql`(select updated_at from waitlist_entries where id = ${entry.id} and updated_at = ${entry.updatedAt} and status in ('waiting','contacted'))`, appointmentId, staffId: membership.id }),
        ...reservationInsertStatements(db, reservations),
        db.update(waitlistEntries).set({ status: "booked", convertedAppointmentId: appointmentId, staffNotes, updatedAt: changedAt }).where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.updatedAt, entry.updatedAt))),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "waitlist.converted", entityType: "waitlist_entry", entityId: entry.id, detailsJson: JSON.stringify({ appointmentId, startsAt: slot.startsAt, staffId: assignedStaff.id }) }),
      ]);
    } catch (error) { if (error instanceof Error && /unique|constraint|null/i.test(error.message)) throw new SalonAccessError("That opening or request just changed. Refresh and try again.", 409); throw error; }
    try {
      const portal = await issuePortalEmailSession(db, entry.clientId); const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, portal.token);
      await queueBookingCommunications(db, appointmentId, slot.startsAt, "confirmed", { portal_url: portalUrl }, `waitlist-${entry.id}`);
    } catch (communicationError) {
      console.error("Waitlist booking saved, but its private link or messages could not be prepared", communicationError);
    }
    return Response.json({ appointment: { id: appointmentId, startsAt: slot.startsAt, endsAt: slot.endsAt, petId: entry.petId, serviceId: entry.serviceId, staffId: assignedStaff.id }, waitlist: { id: entry.id, status: "booked" } }, { status: 201 });
  } catch (error) { return salonApiError(error, "Waitlist action could not be completed"); }
}
