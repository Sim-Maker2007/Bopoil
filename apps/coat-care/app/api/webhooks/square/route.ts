import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { providerWebhookEvents } from "../../../../db/schema";
import { sha256 } from "../../../../lib/stripe";
import { squareConfig, verifySquareWebhook } from "../../../../lib/square";
import { retrieveAndSyncSquareBooking } from "../../../../lib/square-sync";

type SquareEvent = {
  event_id?: string;
  type?: string;
  data?: { object?: { booking?: { id?: string } } };
};

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  const config = squareConfig();
  if (!config.webhookConfigured) return Response.json({ error: "Square webhooks are not configured." }, { status: 503 });
  if (!await verifySquareWebhook(payload, signature, config)) return Response.json({ error: "Invalid Square signature." }, { status: 403 });
  let event: SquareEvent;
  try { event = JSON.parse(payload) as SquareEvent; }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const eventId = String(event.event_id || "").trim();
  const eventType = String(event.type || "").trim();
  if (!eventId || !eventType) return Response.json({ error: "Invalid Square event." }, { status: 400 });
  const ledgerId = `square:${eventId}`;
  const db = getDb();
  const [existing] = await db.select({ status: providerWebhookEvents.status }).from(providerWebhookEvents).where(eq(providerWebhookEvents.id, ledgerId)).limit(1);
  if (existing && ["processed", "ignored"].includes(existing.status)) return Response.json({ received: true });
  await db.insert(providerWebhookEvents).values({ id: ledgerId, provider: "square", eventType, payloadHash: await sha256(payload) }).onConflictDoNothing();
  try {
    if (!["booking.created", "booking.updated"].includes(eventType)) {
      await db.update(providerWebhookEvents).set({ status: "ignored", processedAt: new Date().toISOString() }).where(eq(providerWebhookEvents.id, ledgerId));
      return Response.json({ received: true });
    }
    const bookingId = String(event.data?.object?.booking?.id || "").trim();
    if (!bookingId) throw new Error("Square booking event did not include a booking ID.");
    const result = await retrieveAndSyncSquareBooking(db, bookingId);
    await db.update(providerWebhookEvents).set({ status: result.handled ? "processed" : "ignored", processedAt: new Date().toISOString(), error: result.handled ? "" : String(result.reason || "ignored") }).where(eq(providerWebhookEvents.id, ledgerId));
    return Response.json({ received: true });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Square webhook processing failed").slice(0, 500);
    await db.update(providerWebhookEvents).set({ status: "failed", error: message }).where(eq(providerWebhookEvents.id, ledgerId));
    return Response.json({ error: message }, { status: 500 });
  }
}
