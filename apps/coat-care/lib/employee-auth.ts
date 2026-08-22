import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { employeePortalSessions, staff } from "../db/schema";
import { randomToken, sha256 } from "./employee-crypto";

export { EMPLOYEE_PIN_ITERATIONS, hashPin, randomToken, sha256, verifyPin } from "./employee-crypto";

export const EMPLOYEE_SESSION_COOKIE = "coat_employee_session";
export const EMPLOYEE_SESSION_DAYS = 30;
export function validPin(value: unknown) {
  const pin = String(value || "");
  if (!/^\d{6}$/.test(pin)) throw new Error("Le NIP doit contenir exactement six chiffres.");
  return pin;
}

export function employeeCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function createEmployeeSession(organizationId: string, staffId: string) {
  const db = getDb(); const token = randomToken(); const now = new Date();
  await db.insert(employeePortalSessions).values({ id: crypto.randomUUID(), organizationId, staffId, tokenHash: await sha256(token), expiresAt: new Date(now.getTime() + EMPLOYEE_SESSION_DAYS * 86400000).toISOString(), lastUsedAt: now.toISOString() });
  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: EMPLOYEE_SESSION_DAYS * 86400 });
}

export async function clearEmployeeSession() {
  const cookieStore = await cookies(); const token = cookieStore.get(EMPLOYEE_SESSION_COOKIE)?.value;
  if (token) await getDb().update(employeePortalSessions).set({ revokedAt: new Date().toISOString() }).where(eq(employeePortalSessions.tokenHash, await sha256(token)));
  cookieStore.delete(EMPLOYEE_SESSION_COOKIE);
}

export async function getEmployeeSession() {
  const cookieStore = await cookies(); const token = cookieStore.get(EMPLOYEE_SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb(); const now = new Date().toISOString();
  const [session] = await db.select({ sessionId: employeePortalSessions.id, organizationId: employeePortalSessions.organizationId, staffId: employeePortalSessions.staffId, displayName: staff.displayName, active: staff.active })
    .from(employeePortalSessions).innerJoin(staff, eq(employeePortalSessions.staffId, staff.id))
    .where(and(eq(employeePortalSessions.tokenHash, await sha256(token)), gt(employeePortalSessions.expiresAt, now), isNull(employeePortalSessions.revokedAt), eq(staff.active, true))).limit(1);
  if (!session) return null;
  await db.update(employeePortalSessions).set({ lastUsedAt: now }).where(eq(employeePortalSessions.id, session.sessionId));
  return session;
}

export async function requireEmployeeSession() {
  const session = await getEmployeeSession();
  if (!session) throw new Error("EMPLOYEE_AUTH_REQUIRED");
  return { ...session, db: getDb() };
}
