import { getDb } from "../../../../db";
import { reconcileSquareBookings } from "../../../../lib/square-sync";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await reconcileSquareBookings(getDb(), new Date()));
}
