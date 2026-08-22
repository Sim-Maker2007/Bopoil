import type { getDb } from "../db";
import { issuePortalEmailSession } from "../db/client-portal";

type Db = ReturnType<typeof getDb>;

export const PORTAL_LINK_TEMPLATE_KEYS = new Set([
  "portal_access",
  "booking_confirmation",
  "booking_request_received",
  "booking_deposit_expired",
  "waitlist_opening_available",
  "appointment_reminder",
]);

const portalAccessUrlPattern = /https?:\/\/[^\s<>"']+\/portal\/access\/[A-Za-z0-9_-]{40,60}(?:\?[^\s<>"']*)?/;
const portalAccessUrlGlobalPattern = /https?:\/\/[^\s<>"']+\/portal\/access\/[A-Za-z0-9_-]{40,60}(?:\?[^\s<>"']*)?/g;
const approvalUrlGlobalPattern = /https?:\/\/[^\s<>"']+\/approval\/[A-Za-z0-9_-]{20,80}(?:\?[^\s<>"']*)?/g;

export function safePortalReturnTo(value: string | null | undefined) {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "";
  try {
    const parsed = new URL(candidate, "https://portal.invalid");
    if (parsed.origin !== "https://portal.invalid") return "";
    if (parsed.pathname !== "/portal" && !parsed.pathname.startsWith("/book/")) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

export function safePublicOrigin(value: string | null | undefined) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) return parsed.origin;
  } catch {
    // Invalid origins are deliberately ignored.
  }
  return "";
}

export function portalAccessUrl(origin: string, token: string, returnTo?: string) {
  const safeOrigin = safePublicOrigin(origin);
  if (!safeOrigin) throw new Error("A secure public site URL is required to create a portal link.");
  const url = new URL(`/portal/access/${encodeURIComponent(token)}`, safeOrigin);
  const safeReturnTo = safePortalReturnTo(returnTo);
  if (safeReturnTo) url.searchParams.set("return_to", safeReturnTo);
  return url.toString();
}

export function portalLinkFromBody(body: string) {
  const match = body.match(portalAccessUrlPattern)?.[0] || "";
  if (!match) return null;
  try {
    const url = new URL(match);
    return {
      url: match,
      origin: url.origin,
      returnTo: safePortalReturnTo(url.searchParams.get("return_to")),
    };
  } catch {
    return null;
  }
}

export function redactPortalLinks(body: string) {
  return body
    .replace(portalAccessUrlGlobalPattern, "[secure client link hidden]")
    .replace(approvalUrlGlobalPattern, "[secure client action link hidden]");
}

export async function refreshPortalLinkBody(db: Db, input: {
  clientId: string;
  body: string;
  origin?: string;
  returnTo?: string;
}) {
  const current = portalLinkFromBody(input.body);
  const origin = safePublicOrigin(input.origin) || current?.origin || "";
  if (!origin) return { body: input.body, refreshed: false as const, portalUrl: "", sessionId: "" };
  const session = await issuePortalEmailSession(db, input.clientId);
  const portalUrl = portalAccessUrl(origin, session.token, safePortalReturnTo(input.returnTo) || current?.returnTo);
  const body = current
    ? input.body.replace(current.url, portalUrl)
    : input.body.includes("{{portal_url}}")
      ? input.body.replaceAll("{{portal_url}}", portalUrl)
      : `${input.body.trim()}\n\nManage pets and appointments: ${portalUrl}`;
  return { body, refreshed: true as const, portalUrl, sessionId: session.id };
}
