import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { publicIntakeSubmissions } from "../db/schema";
import { requestSource, sha256Hex } from "./client-phone-auth";
import { intakeOriginAllowed } from "./square";

type Db = ReturnType<typeof getDb>;

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function publicFormHeaders(origin: string | null) {
  const headers = new Headers({ "cache-control": "no-store", vary: "origin" });
  if (origin && intakeOriginAllowed(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type, accept");
    headers.set("access-control-max-age", "86400");
  }
  return headers;
}

export function publicFormResponse(origin: string | null, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: publicFormHeaders(origin) });
}

export function publicFormPreflight(request: Request) {
  const origin = request.headers.get("origin");
  if (!intakeOriginAllowed(origin)) return new Response(null, { status: 403, headers: publicFormHeaders(origin) });
  return new Response(null, { status: 204, headers: publicFormHeaders(origin) });
}

// The website forms share one ledger: one row per accepted submission, keyed by
// the browser-generated submission id so a retried request is a no-op, and
// hashed by source so a single visitor cannot flood the salon. No form content
// is stored on the ledger row itself.
export async function publicSubmissionGate(db: Db, input: {
  organizationId: string;
  request: Request;
  submissionKey: string;
  contact: string;
  kind: string;
  limit?: number;
  windowMinutes?: number;
}) {
  const [sourceHash, contactHash] = await Promise.all([
    sha256Hex(`public-${input.kind}:${input.organizationId}:source:${requestSource(input.request)}`),
    sha256Hex(`public-${input.kind}:${input.organizationId}:contact:${input.contact}`),
  ]);
  const [duplicate] = await db.select({ id: publicIntakeSubmissions.id }).from(publicIntakeSubmissions).where(and(
    eq(publicIntakeSubmissions.organizationId, input.organizationId),
    eq(publicIntakeSubmissions.submissionKey, input.submissionKey),
  )).limit(1);
  if (duplicate) return { sourceHash, contactHash, duplicate: true as const, limited: false as const };
  const limit = input.limit ?? 8;
  const cutoff = new Date(Date.now() - (input.windowMinutes ?? 15) * 60_000).toISOString();
  const recent = await db.select({ id: publicIntakeSubmissions.id }).from(publicIntakeSubmissions).where(and(
    eq(publicIntakeSubmissions.organizationId, input.organizationId),
    eq(publicIntakeSubmissions.sourceHash, sourceHash),
    sql`(${publicIntakeSubmissions.createdAt})::timestamp >= (${cutoff})::timestamp`,
  )).limit(limit);
  return { sourceHash, contactHash, duplicate: false as const, limited: recent.length >= limit };
}
