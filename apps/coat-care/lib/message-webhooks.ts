import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { getDb } from "../db";
import { clients, deliveryProviderEvents, messageEvents, messages } from "../db/schema";

type Db = ReturnType<typeof getDb>;
type Provider = "resend" | "twilio";

export type DeliveryEventInput = {
  provider: Provider;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  occurredAt: string;
  reason?: string;
};

function messageOutcome(input: DeliveryEventInput) {
  const type = input.eventType.toLowerCase();
  if (type === "email.delivered" || type === "sms.delivered" || type === "sms.read") return "delivered" as const;
  if (type === "email.sent" || type === "sms.sent") return "sent" as const;
  if (["email.bounced", "email.failed", "email.suppressed", "sms.failed", "sms.undelivered"].includes(type)) return "failed" as const;
  if (type === "sms.canceled" || type === "sms.cancelled") return "cancelled" as const;
  return null;
}

function timelineType(input: DeliveryEventInput) {
  return `message.provider_${input.eventType.replace(/^(email|sms)\./, "").replaceAll(".", "_")}`;
}

export async function reconcileDeliveryEvent(db: Db, input: DeliveryEventInput) {
  const receivedAt = new Date().toISOString();
  await db.insert(deliveryProviderEvents).values({ id: crypto.randomUUID(), provider: input.provider, providerEventId: input.providerEventId, providerMessageId: input.providerMessageId, eventType: input.eventType, receivedAt })
    .onConflictDoNothing();
  const [message] = await db.select().from(messages).where(and(eq(messages.provider, input.provider), eq(messages.providerMessageId, input.providerMessageId))).limit(1);
  if (!message) {
    await db.update(deliveryProviderEvents).set({ status: "ignored", error: "No matching message", processedAt: receivedAt }).where(and(eq(deliveryProviderEvents.provider, input.provider), eq(deliveryProviderEvents.providerEventId, input.providerEventId)));
    return { state: "ignored" as const };
  }

  const outcome = messageOutcome(input), reason = String(input.reason || "").slice(0, 500);
  if (outcome === "delivered") await db.update(messages).set({ status: "delivered", deliveredAt: input.occurredAt, lastError: "", updatedAt: receivedAt }).where(eq(messages.id, message.id));
  else if (outcome === "sent") await db.update(messages).set({ status: "sent", sentAt: message.sentAt || input.occurredAt, lastError: "", updatedAt: receivedAt }).where(and(eq(messages.id, message.id), inArray(messages.status, ["action_required", "scheduled", "processing", "sent"])));
  else if (outcome === "failed") await db.update(messages).set({ status: "failed", lastError: reason || `${input.provider} reported ${input.eventType}`, updatedAt: receivedAt }).where(and(eq(messages.id, message.id), ne(messages.status, "delivered"), ne(messages.status, "cancelled")));
  else if (outcome === "cancelled") await db.update(messages).set({ status: "cancelled", updatedAt: receivedAt }).where(and(eq(messages.id, message.id), ne(messages.status, "delivered")));

  const [reconciled] = await db.select({ status: messages.status }).from(messages).where(eq(messages.id, message.id)).limit(1);
  const healthWhere = input.provider === "resend"
    ? and(eq(clients.id, message.clientId), or(isNull(clients.emailDeliverabilityAt), lte(clients.emailDeliverabilityAt, input.occurredAt)))
    : and(eq(clients.id, message.clientId), or(isNull(clients.smsDeliverabilityAt), lte(clients.smsDeliverabilityAt, input.occurredAt)));
  const type = input.eventType.toLowerCase();
  if (reconciled?.status === "delivered" && type === "email.delivered") await db.update(clients).set({ emailDeliverability: "reachable", emailDeliverabilityAt: input.occurredAt, updatedAt: receivedAt }).where(healthWhere);
  else if ((type === "email.complained" || reconciled?.status === "failed") && ["email.bounced", "email.complained", "email.suppressed"].includes(type)) await db.update(clients).set({ emailDeliverability: type.slice(6) as "bounced" | "complained" | "suppressed", emailDeliverabilityAt: input.occurredAt, updatedAt: receivedAt }).where(healthWhere);
  else if (reconciled?.status === "delivered" && ["sms.delivered", "sms.read"].includes(type)) await db.update(clients).set({ smsDeliverability: "reachable", smsDeliverabilityAt: input.occurredAt, updatedAt: receivedAt }).where(healthWhere);
  else if (reconciled?.status === "failed" && ["sms.undelivered", "sms.failed"].includes(type)) await db.update(clients).set({ smsDeliverability: type.slice(4) as "undelivered" | "failed", smsDeliverabilityAt: input.occurredAt, updatedAt: receivedAt }).where(healthWhere);

  await db.insert(messageEvents).values({ id: `delivery:${input.provider}:${input.providerEventId}`, organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: timelineType(input), actorType: "provider", actorId: input.provider, detailsJson: JSON.stringify({ eventType: input.eventType, reason, occurredAt: input.occurredAt }) }).onConflictDoNothing();
  await db.update(deliveryProviderEvents).set({ messageId: message.id, status: "processed", error: "", processedAt: receivedAt }).where(and(eq(deliveryProviderEvents.provider, input.provider), eq(deliveryProviderEvents.providerEventId, input.providerEventId)));
  return { state: "processed" as const, messageId: message.id };
}
