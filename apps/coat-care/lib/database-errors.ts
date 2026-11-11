// Postgres SQLSTATE codes for a table or column that does not exist. In
// production they mean the deployed code expects a migration the database has
// not received: Vercel builds never run `npm run db:migrate` (README).
const MISSING_SCHEMA_CODES = new Set(["42P01", "42703"]);

export const DATABASE_UPDATE_REQUIRED_MESSAGE = "The CRM database is missing an update. Run npm run db:migrate with the production DATABASE_URL.";

// drizzle wraps the driver's error ("Failed query: ...") and keeps the Postgres
// error, which carries the SQLSTATE in `code`, on `cause`.
export function isMissingMigrationError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && MISSING_SCHEMA_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
