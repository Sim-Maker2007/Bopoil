import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { clients, communicationTemplates, messageEvents, messages } from "../db/schema";
import { DeliveryConfig, resendRequest, twilioRequest } from "./message-provider-payloads";
import { PORTAL_LINK_TEMPLATE_KEYS, refreshPortalLinkBody, safePublicOrigin } from "./portal-links";

type Db = ReturnType<typeof getDb>;
type Fetcher = typeof fetch;
type Message = typeof messages.$inferSelect;
type RuntimeValues = Record<string, string | undefined>;

function runtimeValues() { return process.env as RuntimeValues; }
export function deliveryConfig(values: RuntimeValues = runtimeValues()): DeliveryConfig {
  const apiKey = values.RESEND_API_KEY?.trim() || "", from = values.RESEND_FROM_EMAIL?.trim() || "";
  const accountSid = values.TWILIO_ACCOUNT_SID?.trim() || "", authToken = values.TWILIO_AUTH_TOKEN?.trim() || "", messagingServiceSid = values.TWILIO_MESSAGING_SERVICE_SID?.trim() || "";
  let publicUrl = ""; try { const parsed = new URL(values.DELIVERY_PUBLIC_URL?.trim() || ""); if (parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) publicUrl = parsed.origin; } catch { /* stays disabled until a valid public URL is configured */ }
  return {
    email: { configured: Boolean(apiKey && from), webhookConfigured: Boolean(values.RESEND_WEBHOOK_SECRET?.trim()), provider: "resend", apiKey, from, replyTo: values.RESEND_REPLY_TO?.trim() || "" },
    sms: { configured: Boolean(accountSid && authToken && messagingServiceSid), webhookConfigured: Boolean(publicUrl && authToken), provider: "twilio", accountSid, authToken, messagingServiceSid, callbackUrl: publicUrl ? `${publicUrl}/api/webhooks/twilio` : "" },
  };
}

// Only what the public booking page branches on. Provider names and webhook
// state stay private to the salon workspace.
export function publicDeliveryConfig(config = deliveryConfig()) {
  return { email: { configured: config.email.configured }, sms: { configured: config.sms.configured } };
}

async function responseError(response: Response) { const text = await response.text(); try { const body = JSON.parse(text) as { message?: string; error?: { message?: string } }; return body.message || body.error?.message || `${response.status} ${response.statusText}`; } catch { return text.slice(0, 300) || `${response.status} ${response.statusText}`; } }

export async function dispatchMessage(db: Db, messageId: string, options: { now?: Date; fetcher?: Fetcher } = {}) {
  const nowDate = options.now || new Date(), now = nowDate.toISOString(), fetcher = options.fetcher || fetch, values = runtimeValues(), config = deliveryConfig(values);
  const [row] = await db.select({
    message: messages,
    marketingConsent: clients.marketingConsent,
    emailDeliverability: clients.emailDeliverability,
    smsDeliverability: clients.smsDeliverability,
    clientEmail: clients.email,
    templateKey: communicationTemplates.key,
  }).from(messages)
    .innerJoin(clients, eq(messages.clientId, clients.id))
    .leftJoin(communicationTemplates, eq(messages.templateId, communicationTemplates.id))
    .where(eq(messages.id, messageId)).limit(1);
  if (!row) return { state: "missing" as const };
  let message = row.message;
  if (["sent", "delivered", "cancelled"].includes(message.status)) return { state: "terminal" as const, message };
  if (message.providerMessageId) return { state: message.status === "scheduled" ? "provider_scheduled" as const : "provider_recorded" as const, message };
  if (message.category === "marketing" && !row.marketingConsent) return { state: "suppressed" as const, reason: "Marketing consent is not active." };
  const canUseEmailFallback = message.channel === "sms"
    && ["action_required", "scheduled", "failed"].includes(message.status)
    && !config.sms.configured
    && config.email.configured
    && !["bounced", "complained", "suppressed"].includes(row.emailDeliverability)
    && ["approval_request", "ready_pickup"].includes(row.templateKey || "");
  const deliveryIssue = message.channel === "email" && ["bounced", "complained", "suppressed"].includes(row.emailDeliverability) ? `Email is blocked after a ${row.emailDeliverability} event. Verify or update the address before retrying.` : message.channel === "sms" && !canUseEmailFallback && ["undelivered", "failed"].includes(row.smsDeliverability) ? `SMS is blocked after a ${row.smsDeliverability} event. Verify or update the number before retrying.` : "";
  if (deliveryIssue) {
    await db.update(messages).set({ status: "failed", lastError: deliveryIssue, updatedAt: now }).where(and(eq(messages.id, message.id), inArray(messages.status, ["action_required", "scheduled", "failed"])));
    await db.insert(messageEvents).values({ id: `recipient-blocked:${message.id}`, organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: "message.recipient_blocked", actorType: "system", detailsJson: JSON.stringify({ channel: message.channel, reason: deliveryIssue }) }).onConflictDoNothing();
    return { state: "suppressed" as const, reason: deliveryIssue };
  }
  const emailFallbackSubject = row.templateKey === "approval_request"
    ? "Approval needed for your pet’s care"
    : row.templateKey === "ready_pickup"
      ? "Your pet is ready for pickup"
      : "An update from your pet care team";
  if (canUseEmailFallback) {
    const [converted] = await db.update(messages).set({
      channel: "email",
      recipientAddress: row.clientEmail,
      subject: message.subject || emailFallbackSubject,
      updatedAt: now,
    }).where(and(eq(messages.id, message.id), eq(messages.updatedAt, message.updatedAt), eq(messages.providerMessageId, ""))).returning();
    if (converted) {
      message = converted;
      await db.insert(messageEvents).values({
        id: crypto.randomUUID(),
        organizationId: message.organizationId,
        locationId: message.locationId,
        messageId: message.id,
        type: "message.channel_fallback",
        actorType: "system",
        detailsJson: JSON.stringify({ from: "sms", to: "email", reason: "SMS provider unavailable" }),
      });
    }
  }
  let channelConfig = message.channel === "email" ? config.email : config.sms;
  if (!channelConfig.configured) return { state: "unconfigured" as const, channel: message.channel, message };
  if (
    row.templateKey
    && PORTAL_LINK_TEMPLATE_KEYS.has(row.templateKey)
    && new Date(message.scheduledFor).getTime() > nowDate.getTime() + 60_000
  ) {
    return { state: "deferred" as const, message };
  }
  if (row.templateKey && PORTAL_LINK_TEMPLATE_KEYS.has(row.templateKey)) {
    const refreshed = await refreshPortalLinkBody(db, {
      clientId: message.clientId,
      body: message.body,
      origin: safePublicOrigin(values.DELIVERY_PUBLIC_URL),
    });
    if (refreshed.refreshed) {
      const [updated] = await db.update(messages).set({ body: refreshed.body, updatedAt: now }).where(and(
        eq(messages.id, message.id),
        eq(messages.updatedAt, message.updatedAt),
        eq(messages.providerMessageId, ""),
      )).returning();
      if (updated) {
        message = updated;
        await db.insert(messageEvents).values({
          id: crypto.randomUUID(),
          organizationId: message.organizationId,
          locationId: message.locationId,
          messageId: message.id,
          type: "message.secure_link_refreshed",
          actorType: "system",
          detailsJson: JSON.stringify({ sessionId: refreshed.sessionId, atDelivery: true }),
        });
      }
    }
  }
  channelConfig = message.channel === "email" ? config.email : config.sms;
  const stale = new Date(nowDate.getTime() - 10 * 60_000).toISOString();
  const abandonedClaim = message.status === "processing" && (!message.processingStartedAt || message.processingStartedAt < stale);
  if (message.channel === "sms" && abandonedClaim) {
    const reason = "Twilio delivery is uncertain after an interrupted request. Check the Twilio message log before retrying to avoid sending a duplicate.";
    const [marked] = await db.update(messages).set({ status: "failed", processingStartedAt: null, lastError: reason, updatedAt: now }).where(and(eq(messages.id, message.id), eq(messages.status, "processing"), eq(messages.updatedAt, message.updatedAt), or(isNull(messages.processingStartedAt), lt(messages.processingStartedAt, stale)))).returning();
    if (!marked) return { state: "busy" as const };
    await db.insert(messageEvents).values({ id: `delivery-uncertain:stale:${message.id}:${message.deliveryAttempts}`, organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: "message.delivery_uncertain", actorType: "system", detailsJson: JSON.stringify({ provider: "twilio", reason }) }).onConflictDoNothing();
    return { state: "uncertain" as const, reason };
  }
  let request;
  try { request = message.channel === "email" ? resendRequest(message, config, nowDate) : twilioRequest(message, config, nowDate); }
  catch (error) { request = { error: error instanceof Error ? error.message : "Invalid delivery details" }; }
  if (!request) return { state: "deferred" as const, message };
  if ("error" in request) {
    const error = request.error;
    const [failed] = await db.update(messages).set({ status: "failed", processingStartedAt: null, lastError: error, updatedAt: now }).where(and(eq(messages.id, message.id), eq(messages.updatedAt, message.updatedAt), or(inArray(messages.status, ["action_required", "scheduled", "failed"]), and(eq(messages.status, "processing"), or(isNull(messages.processingStartedAt), lt(messages.processingStartedAt, stale)))))).returning();
    if (!failed) return { state: "busy" as const };
    await db.insert(messageEvents).values({ id: `delivery-validation:${message.id}:${message.deliveryAttempts}`, organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: "message.delivery_validation_failed", actorType: "system", detailsJson: JSON.stringify({ reason: error }) }).onConflictDoNothing();
    return { state: "failed" as const, error };
  }
  const [claimed] = await db.update(messages).set({ status: "processing", processingStartedAt: now, deliveryAttempts: sql`${messages.deliveryAttempts} + 1`, updatedAt: now }).where(and(eq(messages.id, message.id), eq(messages.updatedAt, message.updatedAt), or(inArray(messages.status, ["action_required", "scheduled", "failed"]), and(eq(messages.status, "processing"), or(isNull(messages.processingStartedAt), lt(messages.processingStartedAt, stale)))))).returning();
  if (!claimed) return { state: "busy" as const };
  let providerAcknowledgement: { id: string; status: string; scheduled: boolean } | null = null;
  let providerRejectedRequest = false;
  async function recordAcknowledgementAfterConflict(acknowledgement: { id: string; scheduled: boolean }) {
    const reason = "The provider accepted this message after its local delivery state changed. Verify the provider record before taking another action.";
    try {
      const [recorded] = await db.update(messages).set({ provider: channelConfig.provider, providerMessageId: acknowledgement.id, processingStartedAt: null, lastError: reason, updatedAt: new Date().toISOString() }).where(and(eq(messages.id, message.id), eq(messages.providerMessageId, ""))).returning();
      return { recorded, reason };
    } catch {
      return { recorded: undefined, reason };
    }
  }
  try {
    const response = await fetcher(request.url, request.init);
    if (!response.ok) { providerRejectedRequest = true; throw new Error(await responseError(response)); }
    const result = await response.json() as { id?: string; sid?: string; status?: string }; const providerMessageId = result.id || result.sid || "";
    if (!providerMessageId) throw new Error("The delivery provider did not return a message identifier.");
    const status = request.scheduled ? "scheduled" : "sent", eventType = request.scheduled ? "message.scheduled_with_provider" : "message.accepted_by_provider";
    providerAcknowledgement = { id: providerMessageId, status: result.status || (request.scheduled ? "scheduled" : "accepted"), scheduled: request.scheduled };
    const [updatedRows] = await db.batch([
      db.update(messages).set({ status, provider: channelConfig.provider, providerMessageId, processingStartedAt: null, sentAt: request.scheduled ? null : now, lastError: "", updatedAt: new Date().toISOString() }).where(and(eq(messages.id, message.id), eq(messages.status, "processing"), eq(messages.processingStartedAt, now))).returning(),
      db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: eventType, actorType: "provider", actorId: channelConfig.provider, detailsJson: JSON.stringify({ provider: channelConfig.provider, providerMessageId, providerStatus: providerAcknowledgement.status }) }),
    ]);
    const updated = updatedRows[0];
    if (updated) return { state: request.scheduled ? "scheduled" as const : "accepted" as const, message: updated };
    const conflict = await recordAcknowledgementAfterConflict(providerAcknowledgement);
    return { state: "uncertain" as const, reason: conflict.reason, ...(conflict.recorded ? { message: conflict.recorded } : {}) };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Provider delivery failed").slice(0, 500);
    if (providerAcknowledgement) {
      try {
        const status = providerAcknowledgement.scheduled ? "scheduled" : "sent";
        const [reconciled] = await db.update(messages).set({ status, provider: channelConfig.provider, providerMessageId: providerAcknowledgement.id, processingStartedAt: null, sentAt: providerAcknowledgement.scheduled ? null : now, lastError: "", updatedAt: new Date().toISOString() }).where(and(eq(messages.id, message.id), eq(messages.status, "processing"), eq(messages.processingStartedAt, now))).returning();
        if (reconciled) return { state: providerAcknowledgement.scheduled ? "scheduled" as const : "accepted" as const, message: reconciled };
      } catch { /* Leave the claim in processing; stale SMS claims require manual reconciliation and Resend retries are idempotent. */ }
      const conflict = await recordAcknowledgementAfterConflict(providerAcknowledgement);
      return { state: "uncertain" as const, reason: conflict.reason, ...(conflict.recorded ? { message: conflict.recorded } : {}) };
    }
    if (message.channel === "sms" && !providerRejectedRequest) {
      const uncertainReason = `Twilio may have accepted this message, but no receipt was recorded (${reason}). Check the Twilio message log before retrying.`;
      await db.batch([
        db.update(messages).set({ status: "failed", processingStartedAt: null, lastError: uncertainReason, updatedAt: new Date().toISOString() }).where(and(eq(messages.id, message.id), eq(messages.status, "processing"), eq(messages.processingStartedAt, now))),
        db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: "message.delivery_uncertain", actorType: "provider", actorId: "twilio", detailsJson: JSON.stringify({ provider: "twilio", reason }) }),
      ]);
      return { state: "uncertain" as const, reason: uncertainReason };
    }
    await db.update(messages).set({ status: "failed", processingStartedAt: null, lastError: reason, updatedAt: new Date().toISOString() }).where(and(eq(messages.id, message.id), eq(messages.status, "processing"), eq(messages.processingStartedAt, now)));
    await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: message.organizationId, locationId: message.locationId, messageId: message.id, type: "message.provider_failed", actorType: "provider", actorId: channelConfig.provider, detailsJson: JSON.stringify({ provider: channelConfig.provider, reason }) });
    return { state: "failed" as const, error: reason };
  }
}

export async function sweepDueMessages(db: Db, now = new Date(), limit = 25) {
  const nowIso = now.toISOString(), stale = new Date(now.getTime() - 10 * 60_000).toISOString();
  const config = deliveryConfig();
  if (!config.email.configured && !config.sms.configured) return {};
  const deliverableChannel = or(
    config.email.configured ? eq(messages.channel, "email") : undefined,
    config.sms.configured ? eq(messages.channel, "sms") : undefined,
    config.email.configured && !config.sms.configured
      ? and(eq(messages.channel, "sms"), inArray(communicationTemplates.key, ["approval_request", "ready_pickup"]))
      : undefined,
  );
  const ids = await db.select({ id: messages.id }).from(messages)
    .leftJoin(communicationTemplates, eq(messages.templateId, communicationTemplates.id))
    .where(and(
      deliverableChannel,
      or(inArray(messages.status, ["action_required", "scheduled"]), and(eq(messages.status, "processing"), or(isNull(messages.processingStartedAt), lt(messages.processingStartedAt, stale)))),
      eq(messages.providerMessageId, ""),
      lte(messages.scheduledFor, nowIso),
    )).orderBy(asc(messages.scheduledFor)).limit(limit);
  const results = await Promise.all(ids.map((item) => dispatchMessage(db, item.id, { now })));
  return results.reduce<Record<string, number>>((counts, result) => { counts[result.state] = (counts[result.state] || 0) + 1; return counts; }, {});
}

export async function cancelProviderMessage(message: Message, fetcher: Fetcher = fetch) {
  if (!message.providerMessageId || !["resend", "twilio"].includes(message.provider)) return { cancelled: false, localOnly: true };
  const config = deliveryConfig(); let url: string, init: RequestInit;
  if (message.provider === "resend") {
    if (!config.email.configured) throw new Error("Resend credentials are unavailable, so the scheduled email could not be cancelled.");
    url = `https://api.resend.com/emails/${encodeURIComponent(message.providerMessageId)}/cancel`; init = { method: "POST", headers: { authorization: `Bearer ${config.email.apiKey}`, "content-type": "application/json" } };
  } else {
    if (!config.sms.configured) throw new Error("Twilio credentials are unavailable, so the scheduled SMS could not be cancelled.");
    url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sms.accountSid)}/Messages/${encodeURIComponent(message.providerMessageId)}.json`; init = { method: "POST", headers: { authorization: `Basic ${btoa(`${config.sms.accountSid}:${config.sms.authToken}`)}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ Status: "canceled" }).toString() };
  }
  const response = await fetcher(url, init); if (!response.ok) throw new Error(await responseError(response)); return { cancelled: true, localOnly: false };
}
