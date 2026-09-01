import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from ".";
import { ensurePilotData } from "./pilot";
import { clientPortalSessions, clients, organizations } from "./schema";

type Db = ReturnType<typeof getDb>;
const portalTokenPattern = /^[A-Za-z0-9_-]{40,60}$/;
export const PORTAL_EMAIL_LINK_TTL_MS = 15 * 60_000;
export const PORTAL_TRUSTED_SESSION_TTL_MS = 30 * 86400_000;
export const PORTAL_TRUSTED_SESSION_ABSOLUTE_TTL_MS = 90 * 86400_000;

function base64Url(bytes: Uint8Array) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function issuePortalSessionWithTtl(db: Db, clientId: string, ttlMs: number) {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); const token = base64Url(bytes); const id = crypto.randomUUID();
  const [client] = await db.select({ organizationId: clients.organizationId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new Error("Client not found");
  await db.insert(clientPortalSessions).values({ id, organizationId: client.organizationId, clientId, tokenHash: await sha256(token), expiresAt: new Date(Date.now() + ttlMs).toISOString() });
  return { id, token };
}

export async function issuePortalSession(db: Db, clientId: string, days = PORTAL_TRUSTED_SESSION_TTL_MS / 86400_000) {
  return issuePortalSessionWithTtl(db, clientId, days * 86400_000);
}

export async function issuePortalEmailSession(db: Db, clientId: string) {
  return issuePortalSessionWithTtl(db, clientId, PORTAL_EMAIL_LINK_TTL_MS);
}

export async function resolvePortalSession(token: string) {
  await ensurePilotData(); const db = getDb();
  if (!portalTokenPattern.test(token)) return { db, session: null, client: null };
  const nowIso = new Date().toISOString();
  const [row] = await db.select({ session: clientPortalSessions, client: clients }).from(clientPortalSessions).innerJoin(clients, eq(clientPortalSessions.clientId, clients.id)).where(and(
    eq(clientPortalSessions.tokenHash, await sha256(token)),
    gt(clientPortalSessions.expiresAt, nowIso),
    sql`((${clientPortalSessions.createdAt})::timestamp + interval '90 days') > (${nowIso})::timestamp`,
    isNull(clientPortalSessions.revokedAt),
  )).limit(1);
  if (!row) return { db, session: null, client: null };
  await db.update(clientPortalSessions).set({ lastUsedAt: new Date().toISOString() }).where(eq(clientPortalSessions.id, row.session.id));
  return { db, session: row.session, client: row.client };
}

export async function resolvePortalTokenContext(token: string) {
  await ensurePilotData(); const db = getDb();
  if (!portalTokenPattern.test(token)) return null;
  const [row] = await db.select({
    organizationSlug: organizations.slug,
  }).from(clientPortalSessions)
    .innerJoin(clients, eq(clientPortalSessions.clientId, clients.id))
    .innerJoin(organizations, eq(clients.organizationId, organizations.id))
    .where(eq(clientPortalSessions.tokenHash, await sha256(token)))
    .limit(1);
  return row || null;
}

export async function renewPortalSession(db: Db, sessionId: string, now = new Date()) {
  const nowIso = now.toISOString();
  const [session] = await db.select({
    createdAt: clientPortalSessions.createdAt,
  }).from(clientPortalSessions).where(and(
    eq(clientPortalSessions.id, sessionId),
    gt(clientPortalSessions.expiresAt, nowIso),
    isNull(clientPortalSessions.revokedAt),
  )).limit(1);
  if (!session) return null;
  const createdAt = new Date(session.createdAt.includes("T") ? session.createdAt : `${session.createdAt.replace(" ", "T")}Z`);
  if (!Number.isFinite(createdAt.getTime())) return null;
  const absoluteExpiry = createdAt.getTime() + PORTAL_TRUSTED_SESSION_ABSOLUTE_TTL_MS;
  const expiresAtMs = Math.min(now.getTime() + PORTAL_TRUSTED_SESSION_TTL_MS, absoluteExpiry);
  if (expiresAtMs <= now.getTime()) return null;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const [renewed] = await db.update(clientPortalSessions).set({ expiresAt, lastUsedAt: nowIso }).where(and(
    eq(clientPortalSessions.id, sessionId),
    gt(clientPortalSessions.expiresAt, nowIso),
    eq(clientPortalSessions.createdAt, session.createdAt),
    isNull(clientPortalSessions.revokedAt),
  )).returning({ expiresAt: clientPortalSessions.expiresAt });
  return renewed?.expiresAt || null;
}

export async function revokePortalSession(token: string) {
  await ensurePilotData(); const db = getDb();
  if (!portalTokenPattern.test(token)) return false;
  const [revoked] = await db.update(clientPortalSessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(clientPortalSessions.tokenHash, await sha256(token)), isNull(clientPortalSessions.revokedAt))).returning({ id: clientPortalSessions.id });
  return Boolean(revoked);
}
