// Pure helpers behind the Square data sync: which resources exist, which
// webhook events to subscribe, how a pass is planned and resumed, and how
// Square's money objects are read. No database or network here, so the sync
// logic can be tested on its own.

export type SquareResource = "customers" | "orders" | "payments" | "refunds" | "team";
export const SQUARE_RESOURCES: SquareResource[] = ["customers", "team", "orders", "payments", "refunds"];

// The subscriptions to register on the Square webhook endpoint.
export const SQUARE_WEBHOOK_EVENT_TYPES = [
  "booking.created", "booking.updated",
  "customer.created", "customer.updated", "customer.deleted",
  "payment.created", "payment.updated",
  "refund.created", "refund.updated",
  "order.created", "order.updated", "order.fulfillment.updated",
  "team_member.created", "team_member.updated",
  "catalog.version.updated",
];

type Money = { amount?: number; currency?: string };
export type Checkpoint = Record<string, string | number | boolean | undefined>;

export type PlanOptions = { now?: Date; full?: boolean };

const BACKFILL_DAYS = 730;
const FULL_REFRESH_DAYS = 7;
const INCREMENTAL_OVERLAP_MS = 2 * 60 * 60 * 1000;

function now(options: PlanOptions) {
  return options.now || new Date();
}

export function cents(money?: Money) {
  return Math.round(Number(money?.amount || 0));
}

export function squareCustomerName(customer: { givenName: string; familyName: string; companyName: string; nickname: string; emailAddress: string; phoneNumber: string }) {
  return [customer.givenName, customer.familyName].filter(Boolean).join(" ") || customer.companyName || customer.nickname || customer.emailAddress || customer.phoneNumber || "Square customer";
}

export function parseCheckpoint(state?: { checkpointJson: string } | null): Checkpoint {
  try {
    const parsed = JSON.parse(state?.checkpointJson || "{}");
    return parsed && typeof parsed === "object" ? parsed as Checkpoint : {};
  } catch {
    return {};
  }
}

// Chooses between a complete pass (first run, weekly refresh, or when asked)
// and an incremental pass from the last completed one, and persists where a
// pass stopped. Shared by every resource.
export function passPlan(checkpoint: Checkpoint, state: { lastSyncedAt: string | null } | undefined, options: PlanOptions, resource: SquareResource) {
  const current = now(options).getTime();
  const fullCompletedAt = typeof checkpoint.fullCompletedAt === "string" ? Date.parse(checkpoint.fullCompletedAt) : 0;
  const inProgress = typeof checkpoint.mode === "string" && typeof checkpoint.passEnd === "string";
  let mode: "full" | "incremental" = inProgress ? checkpoint.mode as "full" | "incremental" : "incremental";
  if (!inProgress) {
    const stale = !fullCompletedAt || current - fullCompletedAt > FULL_REFRESH_DAYS * 86_400_000;
    if (options.full || !state?.lastSyncedAt || stale) mode = "full";
    if (resource === "payments" || resource === "orders" || resource === "refunds") {
      // Money history is immutable once imported: a weekly full pass would
      // re-read two years of payments for nothing. Only the first pass is full.
      if (!options.full && fullCompletedAt) mode = "incremental";
    }
  }
  const passEnd = inProgress ? String(checkpoint.passEnd) : now(options).toISOString();
  const passStartedAt = inProgress ? String(checkpoint.passStartedAt || passEnd) : passEnd;
  const since = typeof checkpoint.since === "string" ? checkpoint.since : state?.lastSyncedAt || "";
  const sinceMs = since ? Date.parse(since) - INCREMENTAL_OVERLAP_MS : current - 30 * 86_400_000;
  return {
    mode,
    passEnd,
    passStartedAt,
    cursor: typeof checkpoint.cursor === "string" ? checkpoint.cursor : "",
    sinceIso: new Date(Math.max(0, sinceMs)).toISOString(),
    backfillStartIso: new Date(current - BACKFILL_DAYS * 86_400_000).toISOString(),
    fullCompletedAt: checkpoint.fullCompletedAt,
    progress(cursor: string): Checkpoint {
      return { mode, passEnd, passStartedAt, cursor, since: checkpoint.since, fullCompletedAt: checkpoint.fullCompletedAt };
    },
    done(): Checkpoint {
      return { since: passEnd, fullCompletedAt: mode === "full" ? passEnd : checkpoint.fullCompletedAt };
    },
  };
}

// The sales tax inside a payment comes from its order: all of it when the
// payment settles the order alone, its share by amount when the order was split.
export function paymentShare(order: { totalCents: number; tipCents: number; taxCents: number; discountCents: number }, paymentAmountCents: number) {
  const base = Math.max(1, order.totalCents - order.tipCents);
  const ratio = Math.min(1, Math.max(0, paymentAmountCents / base));
  return { taxCents: Math.round(order.taxCents * ratio), discountCents: Math.round(order.discountCents * ratio) };
}

export function isSquareResource(value: unknown): value is SquareResource {
  return typeof value === "string" && (SQUARE_RESOURCES as string[]).includes(value);
}

export function tenderLabel(payment: { sourceType: string; cardBrand: string; walletBrand: string }) {
  if (payment.sourceType === "CASH") return "Cash";
  if (payment.sourceType === "CARD") return payment.cardBrand ? payment.cardBrand.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Card";
  if (payment.sourceType === "WALLET") return payment.walletBrand || "Wallet";
  if (payment.sourceType === "BANK_ACCOUNT") return "Bank";
  if (payment.sourceType === "EXTERNAL") return payment.walletBrand ? `Other (${payment.walletBrand.toLowerCase()})` : "Other";
  if (payment.sourceType === "SQUARE_ACCOUNT") return "Square balance";
  if (payment.sourceType === "BUY_NOW_PAY_LATER") return "Afterpay";
  return payment.sourceType || "Unknown";
}
