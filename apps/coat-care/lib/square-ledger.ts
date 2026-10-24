import { and, desc, eq, gte, lt } from "drizzle-orm";
import { clients, squarePayments, squareRefunds } from "../db/schema";
import type { Db } from "./square-links";
import { tenderLabel } from "./square-plan";

export { tenderLabel };

// Reads the mirrored Square money the way the finance and reporting views
// need it: a day or a range of completed payments and refunds with totals by
// tender, and the same rows shaped as ledger entries for the analytics.

export type SquareLedgerScope = { organizationId: string; locationId: string };

export async function squareSalesBetween(db: Db, scope: SquareLedgerScope, startIso: string, endIso: string) {
  const [payments, refunds] = await Promise.all([
    db.select({
      id: squarePayments.id, status: squarePayments.status, sourceType: squarePayments.sourceType, cardBrand: squarePayments.cardBrand, cardLast4: squarePayments.cardLast4, walletBrand: squarePayments.walletBrand,
      amountCents: squarePayments.amountCents, tipCents: squarePayments.tipCents, totalCents: squarePayments.totalCents, processingFeeCents: squarePayments.processingFeeCents, refundedCents: squarePayments.refundedCents, taxCents: squarePayments.taxCents, currency: squarePayments.currency,
      receiptNumber: squarePayments.receiptNumber, receiptUrl: squarePayments.receiptUrl, note: squarePayments.note, applicationName: squarePayments.applicationName, clientId: squarePayments.clientId, customerId: squarePayments.customerId, squareCreatedAt: squarePayments.squareCreatedAt,
      clientName: clients.fullName,
    }).from(squarePayments).leftJoin(clients, eq(squarePayments.clientId, clients.id)).where(and(
      eq(squarePayments.organizationId, scope.organizationId), eq(squarePayments.locationId, scope.locationId),
      gte(squarePayments.squareCreatedAt, startIso), lt(squarePayments.squareCreatedAt, endIso),
    )).orderBy(desc(squarePayments.squareCreatedAt)).limit(1000),
    db.select({ id: squareRefunds.id, paymentId: squareRefunds.paymentId, status: squareRefunds.status, amountCents: squareRefunds.amountCents, reason: squareRefunds.reason, currency: squareRefunds.currency, squareCreatedAt: squareRefunds.squareCreatedAt })
      .from(squareRefunds).where(and(
        eq(squareRefunds.organizationId, scope.organizationId), eq(squareRefunds.locationId, scope.locationId),
        gte(squareRefunds.squareCreatedAt, startIso), lt(squareRefunds.squareCreatedAt, endIso),
      )).orderBy(desc(squareRefunds.squareCreatedAt)).limit(500),
  ]);
  const completed = payments.filter((payment) => payment.status === "COMPLETED");
  const settledRefunds = refunds.filter((refund) => ["COMPLETED", "PENDING"].includes(refund.status));
  const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const byTender: Record<string, number> = {};
  for (const payment of completed) {
    const label = tenderLabel(payment);
    byTender[label] = (byTender[label] || 0) + payment.totalCents;
  }
  const grossCents = sum(completed, (payment) => payment.totalCents);
  const refundsCents = sum(settledRefunds, (refund) => refund.amountCents);
  const tipsCents = sum(completed, (payment) => payment.tipCents);
  const taxCents = sum(completed, (payment) => payment.taxCents);
  return {
    payments: completed.map((payment) => ({ ...payment, tender: tenderLabel(payment) })),
    refunds: settledRefunds,
    totals: {
      count: completed.length,
      grossCents,
      tipsCents,
      taxCents,
      feesCents: sum(completed, (payment) => payment.processingFeeCents),
      refundsCents,
      netCents: grossCents - refundsCents,
      netSalesCents: grossCents - refundsCents - tipsCents - taxCents,
    },
    byTender,
  };
}

// Square money as analytics ledger rows. A payment stands on its own ticket
// (there is no Coat & Care invoice behind it); a refund is tied to its payment
// so net sales and refunds line up, with the payment's tax share removed in
// proportion to the amount returned.
export async function squareAnalyticsPayments(db: Db, scope: SquareLedgerScope, startIso: string, endIso: string) {
  const [payments, refunds] = await Promise.all([
    db.select({ id: squarePayments.id, amountCents: squarePayments.amountCents, tipCents: squarePayments.tipCents, totalCents: squarePayments.totalCents, taxCents: squarePayments.taxCents, squareCreatedAt: squarePayments.squareCreatedAt })
      .from(squarePayments).where(and(eq(squarePayments.organizationId, scope.organizationId), eq(squarePayments.locationId, scope.locationId), eq(squarePayments.status, "COMPLETED"), gte(squarePayments.squareCreatedAt, startIso), lt(squarePayments.squareCreatedAt, endIso))),
    db.select({ id: squareRefunds.id, paymentId: squareRefunds.paymentId, status: squareRefunds.status, amountCents: squareRefunds.amountCents, squareCreatedAt: squareRefunds.squareCreatedAt, paymentAmountCents: squarePayments.amountCents, paymentTaxCents: squarePayments.taxCents })
      .from(squareRefunds).leftJoin(squarePayments, eq(squareRefunds.paymentId, squarePayments.id)).where(and(eq(squareRefunds.organizationId, scope.organizationId), eq(squareRefunds.locationId, scope.locationId), gte(squareRefunds.squareCreatedAt, startIso), lt(squareRefunds.squareCreatedAt, endIso))),
  ]);
  type LedgerRow = { locationId: string; appointmentId: string; kind: "payment" | "refund"; amountCents: number; taxAmountCents: number; tipAmountCents: number; occurredAt: string };
  const rows: LedgerRow[] = payments.map((payment) => ({ locationId: scope.locationId, appointmentId: `square:${payment.id}`, kind: "payment" as const, amountCents: payment.totalCents, taxAmountCents: payment.taxCents, tipAmountCents: payment.tipCents, occurredAt: payment.squareCreatedAt }));
  for (const refund of refunds) {
    if (!["COMPLETED", "PENDING"].includes(refund.status)) continue;
    const base = Math.max(1, refund.paymentAmountCents || refund.amountCents);
    rows.push({ locationId: scope.locationId, appointmentId: `square:${refund.paymentId}`, kind: "refund" as const, amountCents: refund.amountCents, taxAmountCents: Math.round((refund.paymentTaxCents || 0) * Math.min(1, refund.amountCents / base)), tipAmountCents: 0, occurredAt: refund.squareCreatedAt });
  }
  return rows;
}
