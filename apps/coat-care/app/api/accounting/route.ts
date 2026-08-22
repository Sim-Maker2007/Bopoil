import { and, asc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { auditEvents, expenseReceipts, expenses, locations, paymentEvents } from "../../../db/schema";
import { requireBookkeepingAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../salon-access";
import { dateKeyInZone, zonedDayBounds } from "../../../lib/time-zone";
import { expenseBookValues, summarizeBooks } from "../../../lib/accounting";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = ["grooming_supplies", "retail_inventory", "equipment", "rent", "utilities", "payroll", "marketing", "insurance", "professional_fees", "merchant_fees", "travel", "repairs", "education", "other"] as const;
const treatments = ["operating", "capital", "non_deductible"] as const;
const methods = ["cash", "credit_card", "debit_card", "bank_transfer", "e_transfer", "other"] as const;

function validDate(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function rangeDays(from: string, to: string) { return Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1; }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const permittedIds = membership.locations.map((item) => item.locationId);
    const locationRows = await db.select({ id: locations.id, name: locations.name, currency: locations.currency, timezone: locations.timezone, taxLabel: locations.taxLabel }).from(locations).where(and(eq(locations.organizationId, membership.organizationId), inArray(locations.id, permittedIds)));
    const [location] = locationRows.filter((item) => item.id === membership.locationId);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const today = dateKeyInZone(new Date(), location.timezone), requested = new URL(request.url).searchParams;
    const from = requested.get("from") || `${today.slice(0, 8)}01`, to = requested.get("to") || today, scope = requested.get("scope") === "all" ? "all" : "current";
    if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > 366) throw new SalonAccessError("Choose a bookkeeping range of up to 366 days.", 400);
    const bounds = { start: zonedDayBounds(from, location.timezone).start, end: zonedDayBounds(to, location.timezone).end }, scopedIds = scope === "all" ? permittedIds : [membership.locationId];
    const [payments, expenseRows] = await Promise.all([
      db.select({ locationId: paymentEvents.locationId, occurredAt: paymentEvents.occurredAt, kind: paymentEvents.kind, method: paymentEvents.method, amountCents: paymentEvents.amountCents, taxAmountCents: paymentEvents.taxAmountCents, tipAmountCents: paymentEvents.tipAmountCents }).from(paymentEvents).where(and(eq(paymentEvents.organizationId, membership.organizationId), inArray(paymentEvents.locationId, scopedIds), eq(paymentEvents.status, "succeeded"), gte(paymentEvents.occurredAt, bounds.start.toISOString()), lt(paymentEvents.occurredAt, bounds.end.toISOString()))),
      db.select().from(expenses).where(and(eq(expenses.organizationId, membership.organizationId), inArray(expenses.locationId, scopedIds), gte(expenses.paidOn, from), lte(expenses.paidOn, to))).orderBy(asc(expenses.paidOn), asc(expenses.createdAt)),
    ]);
    const activeExpenses = expenseRows.filter((expense) => expense.status === "posted");
    const receiptRows = expenseRows.length ? await db.select({ id: expenseReceipts.id, expenseId: expenseReceipts.expenseId, originalFilename: expenseReceipts.originalFilename, mimeType: expenseReceipts.mimeType, sizeBytes: expenseReceipts.sizeBytes, createdAt: expenseReceipts.createdAt }).from(expenseReceipts).where(and(eq(expenseReceipts.organizationId, membership.organizationId), eq(expenseReceipts.locationId, membership.locationId), inArray(expenseReceipts.expenseId, expenseRows.map((expense) => expense.id)))) : [];
    const metrics = summarizeBooks(payments, activeExpenses);
    const splitTax = (total: number, gst = 0, qst = 0) => gst || qst ? { gst, qst } : { gst: Math.round(total * 5000 / 14975), qst: total - Math.round(total * 5000 / 14975) };
    const signed = (kind: "payment" | "refund", value: number) => kind === "refund" ? -value : value;
    const gstCollectedCents = payments.reduce((sum, payment) => sum + signed(payment.kind, splitTax(payment.taxAmountCents).gst), 0), qstCollectedCents = metrics.salesTaxCents - gstCollectedCents;
    const gstInputCreditsCents = activeExpenses.reduce((sum, expense) => { const split = splitTax(expense.taxAmountCents, expense.gstAmountCents, expense.qstAmountCents); return sum + (expense.recoverableTax ? Math.round(split.gst * expense.businessUseBps / 10_000) : 0); }, 0);
    const qstInputCreditsCents = activeExpenses.reduce((sum, expense) => { const split = splitTax(expense.taxAmountCents, expense.gstAmountCents, expense.qstAmountCents); return sum + (expense.recoverableTax ? Math.round(split.qst * expense.businessUseBps / 10_000) : 0); }, 0);
    const monthKeys = Array.from(new Set([...payments.map((item) => item.occurredAt.slice(0, 7)), ...activeExpenses.map((item) => item.paidOn.slice(0, 7))])).sort();
    const timeline = monthKeys.map((month) => { const monthPayments = payments.filter((item) => item.occurredAt.startsWith(month)), monthExpenses = activeExpenses.filter((item) => item.paidOn.startsWith(month)), income = summarizeBooks(monthPayments, monthExpenses); return { month, incomeCents: income.netSalesCents, expenseCents: income.operatingExpensesCents, profitCents: income.estimatedOperatingProfitCents }; });
    const incomeByMethod = ["cash", "card_terminal", "e_transfer", "external"].map((method) => ({ method, amountCents: payments.filter((item) => item.method === method).reduce((sum, item) => sum + signed(item.kind, item.amountCents), 0) })).filter((item) => item.amountCents !== 0);
    const byLocation = scopedIds.map((locationId) => { const row = locationRows.find((item) => item.id === locationId), summary = summarizeBooks(payments.filter((item) => item.locationId === locationId), activeExpenses.filter((item) => item.locationId === locationId)); return { locationId, name: row?.name || "Emplacement", netSalesCents: summary.netSalesCents, expensesCents: summary.operatingExpensesCents, profitCents: summary.estimatedOperatingProfitCents }; });
    const byCategory = categories.map((category) => ({ category, amountCents: activeExpenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expenseBookValues(expense).operatingExpenseCents, 0), entries: activeExpenses.filter((expense) => expense.category === category).length })).filter((item) => item.entries > 0);
    return Response.json({ range: { from, to }, scope, location: { ...location, name: scope === "all" ? "Tous les emplacements" : location.name }, locations: locationRows.map(({ id, name }) => ({ id, name })), metrics: { ...metrics, gstCollectedCents, qstCollectedCents, gstInputCreditsCents, qstInputCreditsCents, estimatedNetGstCents: gstCollectedCents - gstInputCreditsCents, estimatedNetQstCents: qstCollectedCents - qstInputCreditsCents }, timeline, incomeByMethod, byLocation, byCategory, expenses: expenseRows.map((expense) => ({ ...expense, locationName: locationRows.find((item) => item.id === expense.locationId)?.name || "", bookValues: expenseBookValues(expense), receipts: receiptRows.filter((receipt) => receipt.expenseId === expense.id).map((receipt) => ({ ...receipt, url: `/api/accounting/receipts/${receipt.id}` })) })), canManage: ["owner", "manager", "accountant"].includes(membership.role), disclaimer: "Outil de gestion seulement. Confirmez les montants de TPS/TVQ, crédits de taxe et déclarations avec votre comptable." });
  } catch (error) { return salonApiError(error, "Books unavailable"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const body = await request.json() as Record<string, unknown>;
    const vendor = String(body.vendor || "").trim().slice(0, 160), description = String(body.description || "").trim().slice(0, 500), category = String(body.category || "") as typeof categories[number], treatment = String(body.treatment || "operating") as typeof treatments[number], paymentMethod = String(body.paymentMethod || "") as typeof methods[number];
    const amountCents = Number(body.amountCents), gstAmountCents = Number(body.gstAmountCents || 0), qstAmountCents = Number(body.qstAmountCents || 0), taxAmountCents = gstAmountCents + qstAmountCents || Number(body.taxAmountCents || 0), businessUseBps = Number(body.businessUseBps ?? 10_000), incurredOn = String(body.incurredOn || ""), paidOn = String(body.paidOn || incurredOn), reference = String(body.reference || "").trim().slice(0, 160), recoverableTax = body.recoverableTax === true, idempotencyKey = String(body.idempotencyKey || "").trim().slice(0, 120);
    if (!vendor || !description || !categories.includes(category) || !treatments.includes(treatment) || !methods.includes(paymentMethod) || !validDate(incurredOn) || !validDate(paidOn) || !idempotencyKey) throw new SalonAccessError("Complete the vendor, description, classification, payment method, dates, and request key.", 400);
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100_000_000 || !Number.isInteger(gstAmountCents) || !Number.isInteger(qstAmountCents) || gstAmountCents < 0 || qstAmountCents < 0 || !Number.isInteger(taxAmountCents) || taxAmountCents < 0 || taxAmountCents > amountCents || !Number.isInteger(businessUseBps) || businessUseBps < 1 || businessUseBps > 10_000) throw new SalonAccessError("Entrez des montants valides pour la dépense, la TPS, la TVQ et l’usage commercial.", 400);
    const [location] = await db.select({ currency: locations.currency, timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    if (incurredOn > dateKeyInZone(new Date(), location.timezone) || paidOn > dateKeyInZone(new Date(), location.timezone)) throw new SalonAccessError("Future expenses belong in payables, not the posted cash book.", 400);
    let [expense] = await db.insert(expenses).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, vendor, description, category, treatment, paymentMethod, amountCents, taxAmountCents, gstAmountCents, qstAmountCents, recoverableTax, businessUseBps, currency: location.currency, incurredOn, paidOn, reference, idempotencyKey, enteredByStaffId: membership.id }).onConflictDoNothing().returning();
    const created = Boolean(expense);
    if (!expense) [expense] = await db.select().from(expenses).where(and(eq(expenses.organizationId, membership.organizationId), eq(expenses.locationId, membership.locationId), eq(expenses.idempotencyKey, idempotencyKey))).limit(1);
    if (!expense) throw new SalonAccessError("This expense request conflicts with another location.", 409);
    if (created) await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "expense.posted", entityType: "expense", entityId: expense.id, detailsJson: JSON.stringify({ amountCents, taxAmountCents, gstAmountCents, qstAmountCents, category, treatment, paidOn, recoverableTax, businessUseBps }) });
    return Response.json({ expense: { ...expense, bookValues: expenseBookValues(expense), receipts: [] } }, { status: created ? 201 : 200 });
  } catch (error) { return salonApiError(error, "Expense could not be posted"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const body = await request.json() as { expenseId?: string; action?: string; reason?: string };
    if (body.action !== "void") throw new SalonAccessError("Choose a valid expense action.", 400);
    const expenseId = String(body.expenseId || ""), reason = String(body.reason || "").trim().slice(0, 500);
    if (reason.length < 3) throw new SalonAccessError("Explain why this expense is being voided.", 400);
    const now = new Date().toISOString();
    const [expense] = await db.update(expenses).set({ status: "void", voidReason: reason, voidedByStaffId: membership.id, voidedAt: now, updatedAt: now }).where(and(eq(expenses.id, expenseId), eq(expenses.organizationId, membership.organizationId), eq(expenses.locationId, membership.locationId), eq(expenses.status, "posted"))).returning();
    if (!expense) throw new SalonAccessError("Expense not found or already voided.", 409);
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "expense.voided", entityType: "expense", entityId: expense.id, detailsJson: JSON.stringify({ reason, amountCents: expense.amountCents }) });
    return Response.json({ expense });
  } catch (error) { return salonApiError(error, "Expense could not be voided"); }
}
