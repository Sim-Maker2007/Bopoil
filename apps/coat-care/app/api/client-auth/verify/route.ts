import { and, eq, isNull } from "drizzle-orm";
import {
  activeEnrollmentSession,
  bindVerifiedPhoneIdentity,
  consumeChallengeProof,
  findVerifiedPhoneIdentity,
  markVerifiedPhoneIdentityUsed,
  verifyPhoneOtpChallenge,
} from "../../../../db/client-phone-auth";
import { issuePortalSession } from "../../../../db/client-portal";
import { resolveStorefront, storefrontError } from "../../../../db/public-storefront";
import { clientPortalSessions } from "../../../../db/schema";
import {
  CLIENT_PHONE_CHALLENGE_COOKIE,
  PHONE_PROOF_TTL_SECONDS,
  challengeCookie,
  cookieValue,
  portalCookie,
} from "../../../../lib/client-phone-auth";
import { requestIsSameOrigin } from "../../../../lib/portal-request";

const noStoreHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

function responseWithCookies(
  body: Record<string, unknown>,
  cookies: string[],
  status = 200,
) {
  const headers = new Headers(noStoreHeaders);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

function invalidCodeResponse() {
  return Response.json({
    verified: false,
    error: "The verification code is invalid or expired.",
  }, { status: 400, headers: noStoreHeaders });
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) {
      return Response.json({
        verified: false,
        error: "Request origin could not be verified.",
      }, { status: 403, headers: noStoreHeaders });
    }
    const body = await request.json() as {
      code?: unknown;
      salonSlug?: unknown;
      locationSlug?: unknown;
    };
    const storefront = await resolveStorefront({
      organizationSlug: body.salonSlug,
      locationSlug: body.locationSlug,
    });
    const challengeToken = cookieValue(request, CLIENT_PHONE_CHALLENGE_COOKIE);
    const verification = await verifyPhoneOtpChallenge({
      db: storefront.db,
      organizationId: storefront.organization.id,
      challengeToken,
      code: body.code,
    });
    if (verification.state !== "verified") return invalidCodeResponse();

    const now = new Date();
    const enrollmentSession = await activeEnrollmentSession(
      storefront.db,
      verification.challenge,
      now,
    );
    if (enrollmentSession && verification.challenge.enrollmentClientId) {
      const binding = await bindVerifiedPhoneIdentity({
        db: storefront.db,
        organizationId: storefront.organization.id,
        clientId: verification.challenge.enrollmentClientId,
        phoneE164: verification.challenge.phoneE164,
        now,
      });
      await consumeChallengeProof(storefront.db, verification.challenge.id, now);
      if (binding.state !== "bound") {
        return responseWithCookies({
          verified: true,
          authenticated: true,
          status: "returning_client",
          fastSignInEnabled: false,
          error: "That mobile is already linked to another profile. Use a different number or contact the salon.",
        }, [
          challengeCookie("", 0),
        ], 409);
      }
      const rotated = await issuePortalSession(
        storefront.db,
        verification.challenge.enrollmentClientId,
        30,
      );
      await storefront.db.update(clientPortalSessions).set({
        revokedAt: now.toISOString(),
      }).where(and(
        eq(clientPortalSessions.id, enrollmentSession.id),
        isNull(clientPortalSessions.revokedAt),
      ));
      return responseWithCookies({
        verified: true,
        authenticated: true,
        status: "returning_client",
        fastSignInEnabled: true,
      }, [
        portalCookie(rotated.token),
        challengeCookie("", 0),
      ]);
    }

    const identity = await findVerifiedPhoneIdentity(
      storefront.db,
      storefront.organization.id,
      verification.challenge.phoneE164,
    );
    if (identity?.clientId) {
      await consumeChallengeProof(storefront.db, verification.challenge.id, now);
      const rotated = await issuePortalSession(storefront.db, identity.clientId, 30);
      await markVerifiedPhoneIdentityUsed(storefront.db, identity.id, now);
      return responseWithCookies({
        verified: true,
        authenticated: true,
        status: "returning_client",
        fastSignInEnabled: true,
      }, [
        portalCookie(rotated.token),
        challengeCookie("", 0),
      ]);
    }

    return responseWithCookies({
      verified: true,
      authenticated: false,
      status: "new_client",
      fastSignInEnabled: false,
    }, [
      challengeCookie(challengeToken, PHONE_PROOF_TTL_SECONDS),
    ]);
  } catch (error) {
    return storefrontError(error, "Phone verification could not be completed.");
  }
}
