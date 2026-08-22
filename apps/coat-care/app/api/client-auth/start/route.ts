import { createPhoneOtpChallenge, recordPhoneOtpDelivery } from "../../../../db/client-phone-auth";
import { resolvePortalSession } from "../../../../db/client-portal";
import { resolveStorefront, storefrontError } from "../../../../db/public-storefront";
import {
  CLIENT_PORTAL_COOKIE,
  buildTwilioPhoneOtpRequest,
  challengeCookie,
  cookieValue,
  genericPhoneAuthStartResponse,
  normalizeClientPhone,
  requestSource,
} from "../../../../lib/client-phone-auth";
import { deliveryConfig } from "../../../../lib/message-delivery";
import { requestIsSameOrigin } from "../../../../lib/portal-request";

const noStoreHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) {
      return Response.json({
        ok: false,
        error: "Request origin could not be verified.",
      }, { status: 403, headers: noStoreHeaders });
    }
    const body = await request.json() as {
      phone?: unknown;
      salonSlug?: unknown;
      locationSlug?: unknown;
    };
    const storefront = await resolveStorefront({
      organizationSlug: body.salonSlug,
      locationSlug: body.locationSlug,
    });
    const config = deliveryConfig();
    if (!config.sms.configured) {
      return Response.json({
        ok: false,
        configured: false,
        error: "Phone verification is temporarily unavailable.",
      }, { status: 503, headers: noStoreHeaders });
    }

    const phoneE164 = normalizeClientPhone(body.phone);
    if (!phoneE164) {
      return Response.json(genericPhoneAuthStartResponse(), { headers: noStoreHeaders });
    }

    let enrollmentClientId: string | null = null;
    let enrollmentSessionId: string | null = null;
    const portalToken = cookieValue(request, CLIENT_PORTAL_COOKIE);
    if (portalToken) {
      try {
        const access = await resolvePortalSession(portalToken);
        if (
          access.client
          && access.session
          && access.client.organizationId === storefront.organization.id
        ) {
          enrollmentClientId = access.client.id;
          enrollmentSessionId = access.session.id;
        }
      } catch {
        // A stale portal cookie must not change the pre-verification response.
      }
    }

    const challenge = await createPhoneOtpChallenge({
      db: storefront.db,
      organizationId: storefront.organization.id,
      phoneE164,
      source: requestSource(request),
      pepper: config.sms.authToken,
      enrollmentClientId,
      enrollmentSessionId,
    });
    if (challenge.state === "rate_limited") {
      return Response.json(genericPhoneAuthStartResponse(), { headers: noStoreHeaders });
    }

    const providerRequest = buildTwilioPhoneOtpRequest({
      accountSid: config.sms.accountSid,
      authToken: config.sms.authToken,
      messagingServiceSid: config.sms.messagingServiceSid,
      phoneE164,
      code: challenge.code,
    });
    try {
      const providerResponse = await fetch(providerRequest.url, providerRequest.init);
      if (!providerResponse.ok) {
        await recordPhoneOtpDelivery(storefront.db, challenge.id, { status: "failed" });
      } else {
        const providerBody = await providerResponse.json() as { sid?: string };
        await recordPhoneOtpDelivery(storefront.db, challenge.id, {
          status: providerBody.sid ? "accepted" : "uncertain",
          providerMessageId: providerBody.sid || null,
        });
      }
    } catch {
      // Twilio may have accepted a request before the connection failed.
      await recordPhoneOtpDelivery(storefront.db, challenge.id, { status: "uncertain" });
    }

    return Response.json(genericPhoneAuthStartResponse(), {
      headers: {
        ...noStoreHeaders,
        "set-cookie": challengeCookie(challenge.token),
      },
    });
  } catch (error) {
    return storefrontError(error, "Phone verification could not be started.");
  }
}
