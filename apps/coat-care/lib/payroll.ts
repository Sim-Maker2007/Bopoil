export type CompensationSnapshot = {
  payType: "hourly" | "salary"; hourlyRateCents: number; annualSalaryCents: number;
  overtimeEligible: boolean; weeklyOvertimeMinutes: number; overtimeMultiplierBps: number;
  serviceCommissionBps: number; retailCommissionBps: number; currency: string;
};

function dateKeyInZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function paidMinutes(clockIn: string, clockOut: string, breakMinutes = 0) {
  const elapsed = Math.floor((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000);
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Clock-out must be after clock-in.");
  return Math.max(0, elapsed - Math.max(0, breakMinutes));
}

export function splitWeeklyMinutes(entries: Array<{ clockIn: string; clockOut: string; breakMinutes: number }>, threshold: number, eligible: boolean, timeZone = "UTC") {
  const byWeek = new Map<string, number>();
  for (const entry of entries) {
    const localDay = dateKeyInZone(new Date(entry.clockIn), timeZone);
    const date = new Date(`${localDay}T12:00:00.000Z`); const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - day); date.setUTCHours(0, 0, 0, 0);
    const key = date.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) || 0) + paidMinutes(entry.clockIn, entry.clockOut, entry.breakMinutes));
  }
  let regularMinutes = 0; let overtimeMinutes = 0;
  for (const minutes of byWeek.values()) {
    const overtime = eligible ? Math.max(0, minutes - threshold) : 0;
    overtimeMinutes += overtime; regularMinutes += minutes - overtime;
  }
  return { regularMinutes, overtimeMinutes };
}

export function calculateGross(snapshot: CompensationSnapshot, regularMinutes: number, overtimeMinutes: number, periodDays: number, serviceRevenueCents: number, tipsCents: number) {
  const regularPayCents = snapshot.payType === "salary"
    ? Math.round(snapshot.annualSalaryCents * periodDays / 365)
    : Math.round(snapshot.hourlyRateCents * regularMinutes / 60);
  const overtimePayCents = snapshot.payType === "hourly"
    ? Math.round(snapshot.hourlyRateCents * overtimeMinutes * snapshot.overtimeMultiplierBps / 600000)
    : 0;
  const serviceCommissionCents = Math.round(serviceRevenueCents * snapshot.serviceCommissionBps / 10000);
  return { regularPayCents, overtimePayCents, serviceCommissionCents, grossPayCents: regularPayCents + overtimePayCents + serviceCommissionCents, payoutCents: regularPayCents + overtimePayCents + serviceCommissionCents + tipsCents };
}

export function splitCommissionRevenue(principalCents: number, serviceLineCents: number, retailLineCents: number, totalLineCents: number) {
  const principal = Math.round(principalCents);
  const service = Math.max(0, Math.round(serviceLineCents));
  const retail = Math.max(0, Math.round(retailLineCents));
  const total = Math.max(0, Math.round(totalLineCents));
  if (!total) return { serviceRevenueCents: principal, retailRevenueCents: 0 };
  return {
    serviceRevenueCents: Math.round(principal * service / total),
    retailRevenueCents: Math.round(principal * retail / total),
  };
}

export function calculateRetailCommission(snapshot: CompensationSnapshot, retailRevenueCents: number) {
  return Math.round(retailRevenueCents * snapshot.retailCommissionBps / 10000);
}

export function mergeReportedTips(checkoutTipsCents: number, employeeReportedTipsCents: number) {
  return Math.max(0, Math.round(checkoutTipsCents), Math.round(employeeReportedTipsCents));
}

export const PAYROLL_DISCLAIMER = "Gross-pay operations only. Review overtime, worker classification, deductions, remittances, tax forms, and final payroll with your payroll provider or accountant under the rules that apply to each worker.";
