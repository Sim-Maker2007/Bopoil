import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { providerWebhookEvents } from "../../../../db/schema";
import { sha256 } from "../../../../lib/stripe";
import { squareConfig, verifySquareWebhook } from "../../../../lib/square";
import {
  markSquareCustomerDeleted,
  retrieveSquareOrders,
  SQUARE_WEBHOOK_EVENT_TYPES,
  squareSyncScope,
  upsertSquareCustomers,
  upsertSquarePayments,
  upsertSquareRefunds,
  upsertSquareTeamMembers,
  type SquareCustomer,
  type SquareOrder,
  type SquarePayment,
  type SquareRefund,
  type SquareTeamMember,
} from "../../../../lib/square-data-sync";
import { retrieveAndSyncSquareBooking } from "../../../../lib/square-sync";
import { syncSquareBookableServices } from "../../../../lib/square-public-booking";

// Every Square event the salon's data depends on lands here. Bookings keep
// their existing path (retrieve, then sync the appointment); customers,
// payments, refunds, orders and team members are mirrored straight from the
// event's object through the same upserts the hourly sync uses, so the
// workspace reflects a sale or a new customer within seconds. Unknown event
// types are acknowledged and recorded as ignored.

type SquareEvent = {
  event_id?: string;
  type?: string;
  data?: {
    type?: string;
    id?: string;
    deleted?: boolean;
    object?: {
      booking?: { id?: string };
      customer?: SquareCustomer;
      payment?: SquarePayment;
      refund?: SquareRefund;
      order?: SquareOrder;
      order_created?: { order_id?: string };
      order_updated?: { order_id?: string };
      order_fulfillment_updated?: { order_id?: string };
      team_member?: SquareTeamMember;
    };
  };
};

async function handleEvent(db: ReturnType<typeof getDb>, event: SquareEvent) {
  const eventType = String(event.type || "");
  const object = event.data?.object || {};
  if (eventType === "booking.created" || eventType === "booking.updated") {
    const bookingId = String(object.booking?.id || "").trim();
    if (!bookingId) throw new Error("Square booking event did not include a booking ID.");
    const result = await retrieveAndSyncSquareBooking(db, bookingId);
    return result.handled ? { handled: true } : { handled: false, reason: String(result.reason || "ignored") };
  }
  if (!SQUARE_WEBHOOK_EVENT_TYPES.includes(eventType)) return { handled: false, reason: "unsupported event type" };
  const scope = await squareSyncScope();
  if (eventType === "customer.deleted") {
    const customerId = String(object.customer?.id || event.data?.id || "").trim();
    if (customerId) await markSquareCustomerDeleted(db, scope, customerId);
    return { handled: Boolean(customerId) };
  }
  if (eventType.startsWith("customer.")) {
    const count = object.customer ? await upsertSquareCustomers(db, scope, [object.customer]) : 0;
    return { handled: count > 0, reason: count ? "" : "no customer in event" };
  }
  if (eventType.startsWith("payment.")) {
    const count = object.payment ? await upsertSquarePayments(db, scope, [object.payment]) : 0;
    return { handled: count > 0, reason: count ? "" : "payment outside the salon's location" };
  }
  if (eventType.startsWith("refund.")) {
    const count = object.refund ? await upsertSquareRefunds(db, scope, [object.refund]) : 0;
    return { handled: count > 0, reason: count ? "" : "refund outside the salon's location" };
  }
  if (eventType.startsWith("order.")) {
    // Order events carry only the order id; the order itself is retrieved.
    const orderId = String(object.order?.id || object.order_created?.order_id || object.order_updated?.order_id || object.order_fulfillment_updated?.order_id || "").trim();
    if (!orderId) return { handled: false, reason: "no order id in event" };
    await retrieveSquareOrders(db, scope, [orderId]);
    return { handled: true };
  }
  if (eventType.startsWith("team_member.")) {
    const count = object.team_member ? await upsertSquareTeamMembers(db, scope, [object.team_member]) : 0;
    return { handled: count > 0, reason: count ? "" : "no team member in event" };
  }
  if (eventType === "catalog.version.updated") {
    await syncSquareBookableServices(db, scope.organizationId, scope.locationId);
    return { handled: true };
  }
  return { handled: false, reason: "ignored" };
}

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
    const result = await handleEvent(db, event);
    await db.update(providerWebhookEvents).set({ status: result.handled ? "processed" : "ignored", processedAt: new Date().toISOString(), error: result.handled ? "" : String(result.reason || "ignored") }).where(eq(providerWebhookEvents.id, ledgerId));
    return Response.json({ received: true });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Square webhook processing failed").slice(0, 500);
    await db.update(providerWebhookEvents).set({ status: "failed", error: message }).where(eq(providerWebhookEvents.id, ledgerId));
    return Response.json({ error: message }, { status: 500 });
  }
}
