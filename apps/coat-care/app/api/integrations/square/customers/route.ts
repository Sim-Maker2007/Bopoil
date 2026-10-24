import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { appointments, clients, pets, squareBookings, squareCustomers, squareOrders, squarePayments } from "../../../../../db/schema";
import { squareCustomerName } from "../../../../../lib/square-data-sync";
import { requireSalonAccess, requireWorkspacePermission, salonApiError } from "../../../../salon-access";

// The Square customer directory as the salon sees it: every customer Square
// holds, the Coat & Care client each one is linked to, and what they have
// spent. With ?id= the full record follows: Square note, address, every
// payment with its order lines, and every Square booking.

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const params = new URL(request.url).searchParams;
    const customerId = params.get("id")?.trim().slice(0, 80) || "";
    const query = params.get("query")?.trim().slice(0, 80).toLowerCase() || "";
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 60)));
    const includeDeleted = params.get("deleted") === "true";
    const scope = eq(squareCustomers.organizationId, membership.organizationId);
    const rows = await db.select({
      id: squareCustomers.id, clientId: squareCustomers.clientId, givenName: squareCustomers.givenName, familyName: squareCustomers.familyName, companyName: squareCustomers.companyName, nickname: squareCustomers.nickname,
      emailAddress: squareCustomers.emailAddress, phoneNumber: squareCustomers.phoneNumber, note: squareCustomers.note, referenceId: squareCustomers.referenceId, birthday: squareCustomers.birthday, addressJson: squareCustomers.addressJson,
      creationSource: squareCustomers.creationSource, emailUnsubscribed: squareCustomers.emailUnsubscribed, groupIdsJson: squareCustomers.groupIdsJson, squareCreatedAt: squareCustomers.squareCreatedAt, squareUpdatedAt: squareCustomers.squareUpdatedAt, deleted: squareCustomers.deleted, syncedAt: squareCustomers.syncedAt,
      clientName: clients.fullName, clientEmail: clients.email, clientPhone: clients.phone,
    }).from(squareCustomers).leftJoin(clients, eq(squareCustomers.clientId, clients.id)).where(and(
      scope,
      customerId ? eq(squareCustomers.id, customerId) : undefined,
      includeDeleted || customerId ? undefined : eq(squareCustomers.deleted, false),
      query ? or(
        sql`strpos(lower(${squareCustomers.givenName} || ' ' || ${squareCustomers.familyName} || ' ' || ${squareCustomers.companyName} || ' ' || ${squareCustomers.nickname}), ${query}) > 0`,
        sql`strpos(lower(${squareCustomers.emailAddress}), ${query}) > 0`,
        sql`strpos(${squareCustomers.phoneNumber}, ${query}) > 0`,
        sql`strpos(regexp_replace(${squareCustomers.phoneNumber}, '\\D', '', 'g'), ${query.replace(/\D/g, "") || "§"}) > 0`,
        sql`strpos(lower(${squareCustomers.note}), ${query}) > 0`,
        sql`strpos(lower(${squareCustomers.referenceId}), ${query}) > 0`,
      ) : undefined,
    )).orderBy(desc(squareCustomers.squareCreatedAt)).limit(customerId ? 1 : limit);
    const ids = rows.map((row) => row.id);
    const spend = ids.length ? await db.select({
      customerId: squarePayments.customerId,
      paymentCount: sql<number>`count(*)`.mapWith(Number),
      grossCents: sql<number>`coalesce(sum(${squarePayments.totalCents}), 0)`.mapWith(Number),
      refundedCents: sql<number>`coalesce(sum(${squarePayments.refundedCents}), 0)`.mapWith(Number),
      lastPaymentAt: sql<string>`max(${squarePayments.squareCreatedAt})`,
      firstPaymentAt: sql<string>`min(${squarePayments.squareCreatedAt})`,
    }).from(squarePayments).where(and(eq(squarePayments.organizationId, membership.organizationId), eq(squarePayments.status, "COMPLETED"), inArray(squarePayments.customerId, ids))).groupBy(squarePayments.customerId) : [];
    const spendById = new Map(spend.map((item) => [item.customerId, item]));
    const customers = rows.map((row) => ({
      ...row,
      displayName: squareCustomerName(row),
      address: parse<Record<string, string>>(row.addressJson, {}),
      groupIds: parse<string[]>(row.groupIdsJson, []),
      spend: spendById.get(row.id) || { paymentCount: 0, grossCents: 0, refundedCents: 0, lastPaymentAt: null, firstPaymentAt: null },
    }));
    if (!customerId) return Response.json({ customers }, { headers: { "cache-control": "private, no-store" } });
    const customer = customers[0];
    if (!customer) return Response.json({ error: "Square customer not found." }, { status: 404 });
    const [payments, bookings] = await Promise.all([
      db.select({
        id: squarePayments.id, status: squarePayments.status, sourceType: squarePayments.sourceType, cardBrand: squarePayments.cardBrand, cardLast4: squarePayments.cardLast4, amountCents: squarePayments.amountCents, tipCents: squarePayments.tipCents, totalCents: squarePayments.totalCents, refundedCents: squarePayments.refundedCents, taxCents: squarePayments.taxCents, currency: squarePayments.currency,
        receiptNumber: squarePayments.receiptNumber, receiptUrl: squarePayments.receiptUrl, note: squarePayments.note, applicationName: squarePayments.applicationName, squareCreatedAt: squarePayments.squareCreatedAt, orderId: squarePayments.orderId, sourceName: squareOrders.sourceName, lineItemsJson: squareOrders.lineItemsJson,
      }).from(squarePayments).leftJoin(squareOrders, eq(squarePayments.orderId, squareOrders.id)).where(and(eq(squarePayments.organizationId, membership.organizationId), eq(squarePayments.customerId, customer.id))).orderBy(desc(squarePayments.squareCreatedAt)).limit(200),
      db.select({
        id: squareBookings.id, status: squareBookings.status, source: squareBookings.source, startAt: squareBookings.startAt, durationMinutes: squareBookings.durationMinutes, sellerNote: squareBookings.sellerNote, customerNote: squareBookings.customerNote, creatorType: squareBookings.creatorType, appointmentId: squareBookings.appointmentId,
        appointmentStatus: appointments.status, petName: pets.name,
      }).from(squareBookings).leftJoin(appointments, eq(squareBookings.appointmentId, appointments.id)).leftJoin(pets, eq(appointments.petId, pets.id)).where(and(eq(squareBookings.organizationId, membership.organizationId), eq(squareBookings.customerId, customer.id))).orderBy(desc(squareBookings.startAt)).limit(200),
    ]);
    return Response.json({
      customer,
      payments: payments.map((payment) => ({ ...payment, lineItems: parse<Array<{ name: string; quantity: string; variationName: string; totalCents: number }>>(payment.lineItemsJson || "[]", []) })),
      bookings,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square customers unavailable.");
  }
}
