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

test("the website intake endpoint stores no raw contact or care payload in its delivery ledger", async () => {
  const [schema, intake] = await Promise.all([
    source("../db/schema.ts"),
    source("../app/api/public/intake/route.ts"),
  ]);
  const table = schema.slice(schema.indexOf('sqliteTable("public_intake_submissions"'), schema.indexOf('export const externalEntityLinks'));
  assert.doesNotMatch(table, /payload|health|behavior|email|phone/);
  assert.match(table, /sourceHash/);
  assert.match(table, /contactHash/);
  assert.match(intake, /contentLength > 24_000/);
  assert.match(intake, /recent\.length >= 8/);
});
