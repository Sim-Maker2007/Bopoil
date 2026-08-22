export function calculateInvoice(input: { subtotalCents: number; discountCents: number; taxRateBps: number; tipCents: number }) {
  const taxableCents = Math.max(0, input.subtotalCents - input.discountCents);
  const taxCents = Math.round((taxableCents * input.taxRateBps) / 10_000);
  return { taxableCents, taxCents, totalCents: taxableCents + taxCents + input.tipCents };
}

export function invoiceStatus(totalCents: number, paidCents: number, refundedCents: number) {
  if (refundedCents > 0) return refundedCents >= paidCents ? "refunded" as const : "partially_refunded" as const;
  if (paidCents >= totalCents) return "paid" as const;
  if (paidCents > 0) return "partially_paid" as const;
  return "open" as const;
}

export function invoiceBalanceCents(totalCents: number, paidCents: number, refundedCents: number) {
  const netPaidCents = Math.max(0, paidCents - refundedCents);
  return Math.max(0, totalCents - netPaidCents);
}
