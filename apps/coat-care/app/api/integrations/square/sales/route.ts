import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { clients, locations, squareOrders, squarePayments, squareRefunds } from "../../../../../db/schema";
import { tenderLabel } from "../../../../../lib/square-ledger";
import { dateKeyInZone, zonedDayBounds } from "../../../../../lib/time-zone";
import { requireFinancialAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../../salon-access";

// Square sales for a date range in the salon's time zone: every payment with
// its tender, tip, tax share, fee and receipt, every refund, and the totals the
// owner reconciles against Square's own reports.

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: string) { return dayPattern.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)); }
function parse<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireFinancialAccess(membership);
    const [location] = await db.select({ timezone: locations.timezone, currency: locations.currency }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const params = new URL(request.url).searchParams;
    const today = dateKeyInZone(new Date(), location.timezone);
    const to = params.get("to") || today;
    const from = params.get("from") || new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const query = params.get("query")?.trim().slice(0, 80).toLowerCase() || "";
    if (!validDay(from) || !validDay(to) || from > to) throw new SalonAccessError("Choose a valid date range.", 400);
    if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000 > 400) throw new SalonAccessError("Choose a range of at most 400 days.", 400);
    const start = zonedDayBounds(from, location.timezone).start.toISOString();
    const end = zonedDayBounds(to, location.timezone).end.toISOString();
    const scope = and(eq(squarePayments.organizationId, membership.organizationId), eq(squarePayments.locationId, membership.locationId), gte(squarePayments.squareCreatedAt, start), lt(squarePayments.squareCreatedAt, end));
    const [payments, refunds] = await Promise.all([
      db.select({
        id: squarePayments.id, status: squarePayments.status, sourceType: squarePayments.sourceType, cardBrand: squarePayments.cardBrand, cardLast4: squarePayments.cardLast4, walletBrand: squarePayments.walletBrand, entryMethod: squarePayments.entryMethod,
        amountCents: squarePayments.amountCents, tipCents: squarePayments.tipCents, totalCents: squarePayments.totalCents, processingFeeCents: squarePayments.processingFeeCents, refundedCents: squarePayments.refundedCents, taxCents: squarePayments.taxCents, discountCents: squarePayments.discountCents, currency: squarePayments.currency,
        receiptNumber: squarePayments.receiptNumber, receiptUrl: squarePayments.receiptUrl, note: squarePayments.note, applicationName: squarePayments.applicationName, deviceName: squarePayments.deviceName, customerId: squarePayments.customerId, clientId: squarePayments.clientId, staffId: squarePayments.staffId, orderId: squarePayments.orderId, squareCreatedAt: squarePayments.squareCreatedAt,
        clientName: clients.fullName, sourceName: squareOrders.sourceName, lineItemsJson: squareOrders.lineItemsJson,
      }).from(squarePayments).leftJoin(clients, eq(squarePayments.clientId, clients.id)).leftJoin(squareOrders, eq(squarePayments.orderId, squareOrders.id)).where(and(
        scope,
        query ? or(
          sql`strpos(lower(coalesce(${clients.fullName}, '')), ${query}) > 0`,
          sql`strpos(lower(${squarePayments.receiptNumber}), ${query}) > 0`,
          sql`strpos(lower(${squarePayments.note}), ${query}) > 0`,
          sql`strpos(lower(coalesce(${squareOrders.lineItemsJson}, '')), ${query}) > 0`,
          sql`strpos(lower(${squarePayments.cardLast4}), ${query}) > 0`,
        ) : undefined,
      )).orderBy(desc(squarePayments.squareCreatedAt)).limit(600),
      db.select().from(squareRefunds).where(and(eq(squareRefunds.organizationId, membership.organizationId), eq(squareRefunds.locationId, membership.locationId), gte(squareRefunds.squareCreatedAt, start), lt(squareRefunds.squareCreatedAt, end))).orderBy(desc(squareRefunds.squareCreatedAt)).limit(300),
    ]);
    const completed = payments.filter((payment) => payment.status === "COMPLETED");
    const completedRefunds = refunds.filter((refund) => ["COMPLETED", "PENDING"].includes(refund.status));
    const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const byTender = new Map<string, { label: string; count: number; amountCents: number }>();
    const bySource = new Map<string, { label: string; count: number; amountCents: number }>();
    const byDay = new Map<string, { day: string; amountCents: number; count: number }>();
    for (const payment of completed) {
      const tender = tenderLabel(payment);
      byTender.set(tender, { label: tender, count: (byTender.get(tender)?.count || 0) + 1, amountCents: (byTender.get(tender)?.amountCents || 0) + payment.totalCents });
      const source = payment.sourceName || payment.applicationName || "Square";
      bySource.set(source, { label: source, count: (bySource.get(source)?.count || 0) + 1, amountCents: (bySource.get(source)?.amountCents || 0) + payment.totalCents });
      const day = dateKeyInZone(new Date(payment.squareCreatedAt), location.timezone);
      byDay.set(day, { day, amountCents: (byDay.get(day)?.amountCents || 0) + payment.totalCents, count: (byDay.get(day)?.count || 0) + 1 });
    }
    const grossCents = sum(completed, (payment) => payment.totalCents);
    const refundsCents = sum(completedRefunds, (refund) => refund.amountCents);
    return Response.json({
      range: { from, to },
      location,
      totals: {
        payments: completed.length,
        grossCents,
        tipsCents: sum(completed, (payment) => payment.tipCents),
        taxCents: sum(completed, (payment) => payment.taxCents),
        discountCents: sum(completed, (payment) => payment.discountCents),
        feesCents: sum(completed, (payment) => payment.processingFeeCents),
        refundsCents,
        netCents: grossCents - refundsCents,
        netSalesCents: grossCents - refundsCents - sum(completed, (payment) => payment.tipCents) - sum(completed, (payment) => payment.taxCents),
        otherStatuses: payments.length - completed.length,
      },
      byTender: [...byTender.values()].sort((a, b) => b.amountCents - a.amountCents),
      bySource: [...bySource.values()].sort((a, b) => b.amountCents - a.amountCents),
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      payments: payments.map((payment) => ({ ...payment, tender: tenderLabel(payment), lineItems: parse<Array<{ name: string; quantity: string; variationName: string; totalCents: number }>>(payment.lineItemsJson || "[]", []) })),
      refunds,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square sales unavailable.");
  }
}
