import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { decideBookingAccess, isBookingApiPath, isBookingPagePath, onlineBookingEnabled, BOOKING_PAUSE_PATH } = await import("../lib/booking-gate.ts");
const { transformPublicFile, pauseBookingInHtml } = await import("../../../scripts/public-site-boutique.mjs");

const paused = {};
const open = { ONLINE_BOOKING_ENABLED: "true" };

test("the reservation gate covers the booking pages and the APIs only they use", () => {
  for (const path of ["/book", "/book/bopoil", "/book/bopoil/gatineau"]) assert.equal(isBookingPagePath(path), true, path);
  for (const path of ["/api/bookings", "/api/square-bookings", "/api/availability", "/api/catalog", "/api/booking-context", "/api/client-auth/start", "/api/client-auth/verify"]) {
    assert.equal(isBookingApiPath(path), true, path);
  }
  // The information form, the portal, the salon and Square webhooks stay reachable.
  for (const path of ["/", "/rendez-vous.html", "/fiche-informations.html", "/api/public/intake", "/api/portal/session", "/api/appointments", "/api/waitlist/manage", "/api/webhooks/square", "/salon", "/portal/abc", "/booking/payment/1", "/bookshelf"]) {
    assert.equal(isBookingPagePath(path) || isBookingApiPath(path), false, path);
  }
});

test("reservations are paused unless ONLINE_BOOKING_ENABLED is exactly true", () => {
  assert.equal(onlineBookingEnabled(paused), false);
  assert.equal(onlineBookingEnabled({ ONLINE_BOOKING_ENABLED: "1" }), false);
  assert.equal(onlineBookingEnabled({ ONLINE_BOOKING_ENABLED: " TRUE " }), true);
  assert.deepEqual(decideBookingAccess({ pathname: "/book/bopoil/gatineau" }, paused), { action: "pause-page" });
  assert.deepEqual(decideBookingAccess({ pathname: "/api/bookings" }, paused), { action: "pause-api" });
  assert.deepEqual(decideBookingAccess({ pathname: "/api/public/intake" }, paused), { action: "pass" });
  assert.deepEqual(decideBookingAccess({ pathname: "/book/bopoil/gatineau" }, open), { action: "pass" });
  assert.deepEqual(decideBookingAccess({ pathname: "/api/bookings" }, open), { action: "pass" });
});

test("the Next.js proxy pauses every booking address and serves the notice page", async () => {
  const [proxy, page] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/reservation-pause/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const path of ["/book", "/book/:path*", "/api/bookings", "/api/square-bookings", "/api/availability", "/api/catalog", "/api/booking-context", "/api/client-auth/:path*"]) {
    assert.ok(proxy.includes(`"${path}"`), path);
  }
  assert.match(proxy, /decideBookingAccess\(\{ pathname \}\)/);
  assert.match(proxy, /booking\.action === "pause-api"[\s\S]*?status: 503/);
  assert.match(proxy, /NextResponse\.rewrite\(new URL\(BOOKING_PAUSE_PATH, request\.url\)\)/);
  assert.equal(BOOKING_PAUSE_PATH, "/reservation-pause");
  assert.match(page, /href="tel:\+18199682827"/);
  assert.match(page, /href="sms:\+18199682827"/);
  assert.match(page, /href="mailto:info@bopoil\.ca"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test("the build swaps the website's online booking button for the pause notice", async () => {
  const [rendezVous, index] = await Promise.all([
    readFile(new URL("../../web/rendez-vous.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(rendezVous, /data-booking-link=""\s+href="\/book\/bopoil\/gatineau">Réserver en ligne<\/a>/);
  const pausedPage = pauseBookingInHtml(rendezVous);
  assert.doesNotMatch(pausedPage, /href="\/book\/bopoil\/gatineau"/);
  assert.match(pausedPage, /booking-cta__pause/);
  assert.match(pausedPage, /tel:\+18199682827/);
  // Everything else on the page, including the phone, text and email block, is untouched.
  assert.match(pausedPage, /href="sms:\+18199682827"/);
  assert.match(pausedPage, /fiche-informations\.html/);

  assert.match(transformPublicFile("rendez-vous.html", rendezVous, { BOUTIQUE_ENABLED: "true" }), /booking-cta__pause/);
  assert.equal(transformPublicFile("rendez-vous.html", rendezVous, { BOUTIQUE_ENABLED: "true", ONLINE_BOOKING_ENABLED: "true" }), null);
  // Both gates combine: boutique hidden and booking paused in one pass.
  const both = transformPublicFile("rendez-vous.html", rendezVous, paused);
  assert.match(both, /booking-cta__pause/);
  assert.doesNotMatch(both, /href="boutique\.html">Boutique</);
  // Other pages are not affected by the reservation gate.
  assert.equal(transformPublicFile("index.html", index, { BOUTIQUE_ENABLED: "true" }), null);
});
