// Feature gate for online reservations. The booking flow ships in every
// deployment but only answers when ONLINE_BOOKING_ENABLED=true (set per Vercel
// environment). Otherwise the booking pages show a friendly pause notice and
// the booking APIs refuse, so nobody can reserve while the flow is being
// finished. The website's information form, the client portal and the salon
// workspace are not affected.

export const ONLINE_BOOKING_ENABLED_VARIABLE = "ONLINE_BOOKING_ENABLED";
export const BOOKING_PAUSE_PATH = "/reservation-pause";

// The public booking pages and the APIs only they use.
export const BOOKING_PAGE_PATTERNS = [/^\/book(\/.*)?$/i];
export const BOOKING_API_PATTERNS = [
  /^\/api\/bookings$/i,
  /^\/api\/square-bookings$/i,
  /^\/api\/availability$/i,
  /^\/api\/catalog$/i,
  /^\/api\/booking-context$/i,
  /^\/api\/client-auth(\/.*)?$/i,
];

type Env = Record<string, string | undefined>;

export function isBookingPagePath(pathname: string): boolean {
  return BOOKING_PAGE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function isBookingApiPath(pathname: string): boolean {
  return BOOKING_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function onlineBookingEnabled(env: Env = process.env): boolean {
  return (env[ONLINE_BOOKING_ENABLED_VARIABLE] || "").trim().toLowerCase() === "true";
}

export type BookingAccess = { action: "pass" } | { action: "pause-page" } | { action: "pause-api" };

export function decideBookingAccess(input: { pathname: string }, env: Env = process.env): BookingAccess {
  if (onlineBookingEnabled(env)) return { action: "pass" };
  if (isBookingPagePath(input.pathname)) return { action: "pause-page" };
  if (isBookingApiPath(input.pathname)) return { action: "pause-api" };
  return { action: "pass" };
}
