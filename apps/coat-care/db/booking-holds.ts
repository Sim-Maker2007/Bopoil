import { and, eq, lte } from "drizzle-orm";
import type { getDb } from ".";
import { appointmentReservations, appointments, auditEvents, onlinePaymentSessions } from "./schema";
import { cancelPendingAppointmentMessages, queueAppointmentMessage } from "./communications";

type Db = ReturnType<typeof getDb>;

/** Releases only locally expired, unpaid deposit holds after the webhook grace period. */
export async function releaseExpiredBookingHolds(db: Db, locationId: string, now = new Date()) {
  const expired = await db.select({ id: appointments.id, organizationId: appointments.organizationId }).from(appointments).where(and(
    eq(appointments.locationId, locationId), eq(appointments.depositStatus, "pending"), lte(appointments.depositDueAt, now.toISOString()),
  ));
  if (!expired.length) return [];
  const releasedAt = now.toISOString(), released: string[] = [];
  for (const item of expired) {
    // The conditional update is the claim. If payment won the race, no reservation is touched.
    const [claimed] = await db.update(appointments).set({ status: "cancelled", depositStatus: "failed", updatedAt: releasedAt }).where(and(eq(appointments.id, item.id), eq(appointments.depositStatus, "pending"), lte(appointments.depositDueAt, releasedAt))).returning({ id: appointments.id });
    if (!claimed) continue;
    await db.batch([
      db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, item.id)),
      db.update(onlinePaymentSessions).set({ status: "expired", updatedAt: releasedAt }).where(and(eq(onlinePaymentSessions.appointmentId, item.id), eq(onlinePaymentSessions.status, "open"))),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: item.organizationId, actorType: "system", action: "booking.deposit_hold_expired", entityType: "appointment", entityId: item.id, detailsJson: JSON.stringify({ releasedAt }) }),
    ]);
    await cancelPendingAppointmentMessages(db, item.id, "deposit-hold-expiry", "system").catch((error) => {
      console.error("Deposit hold expired, but stale appointment messages could not all be cancelled", error);
    });
    await queueAppointmentMessage(db, {
      appointmentId: item.id,
      templateKey: "booking_deposit_expired",
      dedupeKey: `booking_deposit_expired:${item.id}`,
    }).catch((error) => {
      console.error("Deposit hold expired, but its client notice could not be queued", error);
    });
    released.push(item.id);
  }
  return released;
}

/** Finds expired holds across tenants so the scheduled worker releases them without waiting for page traffic. */
export async function sweepExpiredBookingHolds(db: Db, now = new Date(), locationLimit = 25) {
  const expiredLocations = await db
    .select({ locationId: appointments.locationId })
    .from(appointments)
    .where(and(
      eq(appointments.depositStatus, "pending"),
      lte(appointments.depositDueAt, now.toISOString()),
    ))
    .groupBy(appointments.locationId)
    .limit(locationLimit);
  const released: string[] = [];
  for (const row of expiredLocations) {
    released.push(...await releaseExpiredBookingHolds(db, row.locationId, now));
  }
  return released;
}
