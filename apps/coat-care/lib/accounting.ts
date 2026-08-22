export type PaymentLedgerRow = { kind: "payment" | "refund"; method: string; amountCents: number; taxAmountCents: number; tipAmountCents: number };
export type ExpenseBookRow = { amountCents: number; taxAmountCents: number; recoverableTax: boolean; businessUseBps: number; treatment: "operating" | "capital" | "non_deductible" };

export function signedLedgerAmount(kind: "payment" | "refund", amountCents: number) { return kind === "refund" ? -amountCents : amountCents; }

export function summarizePayments(rows: PaymentLedgerRow[]) {
  const methods = ["cash", "card_terminal", "e_transfer", "external"];
  const netCollectedCents = rows.reduce((sum, row) => sum + signedLedgerAmount(row.kind, row.amountCents), 0);
  const salesTaxCents = rows.reduce((sum, row) => sum + signedLedgerAmount(row.kind, row.taxAmountCents), 0);
  const tipsCents = rows.reduce((sum, row) => sum + signedLedgerAmount(row.kind, row.tipAmountCents), 0);
  return {
    netCollectedCents,
    paymentsCents: rows.filter((row) => row.kind === "payment").reduce((sum, row) => sum + row.amountCents, 0),
    refundsCents: rows.filter((row) => row.kind === "refund").reduce((sum, row) => sum + row.amountCents, 0),
    salesTaxCents,
    tipsCents,
    netSalesCents: netCollectedCents - salesTaxCents - tipsCents,
    transactionCount: rows.length,
    byMethod: Object.fromEntries(methods.map((method) => [method, rows.filter((row) => row.method === method).reduce((sum, row) => sum + signedLedgerAmount(row.kind, row.amountCents), 0)])),
  };
}

export function expenseBookValues(expense: ExpenseBookRow) {
  const businessAmountCents = Math.round(expense.amountCents * expense.businessUseBps / 10_000);
  const businessTaxCents = Math.round(expense.taxAmountCents * expense.businessUseBps / 10_000);
  const inputTaxCreditCents = expense.recoverableTax ? businessTaxCents : 0;
  const netBusinessCostCents = businessAmountCents - inputTaxCreditCents;
  return {
    businessAmountCents,
    inputTaxCreditCents,
    operatingExpenseCents: expense.treatment === "operating" ? netBusinessCostCents : 0,
    capitalPurchaseCents: expense.treatment === "capital" ? netBusinessCostCents : 0,
    nonDeductibleCents: expense.treatment === "non_deductible" ? businessAmountCents : 0,
  };
}

export function summarizeBooks(payments: PaymentLedgerRow[], expenses: ExpenseBookRow[]) {
  const income = summarizePayments(payments), costs = expenses.map(expenseBookValues);
  const operatingExpensesCents = costs.reduce((sum, item) => sum + item.operatingExpenseCents, 0);
  const inputTaxCreditsCents = costs.reduce((sum, item) => sum + item.inputTaxCreditCents, 0);
  const capitalPurchasesCents = costs.reduce((sum, item) => sum + item.capitalPurchaseCents, 0);
  const nonDeductibleCents = costs.reduce((sum, item) => sum + item.nonDeductibleCents, 0);
  return { ...income, operatingExpensesCents, inputTaxCreditsCents, capitalPurchasesCents, nonDeductibleCents, estimatedOperatingProfitCents: income.netSalesCents - operatingExpensesCents, estimatedNetTaxCents: income.salesTaxCents - inputTaxCreditsCents };
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
