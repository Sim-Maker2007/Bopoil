import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { appointments, auditEvents, clients, invoiceLineItems, invoiceMutationClaims, invoices, locations, onlinePaymentSessions, organizations, paymentEvents, paymentProviderAccounts, pets, services } from "../../../db/schema";
import { calculateInvoice, invoiceStatus } from "../../../lib/financial-ledger";
import { stripeRequest } from "../../../lib/stripe";
import { queueAppointmentMessage } from "../../../db/communications";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

const methods = ["cash", "card_terminal", "e_transfer", "external"] as const;
type Db = ReturnType<typeof import("../../../db").getDb>;
type MutationType = "payment" | "refund" | "reconcile";

function isConstraintError(error: unknown) {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

async function appointmentSnapshot(db: Db, appointmentId: string, organizationId: string, locationId: string) {
  const [row] = await db.select({
    appointment: appointments,
    serviceName: services.name,
    petName: pets.name,
    clientName: clients.fullName,
    clientEmail: clients.email,
    taxLabel: locations.taxLabel,
    taxRateBps: locations.taxRateBps,
    organizationName: organizations.name,
    locationName: locations.name,
    city: locations.city,
  }).from(appointments)
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .innerJoin(pets, eq(appointments.petId, pets.id))
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(locations, eq(appointments.locationId, locations.id))
    .innerJoin(organizations, eq(appointments.organizationId, organizations.id))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId), eq(appointments.locationId, locationId))).limit(1);
  if (!row) throw new SalonAccessError("Appointment not found.", 404);
  if (["cancelled", "no_show"].includes(row.appointment.status)) throw new SalonAccessError("Cancelled and no-show appointments cannot be checked out.", 409);
  return row;
}

async function checkoutResponse(db: Db, appointmentId: string, organizationId: string, locationId: string) {
  const snapshot = await appointmentSnapshot(db, appointmentId, organizationId, locationId);
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, organizationId))).limit(1);
  const preview = calculateInvoice({ subtotalCents: snapshot.appointment.priceEstimateCents, discountCents: 0, taxRateBps: snapshot.taxRateBps, tipCents: 0 });
  const [lines, events] = invoice ? await Promise.all([
    db.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.invoiceId, invoice.id), eq(invoiceLineItems.organizationId, organizationId))).orderBy(asc(invoiceLineItems.createdAt)),
    db.select().from(paymentEvents).where(and(eq(paymentEvents.invoiceId, invoice.id), eq(paymentEvents.organizationId, organizationId))).orderBy(asc(paymentEvents.occurredAt)),
  ]) : [[], []];
  return { appointment: snapshot.appointment, serviceName: snapshot.serviceName, petName: snapshot.petName, clientName: snapshot.clientName, clientEmail: snapshot.clientEmail, taxLabel: snapshot.taxLabel, taxRateBps: snapshot.taxRateBps, organizationName: snapshot.organizationName, locationName: snapshot.locationName, city: snapshot.city, invoice: invoice || null, lines, events, preview };
}

function mutationClaim(input: {
  organizationId: string;
  invoiceId: string;
  expectedMutationVersion: number;
  mutationType: MutationType;
  idempotencyKey: string;
}) {
  return {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    expectedMutationVersion: input.expectedMutationVersion,
    mutationType: input.mutationType,
    idempotencyKey: input.idempotencyKey,
  };
}

async function acquireExternalClaim(db: Db, values: ReturnType<typeof mutationClaim>) {
  try {
    const [claim] = await db.insert(invoiceMutationClaims).values(values).returning();
    return claim;
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const [sameRequest] = await db.select().from(invoiceMutationClaims).where(and(eq(invoiceMutationClaims.organizationId, values.organizationId), eq(invoiceMutationClaims.idempotencyKey, values.idempotencyKey))).limit(1);
    if (sameRequest?.invoiceId === values.invoiceId && sameRequest.expectedMutationVersion === values.expectedMutationVersion && sameRequest.mutationType === values.mutationType) return sameRequest;
    throw new SalonAccessError("This invoice changed in another session. Refresh before trying again.", 409);
  }
}

async function existingPaymentEvent(db: Db, organizationId: string, idempotencyKey: string) {
  const [event] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.organizationId, organizationId), eq(paymentEvents.idempotencyKey, idempotencyKey))).limit(1);
  return event;
}

async function handleMutationConflict(db: Db, organizationId: string, appointmentId: string, idempotencyKey: string) {
  const duplicate = await existingPaymentEvent(db, organizationId, idempotencyKey);
  if (duplicate?.appointmentId === appointmentId) return checkoutResponse(db, appointmentId, organizationId, duplicate.locationId);
  if (duplicate) throw new SalonAccessError("That payment request key was already used for another appointment.", 409);
  throw new SalonAccessError("This invoice changed in another session. Refresh before trying again.", 409);
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "checkout");
    const appointmentId = new URL(request.url).searchParams.get("appointmentId") || "";
    if (!appointmentId) throw new SalonAccessError("Appointment is required.", 400);
    return Response.json(await checkoutResponse(db, appointmentId, membership.organizationId, membership.locationId));
  } catch (error) {
    return salonApiError(error, "Checkout unavailable");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "checkout");
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "record_payment");
    const appointmentId = String(body.appointmentId || "");
    const idempotencyKey = String(body.idempotencyKey || "");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new SalonAccessError("A valid payment request key is required.", 400);
    const snapshot = await appointmentSnapshot(db, appointmentId, membership.organizationId, membership.locationId);

    const duplicate = await existingPaymentEvent(db, membership.organizationId, idempotencyKey);
    if (duplicate) {
      if (duplicate.appointmentId !== appointmentId) throw new SalonAccessError("That payment request key was already used for another appointment.", 409);
      const [paidInvoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
      if (paidInvoice?.status === "paid") await queueAppointmentMessage(db, { appointmentId, templateKey: "receipt", dedupeKey: `receipt:${paidInvoice.id}`, variables: { invoice_number: paidInvoice.invoiceNumber, payment_total: new Intl.NumberFormat("en-CA", { style: "currency", currency: paidInvoice.currency }).format(paidInvoice.totalCents / 100) } }).catch((communicationError) => console.error("Payment is safe, but its receipt could not be queued", communicationError));
      return Response.json(await checkoutResponse(db, appointmentId, membership.organizationId, membership.locationId));
    }

    let [invoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
    if (!invoice) {
      if (action === "refund") throw new SalonAccessError("The invoice does not have a payment to refund.", 409);
      const totals = calculateInvoice({ subtotalCents: snapshot.appointment.priceEstimateCents, discountCents: 0, taxRateBps: snapshot.taxRateBps, tipCents: 0 });
      const id = crypto.randomUUID();
      const invoiceNumber = `CC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
      const invoiceInsert = db.insert(invoices).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, appointmentId, invoiceNumber, subtotalCents: snapshot.appointment.priceEstimateCents, taxLabel: snapshot.taxLabel, taxRateBps: snapshot.taxRateBps, taxCents: totals.taxCents, totalCents: totals.totalCents, currency: snapshot.appointment.currency }).returning();
      const lineInsert = db.insert(invoiceLineItems).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, invoiceId: id, kind: "service", description: `${snapshot.serviceName} · ${snapshot.petName}`, quantity: 1, unitPriceCents: snapshot.appointment.priceEstimateCents, totalCents: snapshot.appointment.priceEstimateCents });
      try {
        const [created] = await db.batch([invoiceInsert, lineInsert]);
        invoice = created[0];
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        [invoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
      }
      if (!invoice) throw new SalonAccessError("The invoice changed in another session. Refresh and try again.", 409);
    }
    if (["void", "refunded"].includes(invoice.status) && action === "record_payment") throw new SalonAccessError("This invoice is closed.", 409);

    if (action === "refund") {
      requireSalonManager(membership);
      const parentPaymentId = String(body.paymentId || "");
      const amountCents = Number(body.amountCents);
      const reason = String(body.reason || "").trim();
      if (!Number.isInteger(amountCents) || amountCents < 1 || !reason) throw new SalonAccessError("Enter a refund amount and reason.", 400);
      const [parent] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.id, parentPaymentId), eq(paymentEvents.invoiceId, invoice.id), eq(paymentEvents.kind, "payment"), eq(paymentEvents.status, "succeeded"))).limit(1);
      if (!parent) throw new SalonAccessError("Original payment not found.", 404);
      const refunds = await db.select().from(paymentEvents).where(and(eq(paymentEvents.parentPaymentId, parent.id), eq(paymentEvents.kind, "refund"), inArray(paymentEvents.status, ["pending", "succeeded"])));
      const reservedRefundCents = refunds.reduce((sum, item) => sum + item.amountCents, 0);
      const reservedTaxCents = refunds.reduce((sum, item) => sum + item.taxAmountCents, 0);
      const reservedTipCents = refunds.reduce((sum, item) => sum + item.tipAmountCents, 0);
      const remainingRefundCents = parent.amountCents - reservedRefundCents;
      if (amountCents > remainingRefundCents) throw new SalonAccessError("Refund exceeds the remaining refundable amount.", 409);
      const finalRefund = amountCents === remainingRefundCents;
      const taxAmountCents = finalRefund ? parent.taxAmountCents - reservedTaxCents : Math.round(parent.taxAmountCents * amountCents / parent.amountCents);
      const tipAmountCents = finalRefund ? parent.tipAmountCents - reservedTipCents : Math.round(parent.tipAmountCents * amountCents / parent.amountCents);
      const claimValues = mutationClaim({ organizationId: membership.organizationId, invoiceId: invoice.id, expectedMutationVersion: invoice.mutationVersion, mutationType: "refund", idempotencyKey });
      let refundReference = "";
      let refundStatus: "pending" | "succeeded" = "succeeded";
      let onlineSession: typeof onlinePaymentSessions.$inferSelect | undefined;
      let externalClaimed = false;

      if (parent.externalReference.startsWith("pi_") && parent.note.startsWith("Stripe online")) {
        const result = await Promise.all([
          db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.providerPaymentIntentId, parent.externalReference), eq(onlinePaymentSessions.organizationId, membership.organizationId))).limit(1),
          db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1),
        ]);
        onlineSession = result[0][0];
        const providerAccount = result[1][0];
        if (!onlineSession || !providerAccount) throw new SalonAccessError("The Stripe payment connection could not be verified, so no refund was recorded.", 409);
        // This key is derived from the invoice version rather than the browser
        // request UUID, so a retry after an ambiguous network failure safely
        // resumes the same Stripe refund instead of permanently locking the invoice.
        const externalMutationKey = `stripe-refund:${parent.id}:${invoice.mutationVersion}:${amountCents}`;
        claimValues.idempotencyKey = externalMutationKey;
        const claim = await acquireExternalClaim(db, claimValues);
        claimValues.id = claim.id;
        externalClaimed = true;
        const refund = await stripeRequest<{ id: string; status?: string }>("refunds", { payment_intent: parent.externalReference, amount: amountCents, refund_application_fee: onlineSession.applicationFeeCents > 0, "metadata[organization_id]": membership.organizationId, "metadata[invoice_id]": invoice.id, "metadata[payment_event_id]": parent.id }, { account: providerAccount.connectedAccountId, idempotencyKey: externalMutationKey });
        if (refund.status === "failed" || refund.status === "canceled") {
          await db.delete(invoiceMutationClaims).where(eq(invoiceMutationClaims.id, claimValues.id));
          throw new Error("Stripe did not accept the refund.");
        }
        refundReference = refund.id;
        refundStatus = refund.status === "succeeded" ? "succeeded" : "pending";
      }

      const now = new Date().toISOString();
      const amountRefundedCents = invoice.amountRefundedCents + (refundStatus === "succeeded" ? amountCents : 0);
      const eventInsert = db.insert(paymentEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, invoiceId: invoice.id, appointmentId, kind: "refund", method: parent.method, amountCents, taxAmountCents, tipAmountCents, status: refundStatus, idempotencyKey, externalReference: refundReference, note: reason, parentPaymentId: parent.id, actorStaffId: membership.id });
      const invoiceUpdate = db.update(invoices).set({ amountRefundedCents, status: invoiceStatus(invoice.totalCents, invoice.amountPaidCents, amountRefundedCents), mutationVersion: invoice.mutationVersion + 1, updatedAt: now }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, membership.organizationId), eq(invoices.mutationVersion, invoice.mutationVersion)));
      const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: refundStatus === "succeeded" ? "payment.refunded" : "payment.refund_pending", entityType: "invoice", entityId: invoice.id, detailsJson: JSON.stringify({ paymentId: parent.id, amountCents, reason, refundReference }) });
      const sessionUpdate = onlineSession && refundStatus === "succeeded" && finalRefund
        ? db.update(onlinePaymentSessions).set({ status: "refunded", updatedAt: now }).where(eq(onlinePaymentSessions.id, onlineSession.id))
        : null;
      try {
        if (externalClaimed) {
          if (sessionUpdate) await db.batch([eventInsert, invoiceUpdate, auditInsert, sessionUpdate]);
          else await db.batch([eventInsert, invoiceUpdate, auditInsert]);
        } else {
          const claimInsert = db.insert(invoiceMutationClaims).values(claimValues);
          if (sessionUpdate) await db.batch([claimInsert, eventInsert, invoiceUpdate, auditInsert, sessionUpdate]);
          else await db.batch([claimInsert, eventInsert, invoiceUpdate, auditInsert]);
        }
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        return Response.json(await handleMutationConflict(db, membership.organizationId, appointmentId, idempotencyKey));
      }
      return Response.json(await checkoutResponse(db, appointmentId, membership.organizationId, membership.locationId));
    }

    const method = String(body.method || "") as typeof methods[number];
    if (!methods.includes(method)) throw new SalonAccessError("Choose a valid payment method.", 400);
    const discountCents = Number(body.discountCents ?? invoice.discountCents);
    const tipCents = Number(body.tipCents ?? invoice.tipCents);
    const discountReason = String(body.discountReason || invoice.discountReason || "").trim();
    if (![discountCents, tipCents].every((value) => Number.isInteger(value) && value >= 0) || discountCents > invoice.subtotalCents) throw new SalonAccessError("Discount and tip amounts are invalid.", 400);
    if (discountCents > 0 && !discountReason) throw new SalonAccessError("Add a reason for the discount.", 400);
    if ((discountCents !== invoice.discountCents || discountReason !== invoice.discountReason) && discountCents > 0) requireSalonManager(membership);
    if (invoice.amountPaidCents > 0 && (discountCents !== invoice.discountCents || tipCents !== invoice.tipCents)) throw new SalonAccessError("Discounts and tips cannot change after payment begins.", 409);
    const totals = calculateInvoice({ subtotalCents: invoice.subtotalCents, discountCents, taxRateBps: invoice.taxRateBps, tipCents });
    const balanceCents = Math.max(0, totals.totalCents - invoice.amountPaidCents);
    const amountCents = Number(body.amountCents ?? balanceCents);
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > balanceCents) throw new SalonAccessError("Payment must be greater than zero and cannot exceed the balance.", 400);
    const priorAllocations = await db.select({ tax: sql<number>`coalesce(sum(${paymentEvents.taxAmountCents}), 0)`, tip: sql<number>`coalesce(sum(${paymentEvents.tipAmountCents}), 0)` }).from(paymentEvents).where(and(eq(paymentEvents.invoiceId, invoice.id), eq(paymentEvents.kind, "payment"), eq(paymentEvents.status, "succeeded")));
    const finalPayment = amountCents === balanceCents;
    const taxAmountCents = finalPayment ? totals.taxCents - Number(priorAllocations[0]?.tax || 0) : Math.round(totals.taxCents * amountCents / totals.totalCents);
    const tipAmountCents = finalPayment ? tipCents - Number(priorAllocations[0]?.tip || 0) : Math.round(tipCents * amountCents / totals.totalCents);
    const amountPaidCents = invoice.amountPaidCents + amountCents;
    const status = invoiceStatus(totals.totalCents, amountPaidCents, invoice.amountRefundedCents);
    const now = new Date().toISOString();
    const claimInsert = db.insert(invoiceMutationClaims).values(mutationClaim({ organizationId: membership.organizationId, invoiceId: invoice.id, expectedMutationVersion: invoice.mutationVersion, mutationType: "payment", idempotencyKey }));
    const eventInsert = db.insert(paymentEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, invoiceId: invoice.id, appointmentId, kind: "payment", method, amountCents, taxAmountCents, tipAmountCents, idempotencyKey, externalReference: String(body.externalReference || "").trim(), note: String(body.note || "").trim(), actorStaffId: membership.id });
    const invoiceUpdate = db.update(invoices).set({ discountCents, discountReason, tipCents, taxCents: totals.taxCents, totalCents: totals.totalCents, amountPaidCents, status, mutationVersion: invoice.mutationVersion + 1, updatedAt: now, paidAt: status === "paid" ? now : invoice.paidAt }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, membership.organizationId), eq(invoices.mutationVersion, invoice.mutationVersion)));
    const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "payment.recorded", entityType: "invoice", entityId: invoice.id, detailsJson: JSON.stringify({ method, amountCents, tipCents, discountCents }) });
    const completeReadyVisit = finalPayment && status === "paid" && snapshot.appointment.status === "ready";
    const completionUpdate = db.update(appointments).set({ status: "completed", updatedAt: now }).where(and(
      eq(appointments.id, appointmentId),
      eq(appointments.organizationId, membership.organizationId),
      eq(appointments.locationId, membership.locationId),
      eq(appointments.status, "ready"),
      eq(appointments.updatedAt, snapshot.appointment.updatedAt),
    )).returning({ id: appointments.id });
    const completionAudit = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: sql<string>`(
        select organization_id from appointments
        where id = ${appointmentId}
          and organization_id = ${membership.organizationId}
          and location_id = ${membership.locationId}
          and status = 'completed'
          and updated_at = ${now}
      )`,
      actorType: "staff",
      actorId: membership.id,
      action: "appointment.completed_at_checkout",
      entityType: "appointment",
      entityId: appointmentId,
      detailsJson: JSON.stringify({ invoiceId: invoice.id, paymentIdempotencyKey: idempotencyKey }),
    });
    try {
      if (completeReadyVisit) {
        await db.batch([claimInsert, eventInsert, invoiceUpdate, auditInsert, completionUpdate, completionAudit]);
      } else {
        await db.batch([claimInsert, eventInsert, invoiceUpdate, auditInsert]);
      }
    } catch (error) {
      if (!isConstraintError(error)) throw error;
      return Response.json(await handleMutationConflict(db, membership.organizationId, appointmentId, idempotencyKey));
    }
    if (status === "paid") await queueAppointmentMessage(db, { appointmentId, templateKey: "receipt", dedupeKey: `receipt:${invoice.id}`, variables: { invoice_number: invoice.invoiceNumber, payment_total: new Intl.NumberFormat("en-CA", { style: "currency", currency: invoice.currency }).format(totals.totalCents / 100) } }).catch((communicationError) => console.error("Payment is safe, but its receipt could not be queued", communicationError));
    return Response.json(await checkoutResponse(db, appointmentId, membership.organizationId, membership.locationId));
  } catch (error) {
    return salonApiError(error, "Payment could not be recorded");
  }
}
