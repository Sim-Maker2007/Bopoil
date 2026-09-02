import { getDb } from "../../../../db";
import { reconcileSquareBookings } from "../../../../lib/square-sync";

// Square reconciliation and message sweeps page through provider APIs; give them
// the full function budget instead of the platform's short default.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await reconcileSquareBookings(getDb(), new Date()));
}
