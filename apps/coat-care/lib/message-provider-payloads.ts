export type DeliveryConfig = {
  email: { configured: boolean; webhookConfigured: boolean; provider: "resend"; apiKey: string; from: string; replyTo: string };
  sms: { configured: boolean; webhookConfigured: boolean; provider: "twilio"; accountSid: string; authToken: string; messagingServiceSid: string; callbackUrl: string };
};

type DeliveryMessage = { id: string; recipientAddress: string; subject: string; body: string; scheduledFor: string; deliveryAttempts: number };

export function normalizeNorthAmericanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character)); }
export function emailHtml(body: string) { return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#29241f;white-space:pre-wrap">${escapeHtml(body)}</div>`; }

export function replyAddressForMessage(replyTo: string, messageId: string) {
  const address = replyTo.match(/<?([^<>\s]+@[^<>\s]+)>?\s*$/)?.[1] || "";
  const separator = address.lastIndexOf("@");
  if (separator < 1) return replyTo;
  const local = address.slice(0, separator).split("+")[0];
  const domain = address.slice(separator + 1);
  const tag = messageId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  return tag ? `${local}+cc-${tag}@${domain}` : replyTo;
}

export function resendRequest(message: DeliveryMessage, config: DeliveryConfig, now = new Date()) {
  const scheduledAt = new Date(message.scheduledFor), delay = scheduledAt.getTime() - now.getTime();
  if (Number.isNaN(delay)) throw new Error("Email delivery time is invalid.");
  const canSchedule = delay > 60_000 && delay <= 30 * 86400000;
  if (delay > 30 * 86400000) return null;
  const payload: Record<string, unknown> = { from: config.email.from, to: [message.recipientAddress], subject: message.subject, text: message.body, html: emailHtml(message.body) };
  if (config.email.replyTo) payload.reply_to = replyAddressForMessage(config.email.replyTo, message.id);
  if (canSchedule) payload.scheduled_at = scheduledAt.toISOString();
  return { url: "https://api.resend.com/emails", init: { method: "POST", headers: { authorization: `Bearer ${config.email.apiKey}`, "content-type": "application/json", "idempotency-key": `coat-care:${message.id}` }, body: JSON.stringify(payload) }, scheduled: canSchedule };
}

export function twilioRequest(message: Pick<DeliveryMessage, "recipientAddress" | "body" | "scheduledFor">, config: DeliveryConfig, now = new Date()) {
  const to = normalizeNorthAmericanPhone(message.recipientAddress); if (!to) throw new Error("SMS recipient must be a valid Canada/US phone number.");
  const scheduledAt = new Date(message.scheduledFor), delay = scheduledAt.getTime() - now.getTime();
  if (Number.isNaN(delay)) throw new Error("SMS delivery time is invalid.");
  if (delay > 0 && (delay < 15 * 60_000 || delay > 35 * 86400000)) return null;
  const form = new URLSearchParams({ To: to, MessagingServiceSid: config.sms.messagingServiceSid, Body: message.body.slice(0, 1600) });
  if (config.sms.callbackUrl) form.set("StatusCallback", config.sms.callbackUrl);
  const scheduled = delay >= 15 * 60_000;
  if (scheduled) { form.set("ScheduleType", "fixed"); form.set("SendAt", scheduledAt.toISOString()); }
  return { url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sms.accountSid)}/Messages.json`, init: { method: "POST", headers: { authorization: `Basic ${btoa(`${config.sms.accountSid}:${config.sms.authToken}`)}`, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() }, scheduled };
}
