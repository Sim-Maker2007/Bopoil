import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Square webhook signatures bind the exact notification URL and raw body", async () => {
  const { squareWebhookSignature, verifySquareWebhookSignature } = await import("../lib/square-webhooks.ts");
  const notificationUrl = "https://crm.example.com/api/webhooks/square";
  const payload = JSON.stringify({ event_id: "event-1", type: "booking.created" });
  const key = "square-signature-key";
  const expected = createHmac("sha256", key).update(notificationUrl + payload).digest("base64");
  assert.equal(await squareWebhookSignature(payload, notificationUrl, key), expected);
  assert.equal(await verifySquareWebhookSignature(payload, expected, notificationUrl, key), true);
  assert.equal(await verifySquareWebhookSignature(`${payload} `, expected, notificationUrl, key), false);
  assert.equal(await verifySquareWebhookSignature(payload, expected, `${notificationUrl}/`, key), false);
});
test("Square remains the scheduling authority while Coat & Care owns care workflow", async () => {
  const [webhook, sync, appointments, portal, intake] = await Promise.all([
    source("../app/api/webhooks/square/route.ts"),
    source("../lib/square-sync.ts"),
    source("../app/api/appointments/route.ts"),
    source("../app/api/portal/[token]/route.ts"),
    source("../app/api/public/intake/route.ts"),
  ]);
  assert.match(webhook, /await request\.text\(\)/);
  assert.match(webhook, /x-square-hmacsha256-signature/);
  assert.match(webhook, /booking\.created/);
  assert.match(webhook, /booking\.updated/);
  assert.match(sync, /allowOnlineBooking: false/);
  assert.doesNotMatch(sync, /queueBookingCommunications/);
  assert.match(appointments, /This appointment is managed in Square/);
  assert.match(portal, /managedBySquare/);
  assert.match(intake, /PUBLIC_INTAKE|intakeOriginAllowed/);
  assert.match(intake, /attachSolePetToSquareAppointments/);
});

test("Coat & Care remains authoritative and every website booking uses one linked Square customer", async () => {
  const [sync, publicBooking, squareRoute, catalog, availability, experience, intake, websiteConfig, bookingPage, intakePage] = await Promise.all([
    source("../lib/square-sync.ts"),
    source("../lib/square-public-booking.ts"),
    source("../app/api/square-bookings/route.ts"),
    source("../app/api/catalog/route.ts"),
    source("../app/api/availability/route.ts"),
    source("../app/booking-experience.tsx"),
    source("../app/api/public/intake/route.ts"),
    source("../../web/js/config.js"),
    source("../../web/rendez-vous.html"),
    source("../../web/fiche-informations.html"),
  ]);
  const resolveClient = sync.slice(sync.indexOf("async function resolveClient"), sync.indexOf("async function resolvePet"));
  assert.doesNotMatch(resolveClient, /db\.update\(clients\)\.set/);
  assert.match(resolveClient, /Coat & Care is authoritative/);
  assert.match(publicBooking, /referenceId = `coat-care:\$\{client\.id\}`/);
  assert.match(publicBooking, /customers\/search/);
  assert.match(publicBooking, /candidates\.length > 1/);
  assert.match(publicBooking, /customer_id: squareCustomerId/);
  assert.match(publicBooking, /idempotency_key: `coat-care-booking:/);
  assert.match(publicBooking, /syncSquareBooking\(input\.db, response\.booking, \{ clientId: input\.clientId, petId: input\.petId \}\)/);
  assert.match(squareRoute, /resolvePortalSession/);
  assert.match(squareRoute, /queuePortalAccessMessage/);
  assert.match(catalog, /syncSquareBookableServices/);
  assert.match(availability, /loadSquareAvailability/);
  assert.match(experience, /\/api\/square-bookings/);
  assert.match(experience, /Create profile & add pet/);
  assert.match(intake, /access\.client\?\.id !== existingClient\.id/);
  assert.match(intake, /issuePortalSession\(db, clientId, 30 \/ \(24 \* 60\)\)/);
  assert.match(websiteConfig, /bookingUrl: '\/book\/bopoil\/gatineau'/);
  assert.doesNotMatch(websiteConfig, /bookingUrl: 'https:\/\/book\.squareup\.com/);
  assert.match(bookingPage, /href="\/book\/bopoil\/gatineau">Réserver en ligne<\/a>/);
  assert.doesNotMatch(bookingPage, /book\.squareup\.com/);
  for (const field of ["telephone", "email", "nom_animal"]) assert.match(intakePage, new RegExp(`name="${field}"[^>]*required`));
});

test("Square write requests use JSON while read requests keep their existing behavior", async () => {
  const { squareRequest, squareConfig } = await import("../lib/square.ts");
  const previousToken = process.env.SQUARE_ACCESS_TOKEN;
  process.env.SQUARE_ACCESS_TOKEN = "fixture-token";
  try {
    assert.equal(squareConfig({ SQUARE_ACCESS_TOKEN: "token", SQUARE_LOCATION_ID: "loc", SQUARE_BOOKING_MODE: "api" }).publicBookingConfigured, true);
    const calls = [];
    const fetcher = async (_url, init) => {
      calls.push(init);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
    };
    await squareRequest("customers", { fetcher });
    await squareRequest("customers", { fetcher, body: { given_name: "Test" } });
    await squareRequest("customers/id", { fetcher, method: "PUT", body: { given_name: "Updated" } });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].body, undefined);
    assert.equal(calls[0].headers["content-type"], undefined);
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[1].body), { given_name: "Test" });
    assert.equal(calls[2].method, "PUT");
    assert.deepEqual(JSON.parse(calls[2].body), { given_name: "Updated" });
  } finally {
    if (previousToken === undefined) delete process.env.SQUARE_ACCESS_TOKEN;
    else process.env.SQUARE_ACCESS_TOKEN = previousToken;
  }
});

test("the website intake endpoint stores no raw contact or care payload in its delivery ledger", async () => {
  const [schema, intake] = await Promise.all([
    source("../db/schema.ts"),
    source("../app/api/public/intake/route.ts"),
  ]);
  const table = schema.slice(schema.indexOf('pgTable("public_intake_submissions"'), schema.indexOf('export const externalEntityLinks'));
  assert.doesNotMatch(table, /payload|health|behavior|email|phone/);
  assert.match(table, /sourceHash/);
  assert.match(table, /contactHash/);
  assert.match(intake, /contentLength > 24_000/);
  assert.match(intake, /recent\.length >= 8/);
});
