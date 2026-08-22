import { getDb } from "../../../../db";
import { sweepExpiredBookingHolds } from "../../../../db/booking-holds";
import { sweepDueMessages } from "../../../../lib/message-delivery";
import { sweepWaitlistOpenings } from "../../../../lib/waitlist-outreach";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const now = new Date();
  const expired = await sweepExpiredBookingHolds(db, now);
  const [messages, waitlist] = await Promise.all([
    sweepDueMessages(db, now),
    sweepWaitlistOpenings(db, process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin),
  ]);
  return Response.json({ ok: true, expired, messages, waitlist });
}
