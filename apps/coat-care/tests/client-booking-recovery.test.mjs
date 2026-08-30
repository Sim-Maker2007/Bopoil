import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("identity conflicts prepare one privacy-safe canonical-contact recovery path", async () => {
  const [route, experience] = await Promise.all([
    source("../app/api/bookings/route.ts"),
    source("../app/booking-experience.tsx"),
  ]);
  const response = route.slice(route.indexOf("function secureClientBookingRequired"), route.indexOf("function clientIdentityConstraint"));
  assert.match(response, /intent: "secure_access_required"/);
  assert.match(response, /status: 409/);
  assert.match(response, /"cache-control": "no-store"/);
  assert.doesNotMatch(response, /clientId|petId|email|phone/);

  const recovery = route.slice(route.indexOf("async function prepareSecureBookingRecovery"), route.indexOf("export async function POST"));
  assert.match(recovery, /eq\(pets\.clientId, input\.clientId\)/);
  assert.match(recovery, /issuePortalEmailSession\(db, input\.clientId\)/);
  assert.match(recovery, /portalAccessUrl\(process\.env\.DELIVERY_PUBLIC_URL \|\| input\.origin, recoverySession\.token, returnTo\)/);
  assert.match(recovery, /queuePortalAccessMessage/);
  assert.doesNotMatch(recovery, /input\.email|input\.phone/);
  assert.match(route, /if \(contactConflict\) \{[\s\S]*prepareSecureBookingRecovery\(db,[\s\S]*clientId: contactConflict\.id[\s\S]*return secureClientBookingRequired\(\)/);
  assert.match(route, /if \(clientIdentityConstraint\(error\)\) \{[\s\S]*return secureClientBookingRequired\(\)/);

  const intentBranch = experience.slice(experience.indexOf('result.intent === "secure_access_required"'), experience.indexOf("} else if (result.recoveryAvailable)"));
  assert.match(intentBranch, /setManageEmail\(email\.trim\(\)\)/);
  assert.match(intentBranch, /setManageReturnTo\(currentBookingReturnTo\)/);
  assert.match(intentBranch, /setManageOpen\(true\)/);
  assert.doesNotMatch(intentBranch, /loadAvailability/);
});

test("new deposit holds expose bounded, owner-scoped recovery without provider secrets", async () => {
  const [booking, portalRoute, portalExperience, paymentPage] = await Promise.all([
    source("../app/api/bookings/route.ts"),
    source("../app/api/portal/[token]/route.ts"),
    source("../app/portal/[token]/portal-experience.tsx"),
    source("../app/booking/payment/[id]/page.tsx"),
  ]);

  assert.match(booking, /if \(!authenticatedBooking && !reclaimedAbandonedProfile && !trustedPortalCookie\)/);
  assert.match(booking, /Math\.min\(120, Math\.max\(60, settings\.depositHoldMinutes \+ 30\)\)/);
  assert.match(booking, /issuePortalSession\(db, clientId, recoveryMinutes \/ \(24 \* 60\)\)/);
  assert.match(booking, /portalCookie\(recoverySession\.token, recoveryMinutes \* 60\)/);
  assert.match(booking, /recoverySession: Boolean\(recoveryPortalCookie\)/);

  const deposits = portalRoute.slice(portalRoute.indexOf("db.select({\n      id: onlinePaymentSessions.id"), portalRoute.indexOf("]);\n  const now"));
  assert.match(deposits, /eq\(onlinePaymentSessions\.organizationId, client\.organizationId\)/);
  assert.match(deposits, /eq\(onlinePaymentSessions\.clientId, client\.id\)/);
  assert.match(deposits, /eq\(onlinePaymentSessions\.purpose, "deposit"\)/);
  assert.match(deposits, /eq\(onlinePaymentSessions\.status, "open"\)/);
  assert.match(deposits, /gt\(onlinePaymentSessions\.expiresAt, nowIso\)/);
  assert.match(deposits, /eq\(appointments\.depositStatus, "pending"\)/);
  assert.doesNotMatch(deposits, /checkoutUrl|providerSessionId|providerPaymentIntentId/);
  assert.match(portalRoute, /resumePath: `\/booking\/payment\/\$\{encodeURIComponent\(deposit\.id\)\}`/);
  assert.match(portalExperience, /Complete secure deposit/);
  assert.match(portalExperience, /href=\{deposit\.resumePath\}/);
  assert.match(paymentPage, /new URLSearchParams\(\{ pet: row\.petId, service: row\.serviceId \}\)/);
});

test("a failed-deposit-only identity can be retried without exposing an established client profile", async () => {
  const booking = await source("../app/api/bookings/route.ts");
  assert.match(booking, /bothContactsMatch/);
  assert.match(booking, /onlyFailedDepositAttempts = Number\(priorHistory\?\.total \|\| 0\) > 0 && Number\(priorHistory\?\.otherHistory \|\| 0\) === 0/);
  assert.match(booking, /eq\(sql<string>`lower\(\$\{pets\.name\}\)`, petName\.toLowerCase\(\)\)/);
  assert.match(booking, /reclaimedAbandonedProfile = true/);
  assert.match(booking, /authenticatedBooking \|\| reclaimedAbandonedProfile/);
  assert.match(booking, /!authenticatedBooking && !reclaimedAbandonedProfile && !recoveryCookie/);
  assert.match(booking, /identity: authenticatedBooking \? "portal_session" : reclaimedAbandonedProfile \? "reclaimed_failed_deposit_profile"/);
});

test("public booking pages cover the full configured window in bounded accessible pages", async () => {
  const [api, experience] = await Promise.all([
    source("../app/api/availability/route.ts"),
    source("../app/booking-experience.tsx"),
  ]);

  assert.match(api, /requestedDays > 21/);
  assert.match(api, /bookingWindowEnd = addDays\(today, provisional\.settings\.bookingWindowDays\)/);
  assert.match(api, /\.filter\(\(date\) => date <= bookingWindowEnd\)/);
  assert.match(api, /previousFrom:/);
  assert.match(api, /nextFrom:/);

  assert.match(experience, /bookingWindowDays: number/);
  assert.match(experience, /requestAvailabilityPage\(serviceId, from\)/);
  assert.match(experience, /while \(from\)/);
  assert.match(experience, /Find next opening/);
  assert.match(experience, /availability\.dates\.map/);
  assert.doesNotMatch(experience, /availability\.dates\.slice\(0, 10\)/);
  assert.match(experience, /aria-label=\{`\$\{dayLabel\(selectedDate\)\} at \$\{slot\.timeLabel\}/);
  assert.match(experience, /Show all \$\{dateSlots\.length\} times/);
  assert.match(experience, /\["morning", "afternoon", "evening"\]/);
});

test("expired portal links retain only validated internal intent and show inline renewal", async () => {
  const [access, experience, portal] = await Promise.all([
    source("../app/portal/access/[token]/route.ts"),
    source("../app/booking-experience.tsx"),
    source("../app/portal/[token]/portal-experience.tsx"),
  ]);

  assert.match(access, /safePortalReturnTo/);
  assert.match(access, /function expiredLocation/);
  assert.match(access, /destination\.searchParams\.set\("portal", "expired"\)/);
  assert.match(access, /new URL\(returnToFrom\(request\) \|\| "\/portal", request\.url\)/);
  const accessPost = access.slice(access.indexOf("export async function POST"));
  assert.ok(accessPost.indexOf("requestIsSameOrigin") < accessPost.indexOf("resolvePortalSession"));

  const expiredEffect = experience.slice(experience.indexOf('url.searchParams.get("portal") !== "expired"'), experience.indexOf("}, []);", experience.indexOf('url.searchParams.get("portal") !== "expired"')));
  assert.match(expiredEffect, /setManageOpen\(true\)/);
  assert.match(expiredEffect, /url\.searchParams\.delete\("portal"\)/);
  assert.match(expiredEffect, /window\.history\.replaceState/);
  assert.doesNotMatch(expiredEffect, /setManageEmail/);

  assert.match(portal, /function requestFreshLink/);
  assert.match(portal, /fetch\("\/api\/portal\/request-link"/);
  assert.match(portal, /type="email" autoComplete="email" required/);
  assert.match(portal, /for privacy, the response is the same whether or not it matches an account/);
});

test("trusted cookie sessions slide within an absolute lifetime without elevating bounded deposit recovery", async () => {
  const [route, helper] = await Promise.all([
    source("../app/api/portal/[token]/route.ts"),
    source("../db/client-portal.ts"),
  ]);
  assert.match(route, /cookieBackedSessionRoute/);
  assert.match(route, /trustedSession = new Date\(result\.session\.expiresAt\)\.getTime\(\) - sessionCreatedAt\.getTime\(\) > PORTAL_EMAIL_LINK_TTL_MS \* 2/);
  assert.match(route, /renewPortalSession\(result\.db, result\.session\.id\)/);
  assert.match(route, /portalCookie\(cookieToken, maxAgeSeconds\)/);
  assert.match(helper, /PORTAL_TRUSTED_SESSION_ABSOLUTE_TTL_MS = 90 \* 86400_000/);
  assert.match(helper, /Math\.min\(now\.getTime\(\) \+ PORTAL_TRUSTED_SESSION_TTL_MS, absoluteExpiry\)/);
  assert.match(helper, /\(\(\$\{clientPortalSessions\.createdAt\}\)::timestamp \+ interval '90 days'\) > \(\$\{nowIso\}\)::timestamp/);
});
