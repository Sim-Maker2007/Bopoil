import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { appointments, clients, expenseReceipts, expenses, invoices, locations, paymentEvents, pets } from "../../../../db/schema";
import { requireBookkeepingAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../salon-access";
import { expenseBookValues, signedLedgerAmount, summarizeBooks, toCsv } from "../../../../lib/accounting";
import { zonedDayBounds } from "../../../../lib/time-zone";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function dollars(cents: number) { return cents / 100; }
function validDate(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function rangeDays(from: string, to: string) { return Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1; }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const query = new URL(request.url).searchParams, from = String(query.get("from") || ""), to = String(query.get("to") || ""), kind = String(query.get("type") || "journal");
    if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > 366 || !["journal", "expenses", "summary"].includes(kind)) throw new SalonAccessError("Choose a valid export type and range of up to 366 days.", 400);
    const [location] = await db.select({ currency: locations.currency, timezone: locations.timezone, name: locations.name }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const start = zonedDayBounds(from, location.timezone).start, end = zonedDayBounds(to, location.timezone).end;
    const [payments, expenseRows] = await Promise.all([
      db.select({ id: paymentEvents.id, kind: paymentEvents.kind, method: paymentEvents.method, amountCents: paymentEvents.amountCents, taxAmountCents: paymentEvents.taxAmountCents, tipAmountCents: paymentEvents.tipAmountCents, externalReference: paymentEvents.externalReference, note: paymentEvents.note, occurredAt: paymentEvents.occurredAt, invoiceNumber: invoices.invoiceNumber, clientName: clients.fullName, petName: pets.name }).from(paymentEvents).innerJoin(invoices, eq(paymentEvents.invoiceId, invoices.id)).innerJoin(appointments, eq(paymentEvents.appointmentId, appointments.id)).innerJoin(clients, eq(appointments.clientId, clients.id)).innerJoin(pets, eq(appointments.petId, pets.id)).where(and(eq(paymentEvents.organizationId, membership.organizationId), eq(paymentEvents.locationId, membership.locationId), eq(paymentEvents.status, "succeeded"), gte(paymentEvents.occurredAt, start.toISOString()), lt(paymentEvents.occurredAt, end.toISOString()))),
      db.select().from(expenses).where(and(eq(expenses.organizationId, membership.organizationId), eq(expenses.locationId, membership.locationId), gte(expenses.paidOn, from), lte(expenses.paidOn, to))),
    ]);
    const receiptRows = expenseRows.length ? await db.select({ expenseId: expenseReceipts.expenseId }).from(expenseReceipts).where(and(eq(expenseReceipts.organizationId, membership.organizationId), eq(expenseReceipts.locationId, membership.locationId), inArray(expenseReceipts.expenseId, expenseRows.map((expense) => expense.id)))) : [];
    const activeExpenses = expenseRows.filter((expense) => expense.status === "posted"), metrics = summarizeBooks(payments, activeExpenses);
    let csv: string;
    if (kind === "expenses") {
      csv = toCsv(["Paid date", "Incurred date", "Vendor", "Description", "Category", "Treatment", "Payment method", "Reference", "Total paid", "Tax paid", "Recoverable tax", "Business use %", "Operating expense", "Input tax credit", "Capital purchase", "Non-deductible", "Receipt count", "Status", "Void reason", "Currency"], expenseRows.map((expense) => { const values = expenseBookValues(expense); return [expense.paidOn, expense.incurredOn, expense.vendor, expense.description, expense.category, expense.treatment, expense.paymentMethod, expense.reference, dollars(expense.amountCents), dollars(expense.taxAmountCents), expense.recoverableTax ? "yes" : "no", expense.businessUseBps / 100, dollars(values.operatingExpenseCents), dollars(values.inputTaxCreditCents), dollars(values.capitalPurchaseCents), dollars(values.nonDeductibleCents), receiptRows.filter((receipt) => receipt.expenseId === expense.id).length, expense.status, expense.voidReason, expense.currency]; }));
    } else if (kind === "summary") {
      csv = toCsv(["Metric", "Amount", "Currency", "From", "To"], [["Net collected", dollars(metrics.netCollectedCents), location.currency, from, to], ["Net sales before operating expenses", dollars(metrics.netSalesCents), location.currency, from, to], ["Sales tax recorded", dollars(metrics.salesTaxCents), location.currency, from, to], ["Input tax credits marked recoverable", dollars(metrics.inputTaxCreditsCents), location.currency, from, to], ["Estimated net sales tax", dollars(metrics.estimatedNetTaxCents), location.currency, from, to], ["Tips held", dollars(metrics.tipsCents), location.currency, from, to], ["Operating expenses", dollars(metrics.operatingExpensesCents), location.currency, from, to], ["Capital purchases", dollars(metrics.capitalPurchasesCents), location.currency, from, to], ["Non-deductible business-use amount", dollars(metrics.nonDeductibleCents), location.currency, from, to], ["Estimated operating profit", dollars(metrics.estimatedOperatingProfitCents), location.currency, from, to]]);
    } else {
      const paymentRows = payments.map((payment) => { const sign = payment.kind === "refund" ? -1 : 1; return { sort: payment.occurredAt, row: [payment.occurredAt, payment.kind, payment.invoiceNumber, payment.clientName, `${payment.petName}${payment.note ? ` · ${payment.note}` : ""}`, payment.method, dollars(signedLedgerAmount(payment.kind, payment.amountCents)), dollars(sign * (payment.amountCents - payment.taxAmountCents - payment.tipAmountCents)), dollars(sign * payment.taxAmountCents), dollars(sign * payment.tipAmountCents), 0, 0, 0, 0, location.currency] }; });
      const costRows = activeExpenses.map((expense) => { const values = expenseBookValues(expense); return { sort: `${expense.paidOn}T12:00:00.000Z`, row: [expense.paidOn, "expense", expense.reference || expense.id, expense.vendor, expense.description, expense.paymentMethod, dollars(-expense.amountCents), 0, 0, 0, dollars(values.operatingExpenseCents), dollars(values.inputTaxCreditCents), dollars(values.capitalPurchaseCents), dollars(values.nonDeductibleCents), expense.currency] }; });
      csv = toCsv(["Date", "Entry type", "Source", "Client or vendor", "Description", "Method", "Cash movement", "Net sales", "Sales tax", "Tips", "Operating expense", "Input tax credit", "Capital purchase", "Non-deductible", "Currency"], [...paymentRows, ...costRows].sort((left, right) => left.sort.localeCompare(right.sort)).map((entry) => entry.row));
    }
    const filename = `coat-care-${kind}-${from}-to-${to}.csv`;
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Accounting export unavailable"); }
}
