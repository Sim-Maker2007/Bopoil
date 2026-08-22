import { and, desc, eq, gt } from "drizzle-orm";
import { appointments, clients, invoiceLineItems, invoices, locations, onlinePaymentSessions, paymentProviderAccounts, pets, services } from "../../../../db/schema";
import { calculateInvoice } from "../../../../lib/financial-ledger";
import { stripeConfig, stripeRequest } from "../../../../lib/stripe";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

function isConstraintError(error: unknown) {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "checkout");
    const body = await request.json() as Record<string, unknown>;
    const appointmentId = String(body.appointmentId || "");
    const purpose = body.purpose === "deposit" ? "deposit" : "invoice";
    const idempotencyKey = String(body.idempotencyKey || "");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new SalonAccessError("A valid checkout request key is required.", 400);
    const [duplicate] = await db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.organizationId, membership.organizationId), eq(onlinePaymentSessions.idempotencyKey, idempotencyKey))).limit(1);
    if (duplicate) return Response.json({ url: duplicate.checkoutUrl, session: duplicate });

    const [account] = await db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1);
    if (!stripeConfig().configured || !account?.chargesEnabled || !account.payoutsEnabled) throw new SalonAccessError("Finish Stripe payout onboarding before collecting online payments.", 409);
    const [row] = await db.select({ appointment: appointments, client: clients, petName: pets.name, serviceName: services.name, taxLabel: locations.taxLabel, taxRateBps: locations.taxRateBps }).from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id)).innerJoin(pets, eq(appointments.petId, pets.id)).innerJoin(services, eq(appointments.serviceId, services.id)).innerJoin(locations, eq(appointments.locationId, locations.id))
      .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, membership.organizationId), eq(appointments.locationId, membership.locationId))).limit(1);
    if (!row || ["cancelled", "no_show"].includes(row.appointment.status)) throw new SalonAccessError("This appointment cannot be paid online.", 409);

    let [invoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
    if (!invoice) {
      const discountCents = Number(body.discountCents || 0);
      const tipCents = Number(body.tipCents || 0);
      const discountReason = String(body.discountReason || "").trim();
      if (![discountCents, tipCents].every((value) => Number.isInteger(value) && value >= 0) || discountCents > row.appointment.priceEstimateCents) throw new SalonAccessError("Discount and tip amounts are invalid.", 400);
      if (discountCents > 0) {
        if (!discountReason) throw new SalonAccessError("Add a reason for the discount.", 400);
        requireSalonManager(membership);
      }
      const totals = calculateInvoice({ subtotalCents: row.appointment.priceEstimateCents, discountCents, taxRateBps: row.taxRateBps, tipCents });
      const id = crypto.randomUUID();
      const invoiceInsert = db.insert(invoices).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, appointmentId, invoiceNumber: `CC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`, subtotalCents: row.appointment.priceEstimateCents, discountCents, discountReason, taxLabel: row.taxLabel, taxRateBps: row.taxRateBps, taxCents: totals.taxCents, tipCents, totalCents: totals.totalCents, currency: row.appointment.currency }).returning();
      const lineInsert = db.insert(invoiceLineItems).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, invoiceId: id, kind: "service", description: `${row.serviceName} · ${row.petName}`, quantity: 1, unitPriceCents: row.appointment.priceEstimateCents, totalCents: row.appointment.priceEstimateCents });
      try {
        const [created] = await db.batch([invoiceInsert, lineInsert]);
        invoice = created[0];
      } catch (error) {
        if (!isConstraintError(error)) throw error;
        [invoice] = await db.select().from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
      }
      if (!invoice) throw new SalonAccessError("The invoice changed in another session. Refresh and try again.", 409);
    }

    const balanceCents = invoice.totalCents - invoice.amountPaidCents;
    if (balanceCents < 1) throw new SalonAccessError("This invoice is already paid.", 409);
    const amountCents = purpose === "deposit" ? Math.min(row.appointment.depositCents, balanceCents) : balanceCents;
    if (amountCents < 1) throw new SalonAccessError("This service does not require a deposit.", 409);
    const [openSession] = await db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.invoiceId, invoice.id), eq(onlinePaymentSessions.status, "open"), gt(onlinePaymentSessions.expiresAt, new Date().toISOString()))).orderBy(desc(onlinePaymentSessions.createdAt)).limit(1);
    if (openSession) {
      if (openSession.purpose === purpose && openSession.amountCents === amountCents) return Response.json({ url: openSession.checkoutUrl, session: openSession });
      throw new SalonAccessError("A different online payment link is already active for this invoice. Use it or wait for it to expire before creating another.", 409);
    }

    const applicationFeeCents = Math.min(amountCents - 1, Math.round(amountCents * stripeConfig().applicationFeeBps / 10_000));
    const origin = new URL(request.url).origin;
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const providerIdempotencyKey = `payment:${membership.organizationId}:${idempotencyKey}`;
    let providerSessionId = "";
    try {
      const session = await stripeRequest<{ id: string; url?: string; expires_at?: number }>("checkout/sessions", {
        mode: "payment", "line_items[0][price_data][currency]": invoice.currency.toLowerCase(), "line_items[0][price_data][product_data][name]": purpose === "deposit" ? `Deposit · ${row.petName} · ${row.serviceName}` : `Invoice ${invoice.invoiceNumber} · ${row.petName}`,
        "line_items[0][price_data][unit_amount]": amountCents, "line_items[0][quantity]": 1,
        ...(applicationFeeCents > 0 ? { "payment_intent_data[application_fee_amount]": applicationFeeCents } : {}),
        customer_email: row.client.email, success_url: `${origin}/salon?payment=success`, cancel_url: `${origin}/salon?payment=cancelled`, expires_at: expiresAtSeconds,
        "metadata[organization_id]": membership.organizationId, "metadata[location_id]": membership.locationId, "metadata[appointment_id]": appointmentId, "metadata[invoice_id]": invoice.id, "metadata[purpose]": purpose,
      }, { account: account.connectedAccountId, idempotencyKey: providerIdempotencyKey });
      providerSessionId = session.id;
      if (!providerSessionId || !session.url) throw new Error("Stripe did not return a secure checkout URL.");
      try {
        const [saved] = await db.insert(onlinePaymentSessions).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, clientId: row.client.id, appointmentId, invoiceId: invoice.id, purpose, providerSessionId, amountCents, applicationFeeCents, currency: invoice.currency, checkoutUrl: session.url, idempotencyKey, expiresAt: new Date((session.expires_at || expiresAtSeconds) * 1000).toISOString() }).returning();
        return Response.json({ url: session.url, session: saved });
      } catch (saveError) {
        const [sameProviderSession] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.providerSessionId, providerSessionId)).limit(1);
        if (sameProviderSession) return Response.json({ url: sameProviderSession.checkoutUrl, session: sameProviderSession });
        const [concurrent] = await db.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.invoiceId, invoice.id), eq(onlinePaymentSessions.status, "open"), gt(onlinePaymentSessions.expiresAt, new Date().toISOString()))).orderBy(desc(onlinePaymentSessions.createdAt)).limit(1);
        await stripeRequest(`checkout/sessions/${providerSessionId}/expire`, {}, { account: account.connectedAccountId }).catch((expireError) => console.error("Orphaned Stripe Checkout session could not be expired", expireError));
        providerSessionId = "";
        if (concurrent?.purpose === purpose && concurrent.amountCents === amountCents) return Response.json({ url: concurrent.checkoutUrl, session: concurrent });
        if (concurrent) throw new SalonAccessError("A different online payment link was created in another session. Use it or wait for it to expire.", 409);
        throw saveError;
      }
    } catch (error) {
      if (providerSessionId) await stripeRequest(`checkout/sessions/${providerSessionId}/expire`, {}, { account: account.connectedAccountId }).catch((expireError) => console.error("Incomplete Stripe Checkout session could not be expired", expireError));
      throw error;
    }
  } catch (error) {
    return salonApiError(error, "Secure checkout could not be created");
  }
}
