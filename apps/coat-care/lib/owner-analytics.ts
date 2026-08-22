export type AnalyticsAppointment = { id: string; clientId: string; petId: string; serviceId: string; serviceName: string; staffId: string | null; staffName: string | null; status: string; startsAt: string; endsAt: string };
export type AnalyticsPayment = { appointmentId: string; kind: "payment" | "refund"; amountCents: number; taxAmountCents: number; tipAmountCents: number; occurredAt: string };

export function signedNetSale(payment: AnalyticsPayment) {
  const value = Math.max(0, payment.amountCents - payment.taxAmountCents - payment.tipAmountCents);
  return payment.kind === "refund" ? -value : value;
}

export function rate(numerator: number, denominator: number) { return denominator > 0 ? Math.round(numerator * 10_000 / denominator) : 0; }
export function change(current: number, previous: number) { return previous === 0 ? (current === 0 ? 0 : null) : Math.round((current - previous) * 10_000 / Math.abs(previous)); }

export function summarizeOperations(input: { appointments: AnalyticsAppointment[]; allAppointments: AnalyticsAppointment[]; payments: AnalyticsPayment[]; availableMinutesByStaff: Map<string, number>; grossPayrollCents: number; operatingExpenseCents: number; inventoryCostCents: number }) {
  const { appointments, allAppointments, payments } = input; const completed = appointments.filter((item) => item.status === "completed"); const exceptions = appointments.filter((item) => ["cancelled", "no_show"].includes(item.status));
  const netSalesCents = payments.reduce((sum, item) => sum + signedNetSale(item), 0); const tipsCents = payments.reduce((sum, item) => sum + (item.kind === "refund" ? -item.tipAmountCents : item.tipAmountCents), 0); const refundsCents = payments.filter((item) => item.kind === "refund").reduce((sum, item) => sum + item.amountCents, 0); const settledTickets = new Set(payments.filter((item) => item.kind === "payment").map((item) => item.appointmentId)).size;
  const bookedMinutes = appointments.filter((item) => !["cancelled", "no_show"].includes(item.status)).reduce((sum, item) => sum + Math.max(0, Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000)), 0); const availableMinutes = [...input.availableMinutesByStaff.values()].reduce((sum, value) => sum + value, 0);
  const activeClientIds = new Set(completed.map((item) => item.clientId)); const priorClients = new Set(allAppointments.filter((item) => item.status === "completed" && item.startsAt < (appointments[0]?.startsAt || "9999")).map((item) => item.clientId));
  const retainedClients = [...activeClientIds].filter((id) => priorClients.has(id)).length; const rebooked = completed.filter((item) => allAppointments.some((future) => future.petId === item.petId && future.startsAt > item.endsAt && !["cancelled", "no_show"].includes(future.status))).length;
  const contributionCents = netSalesCents - input.grossPayrollCents - input.operatingExpenseCents - input.inventoryCostCents;
  return { netSalesCents, tipsCents, refundsCents, settledTickets, appointments: appointments.length, completed: completed.length, cancelled: appointments.filter((item) => item.status === "cancelled").length, noShows: appointments.filter((item) => item.status === "no_show").length, exceptionRateBps: rate(exceptions.length, appointments.length), completionRateBps: rate(completed.length, appointments.length), averageTicketCents: settledTickets ? Math.round(netSalesCents / settledTickets) : 0, bookedMinutes, availableMinutes, utilizationBps: rate(bookedMinutes, availableMinutes), activeClients: activeClientIds.size, retainedClients, newClients: activeClientIds.size - retainedClients, retentionBps: rate(retainedClients, activeClientIds.size), rebookingBps: rate(rebooked, completed.length), grossPayrollCents: input.grossPayrollCents, laborBps: rate(input.grossPayrollCents, netSalesCents), operatingExpenseCents: input.operatingExpenseCents, inventoryCostCents: input.inventoryCostCents, contributionCents, contributionMarginBps: rate(contributionCents, netSalesCents) };
}

export function buildInsights(metrics: ReturnType<typeof summarizeOperations>, previous: ReturnType<typeof summarizeOperations>) {
  const items: Array<{ tone: "positive" | "attention" | "neutral"; title: string; detail: string }> = [];
  const salesChange = change(metrics.netSalesCents, previous.netSalesCents);
  if (salesChange !== null && salesChange >= 500) items.push({ tone: "positive", title: "Sales momentum is strengthening", detail: `Net sales are ${(salesChange / 100).toFixed(1)}% above the preceding period.` });
  if (salesChange !== null && salesChange <= -500) items.push({ tone: "attention", title: "Net sales need attention", detail: `Net sales are ${Math.abs(salesChange / 100).toFixed(1)}% below the preceding period. Review demand, capacity, and average ticket together.` });
  if (metrics.exceptionRateBps >= 1000) items.push({ tone: "attention", title: "Recover cancelled demand", detail: `${(metrics.exceptionRateBps / 100).toFixed(1)}% of appointments were cancelled or no-shows. Deposits, reminders, and waitlist conversion can protect the calendar.` });
  if (metrics.rebookingBps < 5000 && metrics.completed >= 5) items.push({ tone: "attention", title: "Make rebooking part of checkout", detail: `Only ${(metrics.rebookingBps / 100).toFixed(1)}% of completed visits have a later booking on file.` });
  if (metrics.utilizationBps < 6000 && metrics.availableMinutes > 0) items.push({ tone: "neutral", title: "Capacity is available", detail: `Booked time uses ${(metrics.utilizationBps / 100).toFixed(1)}% of published team capacity. Focus marketing on the quietest days and services.` });
  if (metrics.laborBps > 5500) items.push({ tone: "attention", title: "Review recorded labor percentage", detail: `Recorded gross payroll is ${(metrics.laborBps / 100).toFixed(1)}% of net sales before employer burden and statutory costs.` });
  if (!items.length) items.push({ tone: "positive", title: "The operating rhythm is balanced", detail: "No major exception crossed the current decision thresholds. Keep watching retention, capacity, and margin together." });
  return items.slice(0, 4);
}
