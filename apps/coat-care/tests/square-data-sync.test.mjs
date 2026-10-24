import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// squareRequest reads these at call time; set before importing the modules.
process.env.SQUARE_ACCESS_TOKEN = "test-token";
process.env.SQUARE_LOCATION_ID = "LOC123";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const { cents, parseCheckpoint, passPlan, paymentShare, squareCustomerName, SQUARE_RESOURCES, SQUARE_WEBHOOK_EVENT_TYPES, isSquareResource, tenderLabel } = await import("../lib/square-plan.ts");

test("Square money helpers read amounts, prorate order tax and name tenders", () => {
  assert.equal(cents({ amount: 1250, currency: "CAD" }), 1250);
  assert.equal(cents(undefined), 0);
  // One payment settles the whole order: all of its tax and discount.
  assert.deepEqual(paymentShare({ totalCents: 11500, tipCents: 1500, taxCents: 1300, discountCents: 500 }, 10000), { taxCents: 1300, discountCents: 500 });
  // A split payment carries its share by amount, never more than the whole.
  assert.deepEqual(paymentShare({ totalCents: 10000, tipCents: 0, taxCents: 1000, discountCents: 200 }, 2500), { taxCents: 250, discountCents: 50 });
  assert.deepEqual(paymentShare({ totalCents: 10000, tipCents: 0, taxCents: 1000, discountCents: 0 }, 50000), { taxCents: 1000, discountCents: 0 });
  assert.equal(tenderLabel({ sourceType: "CARD", cardBrand: "VISA", walletBrand: "" }), "Visa");
  assert.equal(tenderLabel({ sourceType: "CARD", cardBrand: "AMERICAN_EXPRESS", walletBrand: "" }), "American Express");
  assert.equal(tenderLabel({ sourceType: "CASH", cardBrand: "", walletBrand: "" }), "Cash");
  assert.equal(tenderLabel({ sourceType: "EXTERNAL", cardBrand: "", walletBrand: "E_TRANSFER" }), "Other (e_transfer)");
});

test("Square customers are named from what Square holds, in order of usefulness", () => {
  assert.equal(squareCustomerName({ givenName: "Marie", familyName: "Tremblay", companyName: "", nickname: "", emailAddress: "", phoneNumber: "" }), "Marie Tremblay");
  assert.equal(squareCustomerName({ givenName: "", familyName: "", companyName: "Chenil Bopoil", nickname: "", emailAddress: "", phoneNumber: "" }), "Chenil Bopoil");
  assert.equal(squareCustomerName({ givenName: "", familyName: "", companyName: "", nickname: "", emailAddress: "a@b.ca", phoneNumber: "" }), "a@b.ca");
  assert.equal(squareCustomerName({ givenName: "", familyName: "", companyName: "", nickname: "", emailAddress: "", phoneNumber: "" }), "Square customer");
});

test("a sync pass is full the first time, incremental afterwards, and resumes from its checkpoint", () => {
  const now = new Date("2026-10-24T15:00:00Z");
  const first = passPlan({}, undefined, { now }, "customers");
  assert.equal(first.mode, "full");
  assert.equal(first.cursor, "");
  assert.equal(first.passEnd, now.toISOString());
  // Stopped mid-pass: the checkpoint keeps mode, window and cursor.
  const progress = first.progress("CURSOR_A");
  assert.equal(progress.mode, "full");
  assert.equal(progress.cursor, "CURSOR_A");
  assert.equal(progress.passEnd, now.toISOString());
  const resumed = passPlan(progress, { lastSyncedAt: null, checkpointJson: JSON.stringify(progress) }, { now: new Date("2026-10-24T16:00:00Z") }, "customers");
  assert.equal(resumed.mode, "full");
  assert.equal(resumed.cursor, "CURSOR_A");
  assert.equal(resumed.passEnd, now.toISOString(), "a resumed pass keeps its original end so nothing is skipped");
  // Completed: the next pass is incremental from the end of this one, with overlap.
  const done = first.done();
  assert.equal(done.since, now.toISOString());
  assert.equal(done.fullCompletedAt, now.toISOString());
  const later = new Date("2026-10-25T15:00:00Z");
  const incremental = passPlan(done, { lastSyncedAt: now.toISOString(), checkpointJson: JSON.stringify(done) }, { now: later }, "customers");
  assert.equal(incremental.mode, "incremental");
  assert.equal(incremental.sinceIso, new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());
  // Customers are refreshed completely once a week; payments never are unless asked.
  const stale = new Date("2026-11-02T15:00:00Z");
  assert.equal(passPlan(done, { lastSyncedAt: now.toISOString(), checkpointJson: "{}" }, { now: stale }, "customers").mode, "full");
  assert.equal(passPlan(done, { lastSyncedAt: now.toISOString(), checkpointJson: "{}" }, { now: stale }, "payments").mode, "incremental");
  assert.equal(passPlan(done, { lastSyncedAt: now.toISOString(), checkpointJson: "{}" }, { now: stale, full: true }, "payments").mode, "full");
  assert.deepEqual(parseCheckpoint({ checkpointJson: "not json" }), {});
  assert.deepEqual(parseCheckpoint(null), {});
});

test("every Square resource and webhook event the workspace depends on is handled", async () => {
  assert.deepEqual([...SQUARE_RESOURCES].sort(), ["customers", "orders", "payments", "refunds", "team"]);
  assert.equal(isSquareResource("payments"), true);
  assert.equal(isSquareResource("bookings"), false);
  for (const type of ["booking.created", "booking.updated", "customer.created", "customer.updated", "customer.deleted", "payment.created", "payment.updated", "refund.created", "refund.updated", "order.created", "order.updated", "team_member.created", "team_member.updated", "catalog.version.updated"]) {
    assert.ok(SQUARE_WEBHOOK_EVENT_TYPES.includes(type), `${type} is subscribed`);
  }
  const [webhook, cron, sync, finance, reports, clients, dashboard, schema, migration, workspace] = await Promise.all([
    source("../app/api/webhooks/square/route.ts"),
    source("../app/api/cron/square/route.ts"),
    source("../lib/square-data-sync.ts"),
    source("../app/api/finance/route.ts"),
    source("../app/api/reports/route.ts"),
    source("../app/api/clients/route.ts"),
    source("../app/api/dashboard/route.ts"),
    source("../db/schema.ts"),
    source("../drizzle/0003_square_data_mirror.sql"),
    source("../app/salon/salon-workspace.tsx"),
  ]);
  // The webhook mirrors each object through the same upserts as the hourly sync.
  for (const name of ["upsertSquareCustomers", "upsertSquarePayments", "upsertSquareRefunds", "retrieveSquareOrders", "upsertSquareTeamMembers", "markSquareCustomerDeleted", "retrieveAndSyncSquareBooking"]) assert.match(webhook, new RegExp(name));
  assert.match(webhook, /await request\.text\(\)/, "the raw body is kept for signature verification");
  assert.match(cron, /reconcileSquareBookings/);
  assert.match(cron, /runSquareDataSync/);
  // Square never overwrites a Coat & Care client; ambiguous matches wait for staff.
  const linking = sync.slice(sync.indexOf("export async function linkSquareCustomers"), sync.indexOf("export async function upsertSquareCustomers"));
  assert.doesNotMatch(linking, /db\.update\(clients\)/);
  assert.match(linking, /matches\.size > 1\) continue/);
  // Money from Square reaches the finance, reporting, client and dashboard views.
  assert.match(finance, /squareSalesBetween/);
  assert.match(reports, /squareAnalyticsPayments/);
  assert.match(clients, /squarePayments/);
  assert.match(dashboard, /collectedToday/);
  assert.match(workspace, /<SquareView/);
  // The mirror tables exist in the schema and in the migration that creates them.
  for (const table of ["square_customers", "square_orders", "square_payments", "square_refunds", "square_team_members", "square_bookings"]) {
    assert.match(schema, new RegExp(`pgTable\\("${table}"`));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /ALTER TABLE "integration_sync_states" ADD COLUMN "resource"/);
  assert.match(migration, /integration_sync_provider_location_resource_unique/);
});
