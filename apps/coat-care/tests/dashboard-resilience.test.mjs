import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const { isMissingMigrationError, DATABASE_UPDATE_REQUIRED_MESSAGE } = await import("../lib/database-errors.ts");
const { translateCrmText } = await import("../app/crm-language.ts");

test("a missing table or column is recognised through drizzle's wrapped error", () => {
  const postgres = (code) => Object.assign(new Error("relation does not exist"), { code });
  const wrapped = (cause) => Object.assign(new Error('Failed query: select "id" from "square_payments"'), { cause });
  assert.equal(isMissingMigrationError(postgres("42P01")), true);
  assert.equal(isMissingMigrationError(wrapped(postgres("42P01"))), true);
  assert.equal(isMissingMigrationError(wrapped(postgres("42703"))), true);
  // Constraint violations, timeouts and unrelated failures stay ordinary 500s.
  assert.equal(isMissingMigrationError(wrapped(postgres("23505"))), false);
  assert.equal(isMissingMigrationError(new Error("timeout")), false);
  assert.equal(isMissingMigrationError(null), false);
  assert.equal(isMissingMigrationError("42P01"), false);
});

test("salon APIs say the database needs its migration instead of a bare failure", async () => {
  const access = await source("../app/salon-access.ts");
  assert.match(access, /isMissingMigrationError\(error\)/);
  assert.match(access, /code: "database_update_required"/);
  assert.notEqual(translateCrmText(DATABASE_UPDATE_REQUIRED_MESSAGE), DATABASE_UPDATE_REQUIRED_MESSAGE);
});

test("the dashboard opens even when the Square mirror cannot be read", async () => {
  const [dashboard, workspace] = await Promise.all([source("../app/api/dashboard/route.ts"), source("../app/salon/salon-workspace.tsx")]);
  assert.match(dashboard, /readSquareMirror\("booking details", \(\) => db\.select/);
  assert.match(dashboard, /readSquareMirror\("sales", \(\) => squareSalesBetween\(/);
  // No partial "collected today" total when Square's side is missing.
  assert.match(dashboard, /collectedToday: canSeeMoney && square \?/);
  assert.match(dashboard, /squareSalesUnavailable,/);
  assert.match(workspace, /squareSalesUnavailable\s*\?\s*"Square sales unavailable"/);
  assert.equal(translateCrmText("Square sales unavailable"), "Ventes Square indisponibles");
  assert.equal(translateCrmText("Dashboard unavailable"), "Tableau de bord indisponible");
});
