import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rejects impossible calendar dates before availability or record writes", async () => {
  const { isValidDateKey } = await import("../lib/time-zone.ts");
  assert.equal(isValidDateKey("2028-02-29"), true);
  for (const value of ["2027-02-29", "2026-02-31", "2026-13-01", "not-a-date"]) {
    assert.equal(isValidDateKey(value), false, value);
  }
  const [availability, waitlist, portal, vaccinations] = await Promise.all([
    readFile(new URL("../app/api/availability/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/waitlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [availability, waitlist, portal, vaccinations]) assert.match(source, /isValidDateKey/);
});

test("email scanners cannot consume one-time portal links", async () => {
  const source = await readFile(new URL("../app/portal/access/[token]/route.ts", import.meta.url), "utf8");
  const [getHandler, postHandler = ""] = source.split("export async function POST");
  const getBody = getHandler.slice(getHandler.indexOf("export async function GET"));
  assert.match(getHandler, /<form method="post">/);
  assert.doesNotMatch(getBody, /resolvePortalSession|clientPortalSessions|issuePortalSession/);
  assert.match(postHandler, /resolvePortalSession/);
  assert.match(postHandler, /isNull\(clientPortalSessions\.revokedAt\)/);
  assert.match(postHandler, /__Host-pet_portal=/);
});

test("provider retry behavior cannot silently duplicate queued messages", async () => {
  const { resendRequest } = await import("../lib/message-provider-payloads.ts");
  const config = {
    email: { configured: true, webhookConfigured: true, provider: "resend", apiKey: "test", from: "test@example.com", replyTo: "" },
    sms: { configured: false, webhookConfigured: false, provider: "twilio", accountSid: "", authToken: "", messagingServiceSid: "", callbackUrl: "" },
  };
  const message = { id: "message-1", recipientAddress: "client@example.com", subject: "Visit", body: "Hello", scheduledFor: "2026-08-01T12:00:00.000Z", deliveryAttempts: 0 };
  const first = resendRequest(message, config, new Date("2026-08-01T11:00:00.000Z"));
  const retry = resendRequest({ ...message, deliveryAttempts: 4 }, config, new Date("2026-08-01T11:00:00.000Z"));
  assert.equal(first?.init.headers["idempotency-key"], retry?.init.headers["idempotency-key"]);
  assert.throws(() => resendRequest({ ...message, scheduledFor: "invalid" }, config), /delivery time is invalid/);
  const delivery = await readFile(new URL("../lib/message-delivery.ts", import.meta.url), "utf8");
  assert.match(delivery, /message\.delivery_uncertain/);
  assert.match(delivery, /Check the Twilio message log before retrying/);
  assert.match(delivery, /eq\(messages\.processingStartedAt, now\)/);
  assert.match(delivery, /isNull\(messages\.processingStartedAt\)/);
});

test("directory search is applied by the database before its result limit", async () => {
  const source = await readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8");
  const queryIndex = source.indexOf("directClientMatch");
  const limitIndex = source.indexOf(".limit(100)");
  assert.ok(queryIndex > -1 && limitIndex > queryIndex);
  assert.match(source, /instr\(lower\(/);
  assert.match(source, /exists \(/);
  assert.doesNotMatch(source, /\.limit\(500\)/);
  assert.doesNotMatch(source, /\}\)\.filter\(\(client\)/);
});

test("Blob metadata writes and audits are atomic, with safe deletion order", async () => {
  const [mediaUpload, mediaDelete, vaccinationUpload, vaccinationDelete, receiptUpload] = await Promise.all([
    readFile(new URL("../app/api/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/vaccinations/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/receipts/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [mediaUpload, vaccinationUpload, receiptUpload]) {
    assert.match(source, /\.batch\(\[/);
    assert.match(source, /mediaStore\.delete\(storedKey\)\.catch/);
    const commitIndex = source.indexOf(".batch([");
    const cleanupDisarmedIndex = source.indexOf('storedKey = "";', commitIndex);
    const responseIndex = source.indexOf("return Response.json", cleanupDisarmedIndex);
    assert.ok(commitIndex > -1 && cleanupDisarmedIndex > commitIndex && responseIndex > cleanupDisarmedIndex);
  }
  for (const source of [mediaDelete, vaccinationDelete]) {
    assert.ok(source.indexOf(".batch([") < source.indexOf("mediaStore.delete"));
    assert.match(source, /Blob cleanup must be retried/);
  }
});

test("availability rejects out-of-range window sizes instead of silently clamping them", async () => {
  const source = await readFile(new URL("../app/api/availability/route.ts", import.meta.url), "utf8");
  assert.match(source, /requestedDays < 1 \|\| requestedDays > 21/);
  assert.doesNotMatch(source, /Math\.min\(21, Math\.max\(1, requestedDays\)\)/);
});

test("reservation-heavy bookings keep bounded inserts without losing atomicity", async () => {
  const [availability, appointments, bookings, portal, waitlist] = await Promise.all([
    readFile(new URL("../db/availability.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/[token]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/waitlist/manage/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(availability, /RESERVATION_INSERT_SIZE = 10/);
  assert.match(availability, /rows\.slice\(index, index \+ RESERVATION_INSERT_SIZE\)/);
  for (const source of [appointments, bookings, portal, waitlist]) {
    assert.match(source, /\.\.\.reservationInsertStatements\(db, /);
    assert.doesNotMatch(source, /insert\(appointmentReservations\)\.values\((?:reservationRows|reservations)\)/);
  }
});

test("the merged app develops locally and deploys on Vercel with Turso", async () => {
  const [packageSource, nextConfig, drizzle, rootPackage, vercel, catalog, onboarding] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catalog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  ]);
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts.predev, /site:sync/);
  assert.match(scripts.start, /next start/);
  assert.match(scripts.test, /tests\/\*\.test\.mjs/);
  assert.match(nextConfig, /source: "\/"/);
  assert.match(nextConfig, /destination: "\/index\.html"/);
  assert.match(drizzle, /dialect: "turso"/);
  assert.match(rootPackage, /"workspaces"/);
  assert.match(vercel, /"framework": "nextjs"/);
  assert.match(catalog, /delivery: publicDeliveryConfig\(\)/);
  assert.match(onboarding, /await db\.batch\(\[/);
  assert.match(onboarding, /Choose a valid salon timezone/);
});
