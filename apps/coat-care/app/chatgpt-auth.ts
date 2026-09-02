import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { salonAuthChallenges, salonAuthSessions, staff, staffInvitations } from "../db/schema";
import { deliveryConfig } from "../lib/message-delivery";
import { resendRequest } from "../lib/message-provider-payloads";

export type ChatGPTUser = { displayName: string; email: string; fullName: string | null };

const COOKIE = "coat_care_session";
const LOGIN_TTL_MS = 20 * 60_000;
const SESSION_TTL_MS = 14 * 86400000;

function safeRelativeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/salon";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/salon";
  } catch { return "/salon"; }
}

function token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(bytes).toString("hex");
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase().slice(0, 180);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const rawToken = (await cookies()).get(COOKIE)?.value || "";
  if (!rawToken) return null;
  const db = getDb();
  const now = new Date().toISOString();
  const [session] = await db.select().from(salonAuthSessions).where(and(
    eq(salonAuthSessions.tokenHash, await hash(rawToken)),
    gt(salonAuthSessions.expiresAt, now),
    isNull(salonAuthSessions.revokedAt),
  )).limit(1);
  if (!session) return null;
  const [person] = await db.select({ displayName: staff.displayName }).from(staff).where(and(eq(staff.email, session.email), eq(staff.active, true))).limit(1);
  await db.update(salonAuthSessions).set({ lastUsedAt: now }).where(eq(salonAuthSessions.id, session.id));
  const displayName = person?.displayName || session.email;
  return { email: session.email, displayName, fullName: person?.displayName || null };
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string) {
  return `/salon/login?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function chatGPTSignOutPath(returnTo = "/") {
  return `/api/auth/salon/logout?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export async function createSalonLoginChallenge(input: { email: string; returnTo: string; origin: string; source: string }) {
  const email = normalizeEmail(input.email);
  if (!email) return { accepted: true as const };
  const db = getDb();
  const now = new Date();
  const recent = new Date(now.getTime() - 15 * 60_000).toISOString();
  const sourceHash = await hash(`${process.env.AUTH_HASH_SECRET || "local-development"}:${input.source}`);
  const [knownStaff, invitation] = await Promise.all([
    db.select({ id: staff.id }).from(staff).where(and(eq(staff.email, email), eq(staff.active, true))).limit(1),
    db.select({ id: staffInvitations.id }).from(staffInvitations).where(and(eq(staffInvitations.email, email), eq(staffInvitations.status, "pending"), gt(staffInvitations.expiresAt, now.toISOString()))).limit(1),
  ]);
  const ownerEmail = normalizeEmail(process.env.SALON_OWNER_EMAIL || "");
  if (!knownStaff.length && !invitation.length && email !== ownerEmail) return { accepted: true as const };
  const attempts = await db.select({ id: salonAuthChallenges.id }).from(salonAuthChallenges).where(and(eq(salonAuthChallenges.sourceHash, sourceHash), gt(salonAuthChallenges.createdAt, recent))).limit(5);
  if (attempts.length >= 5) return { accepted: true as const };

  const rawToken = token();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + LOGIN_TTL_MS).toISOString();
  // createdAt is written explicitly in ISO form so the throttle window above
  // (also ISO) compares like with like; the column's database default uses a
  // space-separated format that sorts before every ISO string.
  await db.insert(salonAuthChallenges).values({ id, email, tokenHash: await hash(rawToken), sourceHash, expiresAt, createdAt: now.toISOString() });
  const config = deliveryConfig();
  if (!config.email.configured) throw new Error("Salon sign-in email is not configured.");
  const link = `${input.origin}/salon/access/${encodeURIComponent(rawToken)}?return_to=${encodeURIComponent(safeRelativeReturnPath(input.returnTo))}`;
  const emailRequest = resendRequest({
    id: `salon-login-${id}`,
    recipientAddress: email,
    subject: "Your secure Coat & Care sign-in link",
    body: `Use this private link to open the BOPOIL Coat & Care workspace:\n\n${link}\n\nThis link expires in 20 minutes and can be used once. If you did not request it, you can ignore this email.`,
    scheduledFor: now.toISOString(),
    deliveryAttempts: 0,
  }, config);
  if (!emailRequest) throw new Error("Salon sign-in email could not be prepared.");
  const response = await fetch(emailRequest.url, emailRequest.init);
  if (!response.ok) throw new Error("Salon sign-in email could not be sent.");
  return { accepted: true as const };
}

export async function consumeSalonLoginChallenge(rawToken: string) {
  const db = getDb();
  const now = new Date();
  const [challenge] = await db.update(salonAuthChallenges).set({ usedAt: now.toISOString() }).where(and(
    eq(salonAuthChallenges.tokenHash, await hash(rawToken)),
    gt(salonAuthChallenges.expiresAt, now.toISOString()),
    isNull(salonAuthChallenges.usedAt),
  )).returning({ email: salonAuthChallenges.email });
  if (!challenge) return false;
  const sessionToken = token();
  await db.insert(salonAuthSessions).values({ id: crypto.randomUUID(), email: challenge.email, tokenHash: await hash(sessionToken), expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(), lastUsedAt: now.toISOString() });
  (await cookies()).set(COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
  return true;
}

export async function revokeSalonSession() {
  const store = await cookies();
  const rawToken = store.get(COOKIE)?.value || "";
  if (rawToken) await getDb().update(salonAuthSessions).set({ revokedAt: new Date().toISOString() }).where(eq(salonAuthSessions.tokenHash, await hash(rawToken)));
  store.delete(COOKIE);
}
