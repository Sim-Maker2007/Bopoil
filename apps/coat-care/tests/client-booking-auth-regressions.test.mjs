import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("portal cookie requests require a trustworthy same-origin signal", async () => {
  const {
    portalCookieRequestIsSameOrigin,
    portalCookieTokenFromRequest,
    portalTokenFromRequest,
    requestIsSameOrigin,
  } = await import("../lib/portal-request.ts");
  const token = "a".repeat(43);
  const cookie = `__Host-pet_portal=${token}`;
  const sameOrigin = new Request("https://coat.example/api/bookings", { method: "POST", headers: { cookie, origin: "https://coat.example" } });
  const crossOrigin = new Request("https://coat.example/api/bookings", { method: "POST", headers: { cookie, origin: "https://attacker.example" } });
  const fetchMetadata = new Request("https://coat.example/api/portal/session", { method: "PATCH", headers: { cookie, "sec-fetch-site": "same-origin" } });
  const opaqueSameOriginForm = new Request("https://coat.example/portal/access/token", { method: "POST", headers: { origin: "null", "sec-fetch-site": "same-origin" } });
  const opaqueCrossOriginForm = new Request("https://coat.example/portal/access/token", { method: "POST", headers: { origin: "null", "sec-fetch-site": "cross-site" } });
  const sameOriginReferrer = new Request("https://coat.example/portal/signout", { headers: { cookie, referer: "https://coat.example/portal" } });
  const noCookie = new Request("https://coat.example/api/bookings", { method: "POST", headers: { origin: "https://attacker.example" } });

  assert.equal(portalCookieTokenFromRequest(sameOrigin), token);
  assert.equal(portalTokenFromRequest(sameOrigin), token, "non-portal paths must fall back to the cookie, not the first URL segment");
  assert.equal(requestIsSameOrigin(sameOrigin), true);
  assert.equal(requestIsSameOrigin(crossOrigin), false);
  assert.equal(portalCookieRequestIsSameOrigin(crossOrigin), false);
  assert.equal(portalCookieRequestIsSameOrigin(fetchMetadata), true);
  assert.equal(requestIsSameOrigin(opaqueSameOriginForm), true);
  assert.equal(requestIsSameOrigin(opaqueCrossOriginForm), false);
  assert.equal(portalCookieRequestIsSameOrigin(sameOriginReferrer), true);
  assert.equal(portalCookieRequestIsSameOrigin(noCookie), true);
  const malformedCookie = new Request("https://coat.example/api/bookings", { headers: { cookie: "__Host-pet_portal=%" } });
  assert.equal(portalCookieTokenFromRequest(malformedCookie), "");
});

test("authenticated booking resolves owned pet and contact data on the server", async () => {
  const source = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /petId\?: string/);
  assert.match(source, /resolvePortalSession\(portalToken\)/);
  assert.match(source, /access\.client\.organizationId !== organization\.id/);
  assert.match(source, /eq\(pets\.id, requestedPetId\)/);
  assert.match(source, /eq\(pets\.organizationId, organization\.id\)/);
  assert.match(source, /eq\(pets\.clientId, access\.client\.id\)/);
  assert.match(source, /clientName = access\.client\.fullName/);
  assert.match(source, /email = access\.client\.email/);
  assert.match(source, /phone = access\.client\.phone/);
  assert.match(source, /petName = ownedPet\.name/);
  assert.match(source, /portalCookieRequestIsSameOrigin\(request\)/);
});

test("anonymous bookings never reuse an existing CRM client or pet", async () => {
  const source = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /publicRecordId|existingPet/);
  assert.match(source, /or\(eq\(sql<string>`lower\(\$\{clients\.email\}\)`/);
  assert.match(source, /substr\(\$\{storedPhoneDigits\(\)\}, -10\)/);
  assert.match(source, /if \(contactConflict\) \{[\s\S]*prepareSecureBookingRecovery\(db,[\s\S]*return secureClientBookingRequired\(\)/);
  assert.match(source, /clientId = crypto\.randomUUID\(\)/);
  assert.match(source, /petId = crypto\.randomUUID\(\)/);
  assert.match(source, /if \(clientIdentityConstraint\(error\)\) \{[\s\S]*return secureClientBookingRequired\(\)/);
  assert.doesNotMatch(source, /insert\(clients\)[\s\S]{0,240}\.onConflictDoNothing\(\)/);
  assert.match(source, /\.limit\(6\)/);
  assert.match(source, /\.limit\(20\)/);
});

test("public identity throttles normalize SQLite timestamps and record explicit ISO instants", async () => {
  const [booking, portalLink] = await Promise.all([
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/request-link/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [booking, portalLink]) {
    assert.match(source, /datetime\(\$\{portalAccessRequests\.requestedAt\}\) >= datetime\(\$\{cutoff\}\)/);
    assert.match(source, /requestedAt\s*\}/);
    assert.doesNotMatch(source, /gte\(portalAccessRequests\.requestedAt, cutoff\)/);
  }
});

test("verified phone proof, identity, booking, and trusted session are bound safely", async () => {
  const source = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /readVerifiedPhoneProof\(request, db, organization\.id\)/);
  assert.match(source, /normalizedPhone === proof\.phoneE164/);
  assert.match(source, /insert\(clientPhoneIdentities\)/);
  assert.match(source, /clientPhoneOtpChallenges\.proofConsumedAt/);
  assert.match(source, /clientPhoneOtpChallenges\.proofExpiresAt/);
  assert.match(source, /clientPhoneOtpChallenges\.proofConsumedAt\} is null/);
  assert.match(source, /db\.batch\(\[clientInsert, petInsert, phoneIdentityInsert, phoneProofClaim, appointmentInsert/);
  assert.match(source, /issuePortalSession\(db, clientId, 30\)/);
  assert.match(source, /trustedPortalCookie = portalCookie\(trustedSession\.token\)/);
  assert.match(source, /responseHeaders\.append\("set-cookie", trustedPortalCookie\)/);
  assert.match(source, /responseHeaders\.append\("set-cookie", challengeCookie\("", 0\)\)/);
  assert.match(source, /trustedSession: Boolean\(trustedPortalCookie\)/);

  const { normalizeClientPhone, portalCookie } = await import("../lib/client-phone-auth.ts");
  assert.equal(normalizeClientPhone("(416) 555-0123"), "+14165550123");
  assert.equal(normalizeClientPhone("+1 416 555 0123"), "+14165550123");
  assert.equal(normalizeClientPhone("+44 20 7946 0958"), null);
  assert.match(portalCookie("token"), /Max-Age=2592000/);
});

test("failed deposit setup gives a newly-created profile a bounded retry path", async () => {
  const source = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  const failure = source.slice(source.indexOf("catch (paymentError)"), source.indexOf("queueClientTemplateMessage", source.indexOf("catch (paymentError)")));
  assert.match(failure, /issuePortalSession\(db, clientId, 15 \/ \(24 \* 60\)\)/);
  assert.match(failure, /portalCookie\(recoverySession\.token, 15 \* 60\)/);
  assert.match(failure, /recoveryHeaders\.append\("set-cookie", recoveryCookie\)/);
  assert.match(failure, /recoveryAvailable: !authenticatedBooking && Boolean\(recoveryCookie\)/);
});

test("waitlist uses the same secure identity boundary as booking", async () => {
  const [route, experience] = await Promise.all([
    readFile(new URL("../app/api/waitlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-experience.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /if \(!requestIsSameOrigin\(request\)\)/);
  assert.match(route, /if \(requestedPetId\)[\s\S]*resolvePortalSession\(token\)/);
  assert.match(route, /eq\(pets\.id, requestedPetId\)/);
  assert.match(route, /eq\(pets\.organizationId, organization\.id\)/);
  assert.match(route, /eq\(pets\.clientId, access\.client\.id\)/);
  assert.match(route, /if \(contactConflict\) return secureClientWaitlistRequired\(\)/);
  assert.match(route, /clientId = crypto\.randomUUID\(\)/);
  assert.match(route, /petId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(route, /existingClient|existingPet|publicRecordId/);
  assert.match(route, /datetime\(\$\{portalAccessRequests\.requestedAt\}\) >= datetime\(\$\{recent\}\)/);
  assert.match(route, /readVerifiedPhoneProof\(request, db, organization\.id\)/);
  assert.match(route, /db\.batch\(\[[\s\S]*clientInsert,[\s\S]*petInsert,[\s\S]*phoneIdentityInsert,[\s\S]*phoneProofClaim,[\s\S]*waitlistInsert/);
  assert.match(route, /trustedSession: Boolean\(trustedPortalCookie\)/);
  assert.match(experience, /authenticatedBooking[\s\S]*\? \{ petId: selectedOwnedPet!\.id \}/);
  assert.match(experience, /fetch\("\/api\/waitlist",[\s\S]*credentials: "same-origin"/);
  assert.match(experience, /authenticatedBooking \? <div className="saved-booking-identity"/);
  assert.match(experience, /if \(result\.trustedSession\)[\s\S]*await loadBookingContext\(\)/);
});

test("emailed portal links expire in 15 minutes while exchanged cookies last 30 days", async () => {
  const [helper, requestLink, booking, webhook, access, pilot, migration] = await Promise.all([
    readFile(new URL("../db/client-portal.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/request-link/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/access/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pilot.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0029_client_phone_auth.sql", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /PORTAL_EMAIL_LINK_TTL_MS = 15 \* 60_000/);
  assert.match(helper, /PORTAL_TRUSTED_SESSION_TTL_MS = 30 \* 86400_000/);
  assert.match(helper, /issuePortalEmailSession/);
  for (const source of [requestLink, booking, webhook]) assert.match(source, /issuePortalEmailSession/);
  assert.match(access, /issuePortalSession\(access\.db, access\.client\.id\)/);
  assert.match(access, /Max-Age=2592000/);
  assert.match(pilot, /This link expires in 15 minutes\. After you open it, this browser stays trusted for 30 days\./);
  assert.doesNotMatch(pilot, /This link expires in 30 days\./);
  assert.match(migration, /UPDATE `communication_templates`/);
});

test("unsafe portal actions and access exchange require same-origin POSTs", async () => {
  const [signout, portalMutation, vaccineUpload, vaccineDelete, accessExchange] = await Promise.all([
    readFile(new URL("../app/portal/signout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/access/[token]/route.ts", import.meta.url), "utf8"),
  ]);
  const [beforePost, post = ""] = signout.split("export async function POST");
  const get = beforePost.slice(beforePost.indexOf("export async function GET"));
  assert.doesNotMatch(get, /revokePortalSession|set-cookie/);
  assert.match(post, /portalCookieRequestIsSameOrigin\(request\)/);
  assert.ok(post.indexOf("revokePortalSession") < post.indexOf('"set-cookie"'));
  for (const source of [portalMutation, vaccineUpload, vaccineDelete]) assert.match(source, /requestIsSameOrigin\(request\)/);
  const accessPost = accessExchange.slice(accessExchange.indexOf("export async function POST"));
  assert.match(accessPost, /requestIsSameOrigin\(request\)/);
  assert.ok(accessPost.indexOf("requestIsSameOrigin") < accessPost.indexOf("resolvePortalSession"));
});
