import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("anonymous booking and waitlist submissions never update matched CRM identities", () => {
  for (const file of [
    "app/api/bookings/route.ts",
    "app/api/waitlist/route.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /onConflictDoUpdate\s*\(\s*\{[\s\S]*?(clients|pets)\./,
      `${file} must not update contact or pet records from anonymous input`,
    );
  }
  const booking = read("app/api/bookings/route.ts");
  assert.match(
    booking,
    /if \(contactConflict\) \{[\s\S]*prepareSecureBookingRecovery\(db,[\s\S]*return secureClientBookingRequired\(\)/,
  );
  assert.match(booking, /clientId = crypto\.randomUUID\(\)/);
  assert.match(booking, /petId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(
    booking,
    /const clientInsert = db\.insert\(clients\)[\s\S]*?\.onConflictDoNothing\(\)/,
  );
  assert.match(booking, /db\.batch\(\[\s*clientInsert,\s*petInsert,/);

  const waitlist = read("app/api/waitlist/route.ts");
  {
    const source = waitlist;
    assert.match(
      source,
      /if \(contactConflict\) return secureClientWaitlistRequired\(\)/,
    );
    assert.match(source, /clientId = crypto\.randomUUID\(\)/);
    assert.match(source, /petId = crypto\.randomUUID\(\)/);
    assert.match(
      source,
      /if \(requestedPetId\)[\s\S]*?resolvePortalSession\(token\)/,
    );
    assert.doesNotMatch(source, /existingClient|existingPet|publicRecordId/);
    assert.doesNotMatch(
      source,
      /const clientInsert = db\.insert\(clients\)[\s\S]*?\.onConflictDoNothing\(\)/,
    );
    assert.doesNotMatch(
      source,
      /const petInsert = db\.insert\(pets\)[\s\S]*?\.onConflictDoNothing\(\)/,
    );
    assert.match(source, /db\.batch\(\[\s*clientInsert,\s*petInsert,/);
  }
});

test("checkout privileges are separate from bookkeeping privileges", () => {
  const permissions = read("lib/salon-permissions.ts");
  assert.match(permissions, /receptionist:\s*\[[^\]]*"checkout"[^\]]*\]/);
  assert.doesNotMatch(permissions, /receptionist:\s*\[[^\]]*"finance"[^\]]*\]/);
  assert.match(
    permissions,
    /role === "receptionist"[\s\S]*?migrated\.delete\("finance"\)[\s\S]*?migrated\.add\("checkout"\)/,
  );

  for (const file of [
    "app/api/accounting/route.ts",
    "app/api/accounting/accounts/route.ts",
    "app/api/accounting/export/route.ts",
    "app/api/accounting/receipts/route.ts",
    "app/api/accounting/receipts/[id]/route.ts",
  ]) {
    const source = read(file);
    assert.match(
      source,
      /requireBookkeepingAccess\(membership\)/,
      `${file} must require bookkeeping access`,
    );
    assert.doesNotMatch(
      source,
      /requireFinancialAccess\(membership\)/,
      `${file} must not grant broad checkout-level finance access`,
    );
  }
});

test("online checkout requires manager approval for discounts and expires unsaved Stripe sessions", () => {
  const source = read("app/api/payments/checkout/route.ts");
  assert.match(
    source,
    /if \(discountCents > 0\)[\s\S]*?requireSalonManager\(membership\)/,
  );
  assert.match(source, /checkout\/sessions\/\$\{providerSessionId\}\/expire/);
  assert.match(source, /catch \(saveError\)[\s\S]*?expire/);
});

test("receipt deletion commits metadata and audit before best-effort object cleanup", () => {
  const source = read("app/api/accounting/receipts/[id]/route.ts");
  const batchAt = source.indexOf("await db.batch");
  const blobDeleteAt = source.indexOf("await mediaStore.delete");
  assert.ok(batchAt >= 0 && blobDeleteAt > batchAt);
  assert.match(
    source,
    /db\.batch\(\[[\s\S]*?auditEvents[\s\S]*?db\.delete\(expenseReceipts\)/,
  );
  assert.match(source, /mediaStore\.delete\(receipt\.r2Key\)\.catch/);
});

test("financial accounts inherit salon currency and imports cannot cross account locations", () => {
  const source = read("app/api/accounting/accounts/route.ts");
  assert.doesNotMatch(source, /currency:\s*"CAD"/);
  assert.match(source, /currency:\s*organization\.currency/);
  assert.match(source, /currency:\s*currencySource\.currency/);
  assert.match(
    source,
    /account\.locationId && locationId && account\.locationId !== locationId/,
  );
  assert.match(
    source,
    /const effectiveLocationId = account\.locationId \|\| locationId/,
  );
  assert.match(source, /locationId:\s*effectiveLocationId/);
});

test("payment and refund ledger writes claim an invoice version and commit in D1 batches", () => {
  const checkout = read("app/api/checkout/route.ts");
  const webhook = read("app/api/stripe/webhook/route.ts");
  for (const source of [checkout, webhook]) {
    assert.match(source, /invoiceMutationClaims/);
    assert.match(
      source,
      /mutationVersion:\s*invoice\.mutationVersion \+ 1|mutationVersion:\s*refundInvoice\.mutationVersion \+ 1/,
    );
    assert.match(
      source,
      /db\.batch\(\[[^\]]*(claimInsert|eventInsert|refundInsert)[^\]]*invoiceUpdate/s,
    );
  }
});

test("final in-salon checkout completes only a ready visit and records the transition", () => {
  const checkout = read("app/api/checkout/route.ts");
  const view = read("app/salon/financial-views.tsx");
  const workspace = read("app/salon/salon-workspace.tsx");
  assert.match(
    checkout,
    /finalPayment && status === "paid" && snapshot\.appointment\.status === "ready"/,
  );
  assert.match(checkout, /eq\(appointments\.status, "ready"\)/);
  assert.match(
    checkout,
    /eq\(appointments\.updatedAt, snapshot\.appointment\.updatedAt\)/,
  );
  assert.match(checkout, /action: "appointment\.completed_at_checkout"/);
  assert.match(view, /Pay \$\{displayMoney\(balanceCents\)\} & complete visit/);
  assert.match(workspace, /Financial ledger and appointment status updated/);
  assert.match(workspace, /loadDashboard\(\)[\s\S]*?\.then\(setData\)/);
});

test("the complete migration chain installs invoice mutation serialization", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  const migrations = fs
    .readdirSync(path.join(root, "drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    const sql = read(path.join("drizzle", migration)).replaceAll(
      "--> statement-breakpoint",
      "",
    );
    assert.doesNotThrow(
      () => db.exec(sql),
      `migration ${migration} should apply cleanly`,
    );
  }

  const invoiceColumns = db.prepare("pragma table_info(invoices)").all();
  assert.ok(
    invoiceColumns.some(
      (column) =>
        column.name === "mutation_version" &&
        column.notnull === 1 &&
        column.dflt_value === "0",
    ),
  );
  const claimIndexes = db
    .prepare("pragma index_list(invoice_mutation_claims)")
    .all();
  assert.ok(
    claimIndexes.some(
      (index) =>
        index.name === "invoice_mutation_claims_invoice_version_unique" &&
        index.unique === 1,
    ),
  );

  db.exec(`
    insert into invoices (id, organization_id, location_id, appointment_id, invoice_number, subtotal_cents, total_cents, currency)
    values ('invoice-1', 'org-1', 'location-1', 'appointment-1', 'CC-1', 1000, 1000, 'CAD');
    insert into invoice_mutation_claims (id, organization_id, invoice_id, expected_mutation_version, mutation_type, idempotency_key)
    values ('claim-1', 'org-1', 'invoice-1', 0, 'payment', 'request-1');
  `);
  assert.throws(
    () =>
      db.exec(`
    insert into invoice_mutation_claims (id, organization_id, invoice_id, expected_mutation_version, mutation_type, idempotency_key)
    values ('claim-2', 'org-1', 'invoice-1', 0, 'payment', 'request-2');
  `),
    /UNIQUE constraint failed/,
  );
  db.close();
});
