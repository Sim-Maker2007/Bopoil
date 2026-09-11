import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clients, deliveryProviderEvents, messageEvents, messages } from "../../../../db/schema";
import { reconcileDeliveryEvent } from "../../../../lib/message-webhooks";
import { verifyTwilioWebhook } from "../../../../lib/message-webhook-signatures";

type RuntimeValues = Record<string, string | undefined>;

async function captureInboundReply(params: URLSearchParams) {
  const providerMessageId = params.get("MessageSid") || params.get("SmsSid") || "";
  const from = params.get("From") || "";
  const to = params.get("To") || "";
  const body = (params.get("Body") || "").slice(0, 5000);
  const mediaCount = Math.max(0, Number(params.get("NumMedia") || 0) || 0);
  if (!providerMessageId || !from || (!body && !mediaCount)) return;
  const db = getDb();
  const providerEventId = `inbound:${providerMessageId}`;
  const now = new Date().toISOString();
  let [claim] = await db.insert(deliveryProviderEvents).values({
    id: crypto.randomUUID(),
    provider: "twilio",
    providerEventId,
    providerMessageId,
    eventType: "sms.received",
    status: "processing",
  }).onConflictDoNothing().returning({ id: deliveryProviderEvents.id });
  if (!claim) {
    [claim] = await db.update(deliveryProviderEvents).set({ status: "processing", error: "", receivedAt: now, processedAt: null }).where(and(
      eq(deliveryProviderEvents.provider, "twilio"),
      eq(deliveryProviderEvents.providerEventId, providerEventId),
      eq(deliveryProviderEvents.status, "failed"),
    )).returning({ id: deliveryProviderEvents.id });
  }
  if (!claim) return;
  const finishClaim = (status: "processed" | "ignored" | "failed", messageId: string | null, error = "") =>
    db.update(deliveryProviderEvents).set({ status, messageId, error: error.slice(0, 500), processedAt: new Date().toISOString() }).where(eq(deliveryProviderEvents.id, claim.id));
  try {
    const digits = from.replace(/\D/g, "");
    if (digits.length < 10) {
      await finishClaim("ignored", null, "Inbound sender was not a valid Canada/US phone number.");
      return;
    }
    const last10 = digits.slice(-10);
    const recipientLast10 = sql<string>`right(replace(replace(replace(replace(replace(replace(${messages.recipientAddress}, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), 10)`;
    const conversationFilter = and(
      eq(messages.direction, "outbound"),
      eq(messages.channel, "sms"),
      eq(messages.provider, "twilio"),
      eq(recipientLast10, last10),
      inArray(messages.status, ["sent", "delivered"]),
    );
    const scopes = await db.select({
      organizationId: messages.organizationId,
      locationId: messages.locationId,
      clientId: messages.clientId,
    }).from(messages).where(conversationFilter)
      .groupBy(messages.organizationId, messages.locationId, messages.clientId)
      .limit(2);
    if (scopes.length !== 1) {
      await finishClaim("ignored", null, scopes.length ? "Inbound sender matched more than one private client scope." : "No outbound conversation matched the inbound sender.");
      return;
    }
    const scope = scopes[0];
    const [conversation] = await db.select().from(messages).where(and(
      conversationFilter,
      eq(messages.organizationId, scope.organizationId),
      eq(messages.locationId, scope.locationId),
      eq(messages.clientId, scope.clientId),
    )).orderBy(desc(messages.sentAt), desc(messages.createdAt)).limit(1);
    if (!conversation) {
      await finishClaim("ignored", null, "No outbound conversation matched the inbound sender.");
      return;
    }
    const inboundBody = body || `[${mediaCount} media attachment${mediaCount === 1 ? "" : "s"} received]`;
    const [created] = await db.insert(messages).values({
      id: crypto.randomUUID(),
      organizationId: conversation.organizationId,
      locationId: conversation.locationId,
      clientId: conversation.clientId,
      appointmentId: conversation.appointmentId,
      dedupeKey: `inbound:twilio:${providerMessageId}`,
      direction: "inbound",
      channel: "sms",
      category: "transactional",
      status: "action_required",
      recipientName: conversation.recipientName,
      recipientAddress: from,
      body: inboundBody,
      provider: "twilio",
      providerMessageId,
      scheduledFor: now,
      sentAt: now,
    }).onConflictDoNothing().returning();
    if (!created) {
      await finishClaim("ignored", null, "The inbound message was already captured.");
      return;
    }
    await db.batch([
      db.insert(messageEvents).values({
        id: `inbound:twilio:${providerMessageId}`,
        organizationId: conversation.organizationId,
        locationId: conversation.locationId,
        messageId: created.id,
        type: "message.inbound_received",
        actorType: "client",
        actorId: conversation.clientId,
        detailsJson: JSON.stringify({ from, to, mediaCount }),
      }).onConflictDoNothing(),
      db.update(clients).set({ smsDeliverability: "reachable", smsDeliverabilityAt: now, updatedAt: now }).where(and(
        eq(clients.id, conversation.clientId),
        eq(clients.organizationId, conversation.organizationId),
      )),
      finishClaim("processed", created.id),
    ]);
  } catch (error) {
    await finishClaim("failed", null, error instanceof Error ? error.message : "Inbound SMS capture failed.").catch(() => undefined);
    throw error;
  }
}

export async function POST(request: Request) {
  const values = process.env as RuntimeValues, body = await request.text(), params = new URLSearchParams(body);
  const incoming = new URL(request.url), configuredBase = values.DELIVERY_PUBLIC_URL?.trim();
  const canonicalUrl = configuredBase ? new URL(`${incoming.pathname}${incoming.search}`, configuredBase).toString() : request.url;
  const signature = request.headers.get("x-twilio-signature") || "";
  if (!await verifyTwilioWebhook({ url: canonicalUrl, params, signature, authToken: values.TWILIO_AUTH_TOKEN?.trim() || "" })) return new Response("Invalid webhook", { status: 403 });
  if (params.get("AccountSid") && params.get("AccountSid") !== values.TWILIO_ACCOUNT_SID?.trim()) return new Response("Invalid account", { status: 403 });
  const inbound = !params.get("MessageStatus") && ((params.get("SmsStatus") || "").toLowerCase() === "received" || params.has("Body"));
  if (inbound) {
    await captureInboundReply(params);
    return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  }
  const providerMessageId = params.get("MessageSid") || "", status = (params.get("MessageStatus") || "").toLowerCase(), errorCode = params.get("ErrorCode") || "";
  if (!providerMessageId || !status) return new Response(null, { status: 204 });
  await reconcileDeliveryEvent(getDb(), { provider: "twilio", providerEventId: `${providerMessageId}:${status}:${errorCode || "none"}`, providerMessageId, eventType: `sms.${status}`, occurredAt: new Date().toISOString(), reason: errorCode ? `Twilio error ${errorCode}` : "" });
  return new Response(null, { status: 204 });
}
