import { and, eq, sql } from "drizzle-orm";
import { appointmentReservations, appointments, auditEvents, invoiceMutationClaims, invoices, onlinePaymentSessions, organizationSubscriptions, paymentEvents, paymentProviderAccounts, providerWebhookEvents, salonSettings } from "../../../../db/schema";
import { getDb } from "../../../../db";
import { issuePortalEmailSession } from "../../../../db/client-portal";
import { cancelPendingAppointmentMessages, queueAppointmentMessage, queueBookingCommunications } from "../../../../db/communications";
import { invoiceStatus } from "../../../../lib/financial-ledger";
import { portalAccessUrl, safePublicOrigin } from "../../../../lib/portal-links";
import { sha256, stripeRequest, verifyStripeSignature } from "../../../../lib/stripe";

type StripeEvent = { id: string; type: string; livemode?: boolean; account?: string; data?: { object?: Record<string, unknown> } };
const string = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: unknown) => typeof value === "number" && value > 0 ? new Date(value * 1000).toISOString() : null;
type Db = ReturnType<typeof getDb>;

function isConstraintError(error: unknown) {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

function mutationClaim(input: {
  organizationId: string;
  invoiceId: string;
  expectedMutationVersion: number;
  mutationType: "payment" | "refund" | "reconcile";
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
    throw new Error("Invoice mutation is already in progress; retry the webhook.");
  }
}

async function completePayment(session: Record<string, unknown>) {
  const db = getDb();
  const sessionId = string(session.id);
  if (!sessionId) return;
  const [stored] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.providerSessionId, sessionId)).limit(1);
  if (!stored || !stored.invoiceId) return;
  let [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, stored.invoiceId), eq(invoices.organizationId, stored.organizationId))).limit(1);
  if (!invoice) throw new Error("Payment invoice not found.");
  const paymentIdempotency = `stripe:${sessionId}`;
  const [existingPayment] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.organizationId, stored.organizationId), eq(paymentEvents.idempotencyKey, paymentIdempotency))).limit(1);
  const now = new Date().toISOString();
  if (!existingPayment) {
    const paidBefore = Math.max(0, invoice.amountPaidCents);
    // Record what Stripe actually collected. Clamping to a stale invoice balance
    // would hide an overpayment if another tender was recorded after link creation.
    const amount = stored.amountCents;
    const finalPayment = paidBefore + amount >= invoice.totalCents;
    const prior = await db.select({ tax: sql<number>`coalesce(sum(${paymentEvents.taxAmountCents}), 0)`, tip: sql<number>`coalesce(sum(${paymentEvents.tipAmountCents}), 0)` }).from(paymentEvents).where(and(eq(paymentEvents.invoiceId, invoice.id), eq(paymentEvents.kind, "payment"), eq(paymentEvents.status, "succeeded")));
    const taxAmountCents = finalPayment ? Math.max(0, invoice.taxCents - Number(prior[0]?.tax || 0)) : Math.round(invoice.taxCents * amount / invoice.totalCents);
    const tipAmountCents = finalPayment ? Math.max(0, invoice.tipCents - Number(prior[0]?.tip || 0)) : Math.round(invoice.tipCents * amount / invoice.totalCents);
    const amountPaidCents = paidBefore + amount;
    const claimInsert = db.insert(invoiceMutationClaims).values(mutationClaim({ organizationId: stored.organizationId, invoiceId: invoice.id, expectedMutationVersion: invoice.mutationVersion, mutationType: "payment", idempotencyKey: paymentIdempotency }));
    const eventInsert = db.insert(paymentEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, locationId: stored.locationId, invoiceId: invoice.id, appointmentId: stored.appointmentId, kind: "payment", method: "external", amountCents: amount, taxAmountCents, tipAmountCents, externalReference: string(session.payment_intent) || sessionId, idempotencyKey: paymentIdempotency, note: stored.purpose === "deposit" ? "Stripe online deposit" : "Stripe online invoice payment" });
    const invoiceUpdate = db.update(invoices).set({ amountPaidCents, status: invoiceStatus(invoice.totalCents, amountPaidCents, invoice.amountRefundedCents), paidAt: amountPaidCents >= invoice.totalCents ? now : invoice.paidAt, mutationVersion: invoice.mutationVersion + 1, updatedAt: now }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, stored.organizationId), eq(invoices.mutationVersion, invoice.mutationVersion)));
    const sessionUpdate = db.update(onlinePaymentSessions).set({ status: "paid", providerPaymentIntentId: string(session.payment_intent), completedAt: now, updatedAt: now }).where(and(eq(onlinePaymentSessions.id, stored.id), eq(onlinePaymentSessions.status, "open")));
    const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, actorType: "system", action: "payment.online_succeeded", entityType: "invoice", entityId: invoice.id, detailsJson: JSON.stringify({ provider: "stripe", sessionId, purpose: stored.purpose, amountCents: amount }) });
    try {
      await db.batch([claimInsert, eventInsert, invoiceUpdate, sessionUpdate, auditInsert]);
    } catch (error) {
      if (!isConstraintError(error)) throw error;
      const [concurrentPayment] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.organizationId, stored.organizationId), eq(paymentEvents.idempotencyKey, paymentIdempotency))).limit(1);
      if (!concurrentPayment) throw new Error("Invoice changed while applying an online payment; retry the webhook.");
    }
    [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, stored.invoiceId), eq(invoices.organizationId, stored.organizationId))).limit(1);
    if (!invoice) throw new Error("Payment invoice disappeared after payment.");
  } else {
    await db.update(onlinePaymentSessions).set({ status: "paid", providerPaymentIntentId: string(session.payment_intent), completedAt: stored.completedAt || now, updatedAt: now }).where(and(eq(onlinePaymentSessions.id, stored.id), eq(onlinePaymentSessions.status, "open")));
  }

  if (stored.purpose === "deposit") {
    const [[appointment], [settings]] = await Promise.all([db.select().from(appointments).where(and(eq(appointments.id, stored.appointmentId), eq(appointments.organizationId, stored.organizationId))).limit(1), db.select().from(salonSettings).where(eq(salonSettings.locationId, stored.locationId)).limit(1)]);
    if (appointment && (appointment.depositStatus === "failed" || appointment.status === "cancelled")) {
      const [existingRefund] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.organizationId, stored.organizationId), eq(paymentEvents.idempotencyKey, `stripe-late-refund:${sessionId}`))).limit(1);
      if (existingRefund) {
        if (existingRefund.status === "succeeded") await db.update(onlinePaymentSessions).set({ status: "refunded", updatedAt: now }).where(eq(onlinePaymentSessions.id, stored.id));
        return;
      }
      const [account] = await db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, stored.organizationId)).limit(1);
      const paymentIntent = string(session.payment_intent);
      if (!account || !paymentIntent) throw new Error("A late deposit could not be returned automatically.");
      const [parent] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.organizationId, stored.organizationId), eq(paymentEvents.idempotencyKey, paymentIdempotency))).limit(1);
      if (!parent) throw new Error("Late deposit ledger event is unavailable.");
      const [refundInvoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, stored.organizationId))).limit(1);
      if (!refundInvoice) throw new Error("Late deposit invoice is unavailable.");
      const refundIdempotency = `stripe-late-refund:${sessionId}`;
      const claim = await acquireExternalClaim(db, mutationClaim({ organizationId: stored.organizationId, invoiceId: refundInvoice.id, expectedMutationVersion: refundInvoice.mutationVersion, mutationType: "refund", idempotencyKey: refundIdempotency }));
      const refund = await stripeRequest<{ id: string; status?: string }>("refunds", { payment_intent: paymentIntent, amount: stored.amountCents, refund_application_fee: stored.applicationFeeCents > 0, "metadata[organization_id]": stored.organizationId, "metadata[invoice_id]": invoice.id, "metadata[reason]": "booking_hold_expired" }, { account: account.connectedAccountId, idempotencyKey: `late-deposit-refund:${sessionId}` });
      if (refund.status === "failed" || refund.status === "canceled") {
        await db.delete(invoiceMutationClaims).where(eq(invoiceMutationClaims.id, claim.id));
        throw new Error("Stripe rejected the automatic late-deposit refund.");
      }
      const refundStatus = refund.status === "succeeded" ? "succeeded" : "pending";
      const amountRefundedCents = refundInvoice.amountRefundedCents + (refundStatus === "succeeded" ? stored.amountCents : 0);
      const refundedAt = new Date().toISOString();
      const refundInsert = db.insert(paymentEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, locationId: stored.locationId, invoiceId: invoice.id, appointmentId: stored.appointmentId, kind: "refund", method: "external", amountCents: stored.amountCents, taxAmountCents: parent.taxAmountCents, tipAmountCents: parent.tipAmountCents, status: refundStatus, externalReference: refund.id, idempotencyKey: refundIdempotency, note: "Automatic refund after booking hold expired", parentPaymentId: parent.id });
      const invoiceUpdate = db.update(invoices).set({ amountRefundedCents, status: invoiceStatus(refundInvoice.totalCents, refundInvoice.amountPaidCents, amountRefundedCents), mutationVersion: refundInvoice.mutationVersion + 1, updatedAt: refundedAt }).where(and(eq(invoices.id, refundInvoice.id), eq(invoices.mutationVersion, refundInvoice.mutationVersion)));
      const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, actorType: "system", action: "booking.late_deposit_refunded", entityType: "appointment", entityId: appointment.id, detailsJson: JSON.stringify({ sessionId, refundId: refund.id, refundStatus }) });
      try {
        if (refundStatus === "succeeded") await db.batch([refundInsert, invoiceUpdate, db.update(onlinePaymentSessions).set({ status: "refunded", updatedAt: refundedAt }).where(eq(onlinePaymentSessions.id, stored.id)), auditInsert]);
        else await db.batch([refundInsert, invoiceUpdate, auditInsert]);
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        const [concurrentRefund] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(and(eq(paymentEvents.organizationId, stored.organizationId), eq(paymentEvents.idempotencyKey, refundIdempotency))).limit(1);
        if (!concurrentRefund) throw new Error("Invoice changed while recording a late-deposit refund; retry the webhook.");
      }
      return;
    }
    if (appointment?.depositStatus === "pending") {
      const status = settings?.bookingMode === "automatic" ? "confirmed" : "requested";
      const [confirmed] = await db.update(appointments).set({ depositStatus: "paid", depositPaidAt: now, status, updatedAt: now }).where(and(eq(appointments.id, appointment.id), eq(appointments.depositStatus, "pending"))).returning({ id: appointments.id });
      if (!confirmed) throw new Error("Deposit state changed during confirmation; retrying from provider state.");
      const portal = await issuePortalEmailSession(db, appointment.clientId); const origin = process.env.DELIVERY_PUBLIC_URL || safePublicOrigin(string(session.success_url)); const portalUrl = portalAccessUrl(origin, portal.token);
      await queueBookingCommunications(db, appointment.id, appointment.startsAt, status, { portal_url: portalUrl }, "deposit-paid").catch((error) => console.error("Deposit paid, but confirmation could not be queued", error));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, actorType: "system", action: "booking.deposit_confirmed", entityType: "appointment", entityId: appointment.id, detailsJson: JSON.stringify({ sessionId, status }) });
    } else if (appointment?.depositStatus === "paid" && string((session.metadata as Record<string, unknown> | undefined)?.required_booking_deposit) === "true") {
      const portal = await issuePortalEmailSession(db, appointment.clientId); const origin = process.env.DELIVERY_PUBLIC_URL || safePublicOrigin(string(session.success_url)); await queueBookingCommunications(db, appointment.id, appointment.startsAt, appointment.status, { portal_url: portalAccessUrl(origin, portal.token) }, "deposit-paid").catch((error) => console.error("Paid booking confirmation retry could not be queued", error));
    } else if (appointment && !["cancelled", "no_show"].includes(appointment.status)) await db.update(appointments).set({ depositStatus: "paid", depositPaidAt: now, updatedAt: now }).where(eq(appointments.id, appointment.id));
  }
}

async function releaseDepositSession(sessionId: string, reason: "expired" | "failed") {
  const db = getDb(); const [stored] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.providerSessionId, sessionId)).limit(1); if (!stored) return;
  if (stored.purpose !== "deposit") { await db.update(onlinePaymentSessions).set({ status: reason, updatedAt: new Date().toISOString() }).where(and(eq(onlinePaymentSessions.id, stored.id), eq(onlinePaymentSessions.status, "open"))); return; }
  const now = new Date().toISOString(); const [claimed] = await db.update(appointments).set({ status: "cancelled", depositStatus: "failed", updatedAt: now }).where(and(eq(appointments.id, stored.appointmentId), eq(appointments.depositStatus, "pending"))).returning({ id: appointments.id });
  if (!claimed) { await db.update(onlinePaymentSessions).set({ status: reason, updatedAt: now }).where(and(eq(onlinePaymentSessions.id, stored.id), eq(onlinePaymentSessions.status, "open"))); return; }
  await db.batch([
    db.update(onlinePaymentSessions).set({ status: reason, updatedAt: now }).where(and(eq(onlinePaymentSessions.id, stored.id), eq(onlinePaymentSessions.status, "open"))),
    db.delete(appointmentReservations).where(eq(appointmentReservations.appointmentId, stored.appointmentId)),
  ]);
  await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: stored.organizationId, actorType: "system", action: `booking.deposit_${reason}`, entityType: "appointment", entityId: stored.appointmentId, detailsJson: JSON.stringify({ sessionId, releasedAt: now }) });
  await cancelPendingAppointmentMessages(db, stored.appointmentId, "stripe-deposit-expiry", "system").catch((error) => console.error("Deposit session closed, but stale appointment messages could not all be cancelled", error));
  await queueAppointmentMessage(db, { appointmentId: stored.appointmentId, templateKey: "booking_deposit_expired", dedupeKey: `booking_deposit_expired:${stored.appointmentId}` }).catch((error) => console.error("Deposit session closed, but its client notice could not be queued", error));
}

async function syncSubscription(object: Record<string, unknown>, sessionMetadata?: Record<string, unknown>) {
  const db = getDb(); const metadata = (object.metadata || sessionMetadata || {}) as Record<string, unknown>; let organizationId = string(metadata.organization_id) || string(sessionMetadata?.organization_id); const providerSubscriptionId = object.object === "subscription" ? string(object.id) : string(object.subscription);
  if (!organizationId && providerSubscriptionId) { const [existing] = await db.select({ organizationId: organizationSubscriptions.organizationId }).from(organizationSubscriptions).where(eq(organizationSubscriptions.providerSubscriptionId, providerSubscriptionId)).limit(1); organizationId = existing?.organizationId || ""; }
  if (!organizationId) return;
  const rawStatus = string(object.status) === "canceled" ? "cancelled" : string(object.status) || "active"; const allowed = ["trialing", "active", "past_due", "cancelled", "incomplete", "unpaid"] as const; const status = allowed.includes(rawStatus as typeof allowed[number]) ? rawStatus as typeof allowed[number] : "incomplete";
  const planValue = string(metadata.plan); const plan = (["starter", "growth", "multi"].includes(planValue) ? planValue : "starter") as "starter" | "growth" | "multi";
  const values = { providerCustomerId: string(object.customer), providerSubscriptionId, providerPriceId: string(((object.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price?.id)), plan, status, trialEndsAt: date(object.trial_end), currentPeriodEnd: date(object.current_period_end), cancelAtPeriodEnd: Boolean(object.cancel_at_period_end), updatedAt: new Date().toISOString() };
  await db.insert(organizationSubscriptions).values({ id: crypto.randomUUID(), organizationId, ...values }).onConflictDoUpdate({ target: organizationSubscriptions.organizationId, set: values });
}

async function syncRefund(object: Record<string, unknown>) {
  const db = getDb();
  const refundId = string(object.id);
  if (!refundId) return false;
  const [event] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.externalReference, refundId), eq(paymentEvents.kind, "refund"))).limit(1);
  if (!event) return false;
  const providerStatus = string(object.status);
  const status = providerStatus === "succeeded" ? "succeeded" : ["failed", "canceled"].includes(providerStatus) ? "failed" : "pending";
  if (event.status === status) return true;
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, event.invoiceId), eq(invoices.organizationId, event.organizationId))).limit(1);
  if (!invoice) return false;
  const totals = await db.select({
    paid: sql<number>`coalesce(sum(case when ${paymentEvents.kind} = 'payment' and ${paymentEvents.status} = 'succeeded' then ${paymentEvents.amountCents} else 0 end), 0)`,
    refunded: sql<number>`coalesce(sum(case when ${paymentEvents.kind} = 'refund' and ${paymentEvents.status} = 'succeeded' then ${paymentEvents.amountCents} else 0 end), 0)`,
  }).from(paymentEvents).where(eq(paymentEvents.invoiceId, invoice.id));
  const amountPaidCents = Number(totals[0]?.paid || 0);
  const currentlyRefundedCents = Number(totals[0]?.refunded || 0);
  const amountRefundedCents = currentlyRefundedCents - (event.status === "succeeded" ? event.amountCents : 0) + (status === "succeeded" ? event.amountCents : 0);
  const now = new Date().toISOString();
  const claimInsert = db.insert(invoiceMutationClaims).values(mutationClaim({ organizationId: event.organizationId, invoiceId: invoice.id, expectedMutationVersion: invoice.mutationVersion, mutationType: "reconcile", idempotencyKey: `stripe-refund-sync:${refundId}:${status}` }));
  const eventUpdate = db.update(paymentEvents).set({ status }).where(and(eq(paymentEvents.id, event.id), eq(paymentEvents.status, event.status)));
  const invoiceUpdate = db.update(invoices).set({ amountPaidCents, amountRefundedCents, status: invoiceStatus(invoice.totalCents, amountPaidCents, amountRefundedCents), mutationVersion: invoice.mutationVersion + 1, updatedAt: now }).where(and(eq(invoices.id, invoice.id), eq(invoices.mutationVersion, invoice.mutationVersion)));
  const sessionUpdate = db.update(onlinePaymentSessions).set({ status: "refunded", updatedAt: now }).where(and(eq(onlinePaymentSessions.invoiceId, invoice.id), eq(onlinePaymentSessions.appointmentId, event.appointmentId), eq(onlinePaymentSessions.purpose, "deposit")));
  const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: event.organizationId, actorType: "system", action: `payment.refund_${status}`, entityType: "invoice", entityId: invoice.id, detailsJson: JSON.stringify({ refundId, paymentEventId: event.id, providerStatus }) });
  try {
    if (status === "succeeded") await db.batch([claimInsert, eventUpdate, invoiceUpdate, sessionUpdate, auditInsert]);
    else await db.batch([claimInsert, eventUpdate, invoiceUpdate, auditInsert]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const [current] = await db.select({ status: paymentEvents.status }).from(paymentEvents).where(eq(paymentEvents.id, event.id)).limit(1);
    if (current?.status !== status) throw new Error("Invoice changed while synchronizing a refund; retry the webhook.");
  }
  return true;
}

async function processEvent(event: StripeEvent) {
  const db = getDb(); const object = event.data?.object || {};
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    if (string(object.mode) === "subscription") await syncSubscription(object, object.metadata as Record<string, unknown>);
    else if (event.type === "checkout.session.async_payment_succeeded" || string(object.payment_status) === "paid") await completePayment(object);
  } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
    await releaseDepositSession(string(object.id), event.type.endsWith("expired") ? "expired" : "failed");
  } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) await syncSubscription(object);
  else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscriptionId = string(object.subscription); if (subscriptionId) await db.update(organizationSubscriptions).set({ status: event.type === "invoice.paid" ? "active" : "past_due", updatedAt: new Date().toISOString() }).where(eq(organizationSubscriptions.providerSubscriptionId, subscriptionId));
  } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) { if (!await syncRefund(object)) throw new Error("Refund ledger event is not available yet."); }
  else if (event.type === "account.updated") {
    const accountId = string(object.id); const active = Boolean(object.charges_enabled && object.payouts_enabled); await db.update(paymentProviderAccounts).set({ detailsSubmitted: Boolean(object.details_submitted), chargesEnabled: Boolean(object.charges_enabled), payoutsEnabled: Boolean(object.payouts_enabled), onboardingStatus: active ? "active" : object.details_submitted ? "restricted" : "pending", lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(paymentProviderAccounts.connectedAccountId, accountId));
  } else return false;
  return true;
}

export async function POST(request: Request) {
  const payload = await request.text(); const signature = request.headers.get("stripe-signature") || "";
  if (!await verifyStripeSignature(payload, signature)) return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  let event: StripeEvent; try { event = JSON.parse(payload) as StripeEvent; } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!event.id || !event.type) return Response.json({ error: "Invalid Stripe event." }, { status: 400 });
  const db = getDb(); const [existing] = await db.select({ status: providerWebhookEvents.status }).from(providerWebhookEvents).where(eq(providerWebhookEvents.id, event.id)).limit(1); if (existing?.status === "processed" || existing?.status === "ignored") return Response.json({ received: true });
  await db.insert(providerWebhookEvents).values({ id: event.id, eventType: event.type, livemode: Boolean(event.livemode), payloadHash: await sha256(payload) }).onConflictDoNothing();
  try { const handled = await processEvent(event); await db.update(providerWebhookEvents).set({ status: handled ? "processed" : "ignored", processedAt: new Date().toISOString(), error: "" }).where(eq(providerWebhookEvents.id, event.id)); return Response.json({ received: true }); }
  catch (error) { const message = (error instanceof Error ? error.message : "Webhook processing failed").slice(0, 500); await db.update(providerWebhookEvents).set({ status: "failed", error: message }).where(eq(providerWebhookEvents.id, event.id)); return Response.json({ error: message }, { status: 500 }); }
}
