import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CLIENT_PHONE_CHALLENGE_COOKIE,
  PHONE_OTP_MAX_ATTEMPTS,
  PHONE_OTP_TTL_SECONDS,
  buildTwilioPhoneOtpRequest,
  challengeCookie,
  clientPhoneChanged,
  constantTimeHexEqual,
  cookieValue,
  genericPhoneAuthStartResponse,
  normalizeClientPhone,
  phoneOtpCodeHash,
  randomChallengeToken,
  randomSixDigitCode,
} from "../lib/client-phone-auth.ts";
import { requestIsSameOrigin } from "../lib/portal-request.ts";

function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("phone identifiers are canonicalized conservatively", () => {
  assert.equal(normalizeClientPhone("(514) 555-0199"), "+15145550199");
  assert.equal(normalizeClientPhone("+1 514 555 0199"), "+15145550199");
  assert.equal(normalizeClientPhone("5145550199 ext 4"), null);
  assert.equal(normalizeClientPhone("+44 20 7946 0958"), null);
  assert.equal(normalizeClientPhone(""), null);
});

test("phone lifecycle distinguishes formatting edits from authenticator changes", () => {
  assert.equal(clientPhoneChanged("(514) 555-0199", "+1 514 555 0199"), false);
  assert.equal(clientPhoneChanged("+1 514 555 0199", "+1 438 555 0100"), true);
  assert.equal(clientPhoneChanged("555-0199", "555-0100"), true);
});

test("OTP codes are six digits and hashes require the high-entropy challenge secret", async () => {
  const token = randomChallengeToken();
  const otherToken = randomChallengeToken();
  const code = randomSixDigitCode();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(code, /^\d{6}$/);
  const expected = await phoneOtpCodeHash(token, "org_test", code);
  assert.equal(constantTimeHexEqual(expected, await phoneOtpCodeHash(token, "org_test", code)), true);
  assert.equal(constantTimeHexEqual(expected, await phoneOtpCodeHash(otherToken, "org_test", code)), false);
  assert.equal(constantTimeHexEqual(expected, await phoneOtpCodeHash(token, "org_other", code)), false);
  assert.equal(PHONE_OTP_TTL_SECONDS, 600);
  assert.equal(PHONE_OTP_MAX_ATTEMPTS, 5);
});

test("challenge cookies are host-only, HttpOnly, secure, short-lived, and parse safely", () => {
  const token = randomChallengeToken();
  const serialized = challengeCookie(token);
  assert.match(serialized, new RegExp(`^${CLIENT_PHONE_CHALLENGE_COOKIE}=`));
  assert.match(serialized, /Path=\//);
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /Secure/);
  assert.match(serialized, /SameSite=Lax/);
  assert.match(serialized, /Max-Age=600/);
  const request = new Request("https://coat.example/api/client-auth/verify", {
    headers: { cookie: `other=1; ${CLIENT_PHONE_CHALLENGE_COOKIE}=${encodeURIComponent(token)}` },
  });
  assert.equal(cookieValue(request, CLIENT_PHONE_CHALLENGE_COOKIE), token);
});

test("authenticated enrollment is accepted only from the same origin", () => {
  assert.equal(requestIsSameOrigin(new Request("https://coat.example/api/client-auth/start", {
    method: "POST",
    headers: { origin: "https://coat.example" },
  })), true);
  assert.equal(requestIsSameOrigin(new Request("https://coat.example/api/client-auth/start", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  })), false);
  assert.equal(requestIsSameOrigin(new Request("https://coat.example/api/client-auth/start", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  })), true);
});

test("Twilio OTP payload contains no client or pet profile data", async () => {
  const request = buildTwilioPhoneOtpRequest({
    accountSid: "AC123",
    authToken: "secret",
    messagingServiceSid: "MG123",
    phoneE164: "+15145550199",
    code: "012345",
  });
  assert.equal(request.url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
  const form = new URLSearchParams(String(request.init.body));
  assert.equal(form.get("To"), "+15145550199");
  assert.equal(form.get("MessagingServiceSid"), "MG123");
  assert.match(form.get("Body") || "", /012345/);
  assert.doesNotMatch(form.get("Body") || "", /pet|breed|appointment|client/i);
});

test("start endpoint stays account-agnostic and rate limits survive resends", async () => {
  const [start, database] = await Promise.all([
    source("../app/api/client-auth/start/route.ts"),
    source("../db/client-phone-auth.ts"),
  ]);
  assert.deepEqual(genericPhoneAuthStartResponse(), {
    ok: true,
    expiresInSeconds: 600,
    retryAfterSeconds: 30,
  });
  assert.doesNotMatch(start, /\bclients\b|clients\.phone/);
  assert.match(start, /genericPhoneAuthStartResponse\(\)/);
  assert.match(start, /challenge\.state === "rate_limited"/);
  assert.match(start, /requestIsSameOrigin\(request\)/);
  assert.doesNotMatch(start, /portalCookieRequestIsSameOrigin\(request\)/);
  assert.match(database, /PHONE_OTP_DESTINATION_LIMIT/);
  assert.match(database, /PHONE_OTP_SOURCE_LIMIT/);
  assert.match(database, /priorAttempts >= PHONE_OTP_MAX_ATTEMPTS/);
  assert.match(database, /Math\.max\(maximum, challenge\.attemptCount\)/);
  assert.match(database, /attemptCount: priorAttempts/);
  assert.match(database, /expiresAt: nowIso/);
  assert.match(database, /24 \* 60 \* 60 \* 1000/);
});

test("verify endpoint authenticates only verified identities and rotates the trusted session", async () => {
  const [verify, database, schema] = await Promise.all([
    source("../app/api/client-auth/verify/route.ts"),
    source("../db/client-phone-auth.ts"),
    source("../db/schema.ts"),
  ]);
  assert.match(schema, /client_phone_identities_active_phone_unique/);
  assert.match(schema, /clientId: text\("client_id"\)\.notNull\(\)\.references\(\(\) => clients\.id\)/);
  assert.match(schema, /challengeTokenHash: text\("challenge_token_hash"\)\.notNull\(\)\.unique\(\)/);
  assert.match(database, /findVerifiedPhoneIdentity/);
  assert.doesNotMatch(database, /clients\.phone/);
  assert.match(database, /attemptCount} \+ 1/);
  assert.match(database, /isNull\(clientPhoneOtpChallenges\.enrollmentClientId\)/);
  assert.match(database, /isNull\(clientPhoneOtpChallenges\.proofConsumedAt\)/);
  assert.match(verify, /issuePortalSession\([\s\S]*?30/);
  assert.match(verify, /portalCookie\(rotated\.token\)/);
  assert.match(verify, /consumeChallengeProof/);
  assert.match(verify, /requestIsSameOrigin\(request\)/);
  assert.match(verify, /status: "returning_client"/);
  assert.match(verify, /status: "new_client"/);
});

test("phone enrollment conflicts do not claim that fast sign-in was enabled", async () => {
  const [verify, experience] = await Promise.all([
    source("../app/api/client-auth/verify/route.ts"),
    source("../app/booking-experience.tsx"),
  ]);
  assert.match(verify, /if \(binding\.state !== "bound"\)/);
  assert.match(verify, /fastSignInEnabled: false/);
  assert.match(verify, /another profile/);
  assert.match(verify, /challengeCookie\("", 0\)[\s\S]*409/);
  assert.match(experience, /response\.status === 409 && result\.verified === true && result\.fastSignInEnabled === false/);
  assert.match(experience, /setClientAuthStep\("phone"\)/);
});

test("portal phone changes revoke stale identities, enrollments, and other sessions atomically", async () => {
  const portal = await source("../app/api/portal/[token]/route.ts");
  const profileStart = portal.indexOf('action === "profile"');
  const profileEnd = portal.indexOf('action === "add_pet"');
  const profile = portal.slice(profileStart, profileEnd);
  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  assert.match(profile, /clientPhoneChanged\(client\.phone, phone\)/);
  assert.match(profile, /update\(clientPhoneIdentities\)[\s\S]*?revokedAt: changedAt/);
  assert.match(profile, /ne\(clientPhoneIdentities\.phoneE164, nextPhoneE164\)/);
  assert.match(profile, /update\(clientPhoneOtpChallenges\)[\s\S]*?proofConsumedAt: changedAt/);
  assert.match(profile, /ne\(clientPhoneOtpChallenges\.phoneE164, nextPhoneE164\)/);
  assert.match(profile, /update\(clientPortalSessions\)[\s\S]*?ne\(clientPortalSessions\.id, result\.session\.id\)/);
  assert.match(profile, /await db\.batch\(\[/);
  assert.doesNotMatch(profile, /insert\(clientPhoneIdentities\)|bindVerifiedPhoneIdentity/);
});
