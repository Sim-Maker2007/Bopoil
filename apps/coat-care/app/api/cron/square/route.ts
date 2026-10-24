import { getDb } from "../../../../db";
import { runSquareDataSync } from "../../../../lib/square-data-sync";
import { reconcileSquareBookings } from "../../../../lib/square-sync";

// Square reconciliation and message sweeps page through provider APIs; give them
// the full function budget instead of the platform's short default.
export const maxDuration = 60;

// Hourly: appointments first (what the floor needs), then customers, team,
// orders, payments and refunds. Every resource keeps its own checkpoint, so a
// run that reaches the time budget resumes next hour instead of starting over.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const now = new Date();
  const deadline = Date.now() + 50_000;
  let bookings: unknown;
  try {
    bookings = await reconcileSquareBookings(db, now, false, { deadline: Date.now() + 25_000 });
  } catch (error) {
    bookings = { error: (error instanceof Error ? error.message : "Square reconciliation failed").slice(0, 300) };
  }
  const data = await runSquareDataSync(db, { now, deadline });
  return Response.json({ bookings, data: data.configured ? data.results : { configured: false } });
}
