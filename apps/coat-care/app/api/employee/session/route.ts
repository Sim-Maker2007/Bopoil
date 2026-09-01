import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, databaseErrorMessage } from "../../../../db";
import { auditEvents, employeePortalCredentials, employeePortalInvitations, employeePortalSessions, staff } from "../../../../db/schema";
import { clearEmployeeSession, createEmployeeSession, employeeCode, hashPin, sha256, validPin, verifyPin } from "../../../../lib/employee-auth";

function reply(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const normalized = rawMessage === "EMPLOYEE_AUTH_REQUIRED"
    ? { code: "employee_auth_required", error: "Sign-in required.", status: 401 }
    : rawMessage === "Accès temporairement bloqué. Réessaie dans 15 minutes." || rawMessage === "Access temporarily locked. Try again in 15 minutes."
      ? { code: "temporarily_locked", error: "Access temporarily locked. Try again in 15 minutes.", status: 429 }
      : rawMessage === "Le NIP doit contenir exactement six chiffres." || rawMessage === "The PIN must contain exactly six digits."
        ? { code: "invalid_pin", error: "The PIN must contain exactly six digits.", status: 400 }
        : rawMessage === "Cette invitation est invalide ou expirée." || rawMessage === "This invitation is invalid or expired."
          ? { code: "invalid_invitation", error: "This invitation is invalid or expired.", status: 400 }
          : rawMessage === "Code employé ou NIP invalide." || rawMessage === "Invalid employee code or PIN."
            ? { code: "invalid_credentials", error: "Invalid employee code or PIN.", status: 401 }
            : { code: "employee_session_unavailable", error: rawMessage, status: 500 };
  return Response.json({ error: normalized.error, code: normalized.code }, { status: normalized.status });
}

async function uniqueEmployeeCode() {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = employeeCode();
    const [existing] = await db.select({ id: employeePortalCredentials.id }).from(employeePortalCredentials).where(eq(employeePortalCredentials.employeeCode, code)).limit(1);
    if (!existing) return code;
  }
  throw new Error("The employee code could not be created right now.");
}

export async function POST(request: Request) {
  try {
    const db = getDb(); const body = await request.json() as Record<string, unknown>; const action = String(body.action || "login"); const now = new Date().toISOString();
    if (action === "setup") {
      const token = String(body.token || ""); const pin = validPin(body.pin); const tokenHash = await sha256(token);
      const [invitation] = await db.select().from(employeePortalInvitations).where(and(eq(employeePortalInvitations.tokenHash, tokenHash), gt(employeePortalInvitations.expiresAt, now), isNull(employeePortalInvitations.usedAt), isNull(employeePortalInvitations.revokedAt))).limit(1);
      if (!invitation) throw new Error("This invitation is invalid or expired.");
      const [person] = await db.select({ id: staff.id, displayName: staff.displayName, active: staff.active }).from(staff).where(and(eq(staff.id, invitation.staffId), eq(staff.organizationId, invitation.organizationId))).limit(1);
      if (!person?.active) throw new Error("This invitation is invalid or expired.");
      const pinValue = await hashPin(pin); const [existing] = await db.select().from(employeePortalCredentials).where(eq(employeePortalCredentials.staffId, person.id)).limit(1); const code = existing?.employeeCode || await uniqueEmployeeCode();
      const invitationGuard = db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: sql<string>`(
          select organization_id from employee_portal_invitations
          where id = ${invitation.id}
            and token_hash = ${tokenHash}
            and expires_at > ${now}
            and used_at is null
            and revoked_at is null
        )`,
        actorType: "staff",
        actorId: person.id,
        action: "employee_portal.activated",
        entityType: "staff",
        entityId: person.id,
      });
      const credentialWrite = existing
        ? db.update(employeePortalCredentials).set({ pinSalt: pinValue.salt, pinHash: pinValue.hash, failedAttempts: 0, lockedUntil: null, active: true, updatedAt: now }).where(and(eq(employeePortalCredentials.id, existing.id), eq(employeePortalCredentials.organizationId, invitation.organizationId), eq(employeePortalCredentials.staffId, person.id)))
        : db.insert(employeePortalCredentials).values({ id: crypto.randomUUID(), organizationId: invitation.organizationId, staffId: person.id, employeeCode: code, pinSalt: pinValue.salt, pinHash: pinValue.hash });
      try {
        await db.batch([
          invitationGuard,
          credentialWrite,
          db.update(employeePortalInvitations).set({ usedAt: now }).where(and(eq(employeePortalInvitations.id, invitation.id), eq(employeePortalInvitations.tokenHash, tokenHash), gt(employeePortalInvitations.expiresAt, now), isNull(employeePortalInvitations.usedAt), isNull(employeePortalInvitations.revokedAt))),
          db.update(employeePortalSessions).set({ revokedAt: now }).where(and(eq(employeePortalSessions.organizationId, invitation.organizationId), eq(employeePortalSessions.staffId, person.id), isNull(employeePortalSessions.revokedAt))),
        ]);
      } catch (error) {
        if (error instanceof Error && /constraint|null|unique/i.test(databaseErrorMessage(error))) throw new Error("This invitation is invalid or expired.");
        throw error;
      }
      await createEmployeeSession(invitation.organizationId, person.id);
      return Response.json({ ok: true, employeeCode: code, displayName: person.displayName });
    }
    const code = String(body.employeeCode || "").trim().toUpperCase(); const pin = validPin(body.pin);
    const [credential] = await db.select().from(employeePortalCredentials).where(and(eq(employeePortalCredentials.employeeCode, code), eq(employeePortalCredentials.active, true))).limit(1);
    if (!credential) throw new Error("Invalid employee code or PIN.");
    if (credential.lockedUntil && credential.lockedUntil > now) throw new Error("Access temporarily locked. Try again in 15 minutes.");
    const correct = await verifyPin(pin, credential.pinSalt, credential.pinHash);
    if (!correct) {
      const lockUntil = new Date(Date.now() + 15 * 60000).toISOString();
      const [failed] = await db.update(employeePortalCredentials).set({
        failedAttempts: sql<number>`case when ${employeePortalCredentials.failedAttempts} >= 4 then 0 else ${employeePortalCredentials.failedAttempts} + 1 end`,
        lockedUntil: sql<string | null>`case when ${employeePortalCredentials.failedAttempts} >= 4 then ${lockUntil} else null end`,
        updatedAt: now,
      }).where(and(
        eq(employeePortalCredentials.id, credential.id),
        eq(employeePortalCredentials.active, true),
        or(isNull(employeePortalCredentials.lockedUntil), lte(employeePortalCredentials.lockedUntil, now)),
      )).returning({ lockedUntil: employeePortalCredentials.lockedUntil });
      throw new Error(failed?.lockedUntil ? "Access temporarily locked. Try again in 15 minutes." : "Invalid employee code or PIN.");
    }
    const [authenticated] = await db.update(employeePortalCredentials).set({ failedAttempts: 0, lockedUntil: null, updatedAt: now }).where(and(
      eq(employeePortalCredentials.id, credential.id),
      eq(employeePortalCredentials.active, true),
      eq(employeePortalCredentials.pinSalt, credential.pinSalt),
      eq(employeePortalCredentials.pinHash, credential.pinHash),
      eq(employeePortalCredentials.failedAttempts, credential.failedAttempts),
      or(isNull(employeePortalCredentials.lockedUntil), lte(employeePortalCredentials.lockedUntil, now)),
    )).returning({ organizationId: employeePortalCredentials.organizationId, staffId: employeePortalCredentials.staffId });
    if (!authenticated) throw new Error("Invalid employee code or PIN.");
    await createEmployeeSession(authenticated.organizationId, authenticated.staffId);
    return Response.json({ ok: true });
  } catch (error) { return reply(error, "Employee sign-in failed."); }
}

export async function DELETE() {
  try { await clearEmployeeSession(); return Response.json({ ok: true }); }
  catch { return Response.json({ ok: true }); }
}
