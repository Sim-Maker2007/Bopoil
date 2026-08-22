import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clients, messageEvents, messages } from "../../../../db/schema";
import { reconcileDeliveryEvent } from "../../../../lib/message-webhooks";
import { verifyResendWebhook } from "../../../../lib/message-webhook-signatures";

type RuntimeValues = Record<string, string | undefined>;

function emailAddress(value: string) {
  return (value.match(/<?([^<>\s]+@[^<>\s]+)>?\s*$/)?.[1] || "").toLowerCase();
}

function inboundConversationId(recipients: string[]) {
  for (const recipient of recipients) {
    const local = emailAddress(recipient).split("@")[0] || "";
    const marker = local.lastIndexOf("+cc-");
    if (marker >= 0) return local.slice(marker + 4);
  }
  return "";
}

function textFromHtml(value: string) {
  return value
    .replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function captureInboundEmail(values: RuntimeValues, input: { providerEmailId: string; from: string; to: string[]; subject: string; occurredAt: string; eventId: string }) {
  const conversationId = inboundConversationId(input.to);
  const from = emailAddress(input.from);
  const apiKey = values.RESEND_API_KEY?.trim() || "";
  if (!conversationId || !from || !apiKey) return;
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(input.providerEmailId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Resend inbound email retrieval failed (${response.status}).`);
  const received = await response.json() as { text?: string | null; html?: string | null; attachments?: Array<{ filename?: string }> };
  const db = getDb();
  const [conversation] = await db.select().from(messages).where(and(
    eq(messages.id, conversationId),
    eq(messages.direction, "outbound"),
    eq(messages.channel, "email"),
    eq(messages.provider, "resend"),
    eq(sql<string>`lower(${messages.recipientAddress})`, from),
    inArray(messages.status, ["sent", "delivered"]),
  )).limit(1);
  if (!conversation) return;
  const attachmentCount = received.attachments?.length || 0;
  const body = String(received.text || textFromHtml(received.html || "") || "").trim().slice(0, 5000);
  if (!body && !attachmentCount) return;
  const inboundBody = `${body}${body && attachmentCount ? "\n\n" : ""}${attachmentCount ? `[${attachmentCount} email attachment${attachmentCount === 1 ? "" : "s"} received]` : ""}`;
  const [created] = await db.insert(messages).values({
    id: crypto.randomUUID(),
    organizationId: conversation.organizationId,
    locationId: conversation.locationId,
    clientId: conversation.clientId,
    appointmentId: conversation.appointmentId,
    dedupeKey: `inbound:resend:${input.providerEmailId}`,
    direction: "inbound",
    channel: "email",
    category: "transactional",
    status: "action_required",
    recipientName: conversation.recipientName,
    recipientAddress: from,
    subject: input.subject.slice(0, 500),
    body: inboundBody,
    provider: "resend",
    providerMessageId: input.providerEmailId,
    scheduledFor: input.occurredAt,
    sentAt: input.occurredAt,
  }).onConflictDoNothing().returning();
  if (!created) return;
  const now = new Date().toISOString();
  await db.batch([
    db.insert(messageEvents).values({
      id: `inbound:resend:${input.eventId}`,
      organizationId: conversation.organizationId,
      locationId: conversation.locationId,
      messageId: created.id,
      type: "message.inbound_received",
      actorType: "client",
      actorId: conversation.clientId,
      detailsJson: JSON.stringify({ from, to: input.to, attachmentCount }),
    }).onConflictDoNothing(),
    db.update(clients).set({ emailDeliverability: "reachable", emailDeliverabilityAt: input.occurredAt, updatedAt: now }).where(and(
      eq(clients.id, conversation.clientId),
      eq(clients.organizationId, conversation.organizationId),
    )),
  ]);
}

export async function POST(request: Request) {
  const payload = await request.text(); const values = process.env as RuntimeValues;
  const id = request.headers.get("svix-id") || "", timestamp = request.headers.get("svix-timestamp") || "", signature = request.headers.get("svix-signature") || "";
  if (!await verifyResendWebhook({ payload, id, timestamp, signature, secret: values.RESEND_WEBHOOK_SECRET?.trim() || "" })) return new Response("Invalid webhook", { status: 400 });
  let event: { type?: string; created_at?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string; bounce?: { message?: string }; error?: { message?: string } } };
  try { event = JSON.parse(payload) as typeof event; } catch { return new Response("Invalid payload", { status: 400 }); }
  const eventType = String(event.type || ""), providerMessageId = String(event.data?.email_id || "");
  if (!eventType.startsWith("email.") || !providerMessageId) return new Response(null, { status: 204 });
  const occurredAt = event.created_at && !Number.isNaN(new Date(event.created_at).getTime()) ? new Date(event.created_at).toISOString() : new Date(Number(timestamp) * 1000).toISOString();
  if (eventType === "email.received") {
    await captureInboundEmail(values, {
      providerEmailId: providerMessageId,
      from: String(event.data?.from || ""),
      to: Array.isArray(event.data?.to) ? event.data.to.map(String) : [],
      subject: String(event.data?.subject || ""),
      occurredAt,
      eventId: id,
    });
    return new Response(null, { status: 204 });
  }
  await reconcileDeliveryEvent(getDb(), { provider: "resend", providerEventId: id, providerMessageId, eventType, occurredAt, reason: event.data?.bounce?.message || event.data?.error?.message });
  return new Response(null, { status: 204 });
}
