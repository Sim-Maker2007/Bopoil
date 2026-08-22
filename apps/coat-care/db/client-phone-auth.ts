import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { getDb } from ".";
import {
  CLIENT_PHONE_CHALLENGE_COOKIE,
  PHONE_OTP_DESTINATION_LIMIT,
  PHONE_OTP_MAX_ATTEMPTS,
  PHONE_OTP_RATE_WINDOW_SECONDS,
  PHONE_OTP_RESEND_SECONDS,
  PHONE_OTP_SOURCE_LIMIT,
  PHONE_OTP_TTL_SECONDS,
  PHONE_PROOF_TTL_SECONDS,
  constantTimeHexEqual,
  cookieValue,
  phoneOtpCodeHash,
  phoneRateLimitHashes,
  randomChallengeToken,
  randomSixDigitCode,
  sha256Hex,
} from "../lib/client-phone-auth";
import { clientPhoneIdentities, clientPhoneOtpChallenges, clientPortalSessions } from "./schema";

type Db = ReturnType<typeof getDb>;
type Challenge = typeof clientPhoneOtpChallenges.$inferSelect;

export async function createPhoneOtpChallenge(input: {
  db: Db;
  organizationId: string;
  phoneE164: string;
  source: string;
  pepper: string;
  enrollmentClientId?: string | null;
  enrollmentSessionId?: string | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - PHONE_OTP_RATE_WINDOW_SECONDS * 1000).toISOString();
  const resendStart = new Date(now.getTime() - PHONE_OTP_RESEND_SECONDS * 1000).toISOString();
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { destinationHash, sourceHash } = await phoneRateLimitHashes({
    organizationId: input.organizationId,
    phoneE164: input.phoneE164,
    source: input.source,
    pepper: input.pepper,
  });

  await input.db.delete(clientPhoneOtpChallenges).where(and(
    eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
    lt(clientPhoneOtpChallenges.createdAt, retentionCutoff),
  ));

  const [recentDestination, recentSource, recentResend] = await Promise.all([
    input.db.select({
      id: clientPhoneOtpChallenges.id,
      attemptCount: clientPhoneOtpChallenges.attemptCount,
    })
      .from(clientPhoneOtpChallenges)
      .where(and(
        eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
        eq(clientPhoneOtpChallenges.destinationHash, destinationHash),
        gte(clientPhoneOtpChallenges.createdAt, windowStart),
      ))
      .limit(PHONE_OTP_DESTINATION_LIMIT),
    input.db.select({ id: clientPhoneOtpChallenges.id })
      .from(clientPhoneOtpChallenges)
      .where(and(
        eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
        eq(clientPhoneOtpChallenges.sourceHash, sourceHash),
        gte(clientPhoneOtpChallenges.createdAt, windowStart),
      ))
      .limit(PHONE_OTP_SOURCE_LIMIT),
    input.db.select({ createdAt: clientPhoneOtpChallenges.createdAt })
      .from(clientPhoneOtpChallenges)
      .where(and(
        eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
        eq(clientPhoneOtpChallenges.destinationHash, destinationHash),
        gte(clientPhoneOtpChallenges.createdAt, resendStart),
      ))
      .orderBy(desc(clientPhoneOtpChallenges.createdAt))
      .limit(1),
  ]);
  const priorAttempts = recentDestination.reduce(
    (maximum, challenge) => Math.max(maximum, challenge.attemptCount),
    0,
  );

  if (
    recentDestination.length >= PHONE_OTP_DESTINATION_LIMIT
    || recentSource.length >= PHONE_OTP_SOURCE_LIMIT
    || recentResend.length > 0
    || priorAttempts >= PHONE_OTP_MAX_ATTEMPTS
  ) {
    return { state: "rate_limited" as const };
  }

  const token = randomChallengeToken();
  const code = randomSixDigitCode();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + PHONE_OTP_TTL_SECONDS * 1000).toISOString();
  await input.db.update(clientPhoneOtpChallenges).set({
    expiresAt: nowIso,
  }).where(and(
    eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
    eq(clientPhoneOtpChallenges.destinationHash, destinationHash),
    isNull(clientPhoneOtpChallenges.verifiedAt),
    gt(clientPhoneOtpChallenges.expiresAt, nowIso),
  ));
  await input.db.insert(clientPhoneOtpChallenges).values({
    id,
    organizationId: input.organizationId,
    phoneE164: input.phoneE164,
    destinationHash,
    sourceHash,
    challengeTokenHash: await sha256Hex(token),
    codeHash: await phoneOtpCodeHash(token, input.organizationId, code),
    attemptCount: priorAttempts,
    enrollmentClientId: input.enrollmentClientId || null,
    enrollmentSessionId: input.enrollmentSessionId || null,
    expiresAt,
    createdAt: nowIso,
  });
  return { state: "created" as const, id, token, code, expiresAt };
}

export async function recordPhoneOtpDelivery(
  db: Db,
  challengeId: string,
  result: { status: "accepted" | "failed" | "uncertain"; providerMessageId?: string | null },
) {
  await db.update(clientPhoneOtpChallenges).set({
    deliveryStatus: result.status,
    providerMessageId: result.providerMessageId || null,
  }).where(and(
    eq(clientPhoneOtpChallenges.id, challengeId),
    eq(clientPhoneOtpChallenges.deliveryStatus, "pending"),
  ));
}

export async function verifyPhoneOtpChallenge(input: {
  db: Db;
  organizationId: string;
  challengeToken: string;
  code: unknown;
  now?: Date;
}) {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(input.challengeToken)) return { state: "invalid" as const };
  const tokenHash = await sha256Hex(input.challengeToken);
  const [challenge] = await input.db.select().from(clientPhoneOtpChallenges).where(and(
    eq(clientPhoneOtpChallenges.organizationId, input.organizationId),
    eq(clientPhoneOtpChallenges.challengeTokenHash, tokenHash),
  )).limit(1);
  if (
    !challenge
    || challenge.expiresAt <= nowIso
    || challenge.verifiedAt
    || challenge.attemptCount >= PHONE_OTP_MAX_ATTEMPTS
    || !["accepted", "uncertain"].includes(challenge.deliveryStatus)
  ) {
    return { state: "invalid" as const };
  }

  const code = String(input.code || "").trim();
  const submittedHash = await phoneOtpCodeHash(input.challengeToken, input.organizationId, code);
  if (!/^\d{6}$/.test(code) || !constantTimeHexEqual(submittedHash, challenge.codeHash)) {
    const [attempted] = await input.db.update(clientPhoneOtpChallenges)
      .set({ attemptCount: sql`${clientPhoneOtpChallenges.attemptCount} + 1` })
      .where(and(
        eq(clientPhoneOtpChallenges.id, challenge.id),
        isNull(clientPhoneOtpChallenges.verifiedAt),
        gt(clientPhoneOtpChallenges.expiresAt, nowIso),
        lt(clientPhoneOtpChallenges.attemptCount, PHONE_OTP_MAX_ATTEMPTS),
      ))
      .returning({ attemptCount: clientPhoneOtpChallenges.attemptCount });
    return {
      state: "invalid" as const,
      attemptsRemaining: Math.max(0, PHONE_OTP_MAX_ATTEMPTS - (attempted?.attemptCount || PHONE_OTP_MAX_ATTEMPTS)),
    };
  }

  const proofExpiresAt = new Date(now.getTime() + PHONE_PROOF_TTL_SECONDS * 1000).toISOString();
  const [verified] = await input.db.update(clientPhoneOtpChallenges).set({
    verifiedAt: nowIso,
    proofExpiresAt,
  }).where(and(
    eq(clientPhoneOtpChallenges.id, challenge.id),
    eq(clientPhoneOtpChallenges.codeHash, submittedHash),
    isNull(clientPhoneOtpChallenges.verifiedAt),
    gt(clientPhoneOtpChallenges.expiresAt, nowIso),
    lt(clientPhoneOtpChallenges.attemptCount, PHONE_OTP_MAX_ATTEMPTS),
    inArray(clientPhoneOtpChallenges.deliveryStatus, ["accepted", "uncertain"]),
  )).returning();
  return verified
    ? { state: "verified" as const, challenge: verified }
    : { state: "invalid" as const };
}

export async function activeEnrollmentSession(db: Db, challenge: Challenge, now = new Date()) {
  if (!challenge.enrollmentClientId || !challenge.enrollmentSessionId) return null;
  const [session] = await db.select().from(clientPortalSessions).where(and(
    eq(clientPortalSessions.id, challenge.enrollmentSessionId),
    eq(clientPortalSessions.organizationId, challenge.organizationId),
    eq(clientPortalSessions.clientId, challenge.enrollmentClientId),
    gt(clientPortalSessions.expiresAt, now.toISOString()),
    isNull(clientPortalSessions.revokedAt),
  )).limit(1);
  return session || null;
}

export async function findVerifiedPhoneIdentity(
  db: Db,
  organizationId: string,
  phoneE164: string,
) {
  const [identity] = await db.select().from(clientPhoneIdentities).where(and(
    eq(clientPhoneIdentities.organizationId, organizationId),
    eq(clientPhoneIdentities.phoneE164, phoneE164),
    isNull(clientPhoneIdentities.revokedAt),
  )).limit(1);
  return identity || null;
}

export async function bindVerifiedPhoneIdentity(input: {
  db: Db;
  organizationId: string;
  clientId: string;
  phoneE164: string;
  now?: Date;
}) {
  const now = (input.now || new Date()).toISOString();
  const existing = await findVerifiedPhoneIdentity(input.db, input.organizationId, input.phoneE164);
  if (existing?.clientId && existing.clientId !== input.clientId) {
    return { state: "conflict" as const, identity: existing };
  }
  if (existing) {
    const [identity] = await input.db.update(clientPhoneIdentities).set({
      clientId: input.clientId,
      verifiedAt: now,
      lastUsedAt: now,
      updatedAt: now,
    }).where(and(
      eq(clientPhoneIdentities.id, existing.id),
      isNull(clientPhoneIdentities.revokedAt),
    )).returning();
    return identity
      ? { state: "bound" as const, identity }
      : { state: "conflict" as const, identity: existing };
  }

  const [inserted] = await input.db.insert(clientPhoneIdentities).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    clientId: input.clientId,
    phoneE164: input.phoneE164,
    verifiedAt: now,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();
  if (inserted) return { state: "bound" as const, identity: inserted };
  const raced = await findVerifiedPhoneIdentity(input.db, input.organizationId, input.phoneE164);
  return raced?.clientId === input.clientId
    ? { state: "bound" as const, identity: raced }
    : { state: "conflict" as const, identity: raced };
}

export async function markVerifiedPhoneIdentityUsed(db: Db, identityId: string, now = new Date()) {
  await db.update(clientPhoneIdentities).set({
    lastUsedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }).where(and(eq(clientPhoneIdentities.id, identityId), isNull(clientPhoneIdentities.revokedAt)));
}

export async function hasVerifiedPhoneIdentity(db: Db, organizationId: string, clientId: string) {
  const [identity] = await db.select({ id: clientPhoneIdentities.id }).from(clientPhoneIdentities).where(and(
    eq(clientPhoneIdentities.organizationId, organizationId),
    eq(clientPhoneIdentities.clientId, clientId),
    isNull(clientPhoneIdentities.revokedAt),
  )).limit(1);
  return Boolean(identity);
}

export async function readVerifiedPhoneProof(
  request: Request,
  db: Db,
  organizationId: string,
  now = new Date(),
) {
  const token = cookieValue(request, CLIENT_PHONE_CHALLENGE_COOKIE);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [proof] = await db.select({
    id: clientPhoneOtpChallenges.id,
    phoneE164: clientPhoneOtpChallenges.phoneE164,
  }).from(clientPhoneOtpChallenges).where(and(
    eq(clientPhoneOtpChallenges.organizationId, organizationId),
    eq(clientPhoneOtpChallenges.challengeTokenHash, await sha256Hex(token)),
    isNull(clientPhoneOtpChallenges.enrollmentClientId),
    isNotNull(clientPhoneOtpChallenges.verifiedAt),
    gt(clientPhoneOtpChallenges.proofExpiresAt, now.toISOString()),
    isNull(clientPhoneOtpChallenges.proofConsumedAt),
    inArray(clientPhoneOtpChallenges.deliveryStatus, ["accepted", "uncertain"]),
  )).limit(1);
  if (!proof) return null;
  const existingIdentity = await findVerifiedPhoneIdentity(db, organizationId, proof.phoneE164);
  return existingIdentity?.clientId ? null : proof;
}

export async function consumeVerifiedPhoneProof(db: Db, proofId: string, now = new Date()) {
  const nowIso = now.toISOString();
  const [proof] = await db.update(clientPhoneOtpChallenges).set({
    proofConsumedAt: nowIso,
  }).where(and(
    eq(clientPhoneOtpChallenges.id, proofId),
    isNotNull(clientPhoneOtpChallenges.verifiedAt),
    gt(clientPhoneOtpChallenges.proofExpiresAt, nowIso),
    isNull(clientPhoneOtpChallenges.proofConsumedAt),
  )).returning({
    id: clientPhoneOtpChallenges.id,
    phoneE164: clientPhoneOtpChallenges.phoneE164,
  });
  return proof || null;
}

export async function consumeChallengeProof(db: Db, challengeId: string, now = new Date()) {
  await db.update(clientPhoneOtpChallenges).set({
    proofConsumedAt: now.toISOString(),
  }).where(and(
    eq(clientPhoneOtpChallenges.id, challengeId),
    isNull(clientPhoneOtpChallenges.proofConsumedAt),
  ));
}
