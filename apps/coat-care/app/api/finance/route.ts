import { and, desc, eq, gte, lt } from "drizzle-orm";
import { appointments, auditEvents, clients, dailyCloseouts, invoices, locations, paymentEvents, pets } from "../../../db/schema";
import { requireFinancialAccess, requireSalonAccess, requireSalonManager, salonApiError, SalonAccessError } from "../../salon-access";
import { dateKeyInZone, zonedDayBounds } from "../../../lib/time-zone";
import { summarizePayments } from "../../../lib/accounting";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return dayPattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }

async function financialDay(db: Awaited<ReturnType<typeof requireSalonAccess>>["db"], scope: { organizationId: string; locationId: string }, day: string) {
  const [location] = await db.select({ taxLabel: locations.taxLabel, taxRateBps: locations.taxRateBps, currency: locations.currency, timezone: locations.timezone }).from(locations).where(and(eq(locations.id, scope.locationId), eq(locations.organizationId, scope.organizationId))).limit(1);
  if (!location) throw new SalonAccessError("Location not found.", 404);
  const { start, end } = zonedDayBounds(day, location.timezone);
  const events = await db.select({ id: paymentEvents.id, invoiceId: paymentEvents.invoiceId, appointmentId: paymentEvents.appointmentId, kind: paymentEvents.kind, method: paymentEvents.method, amountCents: paymentEvents.amountCents, taxAmountCents: paymentEvents.taxAmountCents, tipAmountCents: paymentEvents.tipAmountCents, note: paymentEvents.note, parentPaymentId: paymentEvents.parentPaymentId, occurredAt: paymentEvents.occurredAt, invoiceNumber: invoices.invoiceNumber, petName: pets.name, clientName: clients.fullName })
    .from(paymentEvents).innerJoin(invoices, eq(paymentEvents.invoiceId, invoices.id)).innerJoin(appointments, eq(paymentEvents.appointmentId, appointments.id)).innerJoin(pets, eq(appointments.petId, pets.id)).innerJoin(clients, eq(appointments.clientId, clients.id))
    .where(and(eq(paymentEvents.organizationId, scope.organizationId), eq(paymentEvents.locationId, scope.locationId), eq(paymentEvents.status, "succeeded"), gte(paymentEvents.occurredAt, start.toISOString()), lt(paymentEvents.occurredAt, end.toISOString()))).orderBy(desc(paymentEvents.occurredAt));
  return { location, events, metrics: summarizePayments(events) };
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireFinancialAccess(membership);
    const day = new URL(request.url).searchParams.get("day") || new Date().toISOString().slice(0, 10);
    if (!validDay(day)) throw new SalonAccessError("Choose a valid closeout date.", 400);
    const current = await financialDay(db, membership, day);
    const recentInvoices = await db.select({ id: invoices.id, appointmentId: invoices.appointmentId, invoiceNumber: invoices.invoiceNumber, status: invoices.status, totalCents: invoices.totalCents, amountPaidCents: invoices.amountPaidCents, amountRefundedCents: invoices.amountRefundedCents, tipCents: invoices.tipCents, taxCents: invoices.taxCents, currency: invoices.currency, updatedAt: invoices.updatedAt, petName: pets.name, clientName: clients.fullName })
      .from(invoices).innerJoin(appointments, eq(invoices.appointmentId, appointments.id)).innerJoin(pets, eq(appointments.petId, pets.id)).innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(eq(invoices.organizationId, membership.organizationId), eq(invoices.locationId, membership.locationId))).orderBy(desc(invoices.updatedAt)).limit(30);
    const [snapshot] = await db.select().from(dailyCloseouts).where(and(eq(dailyCloseouts.organizationId, membership.organizationId), eq(dailyCloseouts.locationId, membership.locationId), eq(dailyCloseouts.businessDate, day))).limit(1);
    const closeout = snapshot ? { ...snapshot, drifted: snapshot.status === "closed" && (snapshot.netCollectedCents !== current.metrics.netCollectedCents || snapshot.expectedCashCents !== current.metrics.byMethod.cash || snapshot.salesTaxCents !== current.metrics.salesTaxCents || snapshot.tipsCents !== current.metrics.tipsCents || snapshot.refundsCents !== current.metrics.refundsCents || snapshot.transactionCount !== current.metrics.transactionCount) } : null;
    return Response.json({ location: current.location, day, metrics: { collectedCents: current.metrics.netCollectedCents, paymentsCents: current.metrics.paymentsCents, refundsCents: current.metrics.refundsCents, tipsCents: current.metrics.tipsCents, taxCents: current.metrics.salesTaxCents, transactionCount: current.metrics.transactionCount, byMethod: current.metrics.byMethod }, events: current.events, invoices: recentInvoices, closeout, canManage: ["owner", "manager"].includes(membership.role) });
  } catch (error) { return salonApiError(error, "Financials unavailable"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireFinancialAccess(membership); requireSalonManager(membership);
    const body = await request.json() as { action?: string; day?: string; countedCashCents?: number; note?: string; reason?: string };
    const action = String(body.action || ""), day = String(body.day || "");
    if (!validDay(day)) throw new SalonAccessError("Choose a valid closeout date.", 400);
    const current = await financialDay(db, membership, day);
    if (day > dateKeyInZone(new Date(), current.location.timezone)) throw new SalonAccessError("A future business day cannot be closed.", 400);
    const [existing] = await db.select().from(dailyCloseouts).where(and(eq(dailyCloseouts.organizationId, membership.organizationId), eq(dailyCloseouts.locationId, membership.locationId), eq(dailyCloseouts.businessDate, day))).limit(1);
    const now = new Date().toISOString();
    if (action === "close") {
      const countedCashCents = Number(body.countedCashCents), note = String(body.note || "").trim().slice(0, 500);
      if (!Number.isInteger(countedCashCents) || countedCashCents < 0 || countedCashCents > 100_000_000) throw new SalonAccessError("Enter the counted cash drawer total.", 400);
      if (existing?.status === "closed") throw new SalonAccessError("This day is already closed. Reopen it before replacing the snapshot.", 409);
      const values = { status: "closed" as const, netCollectedCents: current.metrics.netCollectedCents, expectedCashCents: current.metrics.byMethod.cash, countedCashCents, cashVarianceCents: countedCashCents - current.metrics.byMethod.cash, salesTaxCents: current.metrics.salesTaxCents, tipsCents: current.metrics.tipsCents, refundsCents: current.metrics.refundsCents, transactionCount: current.metrics.transactionCount, note, closedByStaffId: membership.id, closedAt: now, reopenedByStaffId: null, reopenedAt: null, updatedAt: now };
      const [closeout] = existing ? await db.update(dailyCloseouts).set(values).where(and(eq(dailyCloseouts.id, existing.id), eq(dailyCloseouts.status, "reopened"))).returning() : await db.insert(dailyCloseouts).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, businessDate: day, ...values }).returning();
      if (!closeout) throw new SalonAccessError("The closeout changed in another session. Refresh and try again.", 409);
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "finance.day_closed", entityType: "daily_closeout", entityId: closeout.id, detailsJson: JSON.stringify({ day, expectedCashCents: current.metrics.byMethod.cash, countedCashCents, cashVarianceCents: closeout.cashVarianceCents, transactionCount: current.metrics.transactionCount }) });
      return Response.json({ closeout });
    }
    if (action === "reopen") {
      const reason = String(body.reason || "").trim().slice(0, 500);
      if (!existing || existing.status !== "closed") throw new SalonAccessError("Only a closed day can be reopened.", 409);
      if (reason.length < 3) throw new SalonAccessError("Explain why this closeout is being reopened.", 400);
      const [closeout] = await db.update(dailyCloseouts).set({ status: "reopened", reopenedByStaffId: membership.id, reopenedAt: now, note: `${existing.note}${existing.note ? "\n" : ""}Reopened: ${reason}`, updatedAt: now }).where(and(eq(dailyCloseouts.id, existing.id), eq(dailyCloseouts.status, "closed"))).returning();
      if (!closeout) throw new SalonAccessError("The closeout changed in another session. Refresh and try again.", 409);
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "finance.day_reopened", entityType: "daily_closeout", entityId: closeout.id, detailsJson: JSON.stringify({ day, reason }) });
      return Response.json({ closeout });
    }
    throw new SalonAccessError("Choose a valid closeout action.", 400);
  } catch (error) { return salonApiError(error, "Closeout could not be updated"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireFinancialAccess(membership); requireSalonManager(membership);
    const body = await request.json() as { taxLabel?: string; taxRateBps?: number };
    const taxLabel = String(body.taxLabel || "").trim(); const taxRateBps = Number(body.taxRateBps);
    if (!taxLabel || taxLabel.length > 20 || !Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 3000) throw new SalonAccessError("Enter a valid tax label and rate.", 400);
    await db.update(locations).set({ taxLabel, taxRateBps }).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId)));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "location.tax_settings_updated", entityType: "location", entityId: membership.locationId, detailsJson: JSON.stringify({ taxLabel, taxRateBps }) });
    return Response.json({ location: { taxLabel, taxRateBps } });
  } catch (error) { return salonApiError(error, "Tax settings could not be updated"); }
}
