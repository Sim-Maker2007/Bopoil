import { and, desc, eq } from "drizzle-orm";
import { appointments, clients, communicationTemplates, messageEvents, messages, pets } from "../../../db/schema";
import { requireSalonAccess, requireSchedulingAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { cancelProviderMessage, dispatchMessage, publicDeliveryConfig } from "../../../lib/message-delivery";
import { PORTAL_LINK_TEMPLATE_KEYS, redactPortalLinks, refreshPortalLinkBody } from "../../../lib/portal-links";

const channels = ["email", "sms"] as const;
const categories = ["transactional", "marketing"] as const;

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "messages");
    const rows = await db.select({
      id: messages.id, clientId: messages.clientId, appointmentId: messages.appointmentId, templateId: messages.templateId,
      direction: messages.direction, channel: messages.channel, category: messages.category, status: messages.status,
      recipientName: messages.recipientName, recipientAddress: messages.recipientAddress, subject: messages.subject, body: messages.body,
      provider: messages.provider, providerMessageId: messages.providerMessageId, deliveryAttempts: messages.deliveryAttempts, lastError: messages.lastError, scheduledFor: messages.scheduledFor, sentAt: messages.sentAt, deliveredAt: messages.deliveredAt,
      createdAt: messages.createdAt, updatedAt: messages.updatedAt, clientName: clients.fullName, marketingConsent: clients.marketingConsent, emailDeliverability: clients.emailDeliverability, smsDeliverability: clients.smsDeliverability, petName: pets.name,
	      appointmentStartsAt: appointments.startsAt, templateName: communicationTemplates.name, templateKey: communicationTemplates.key,
    }).from(messages)
      .innerJoin(clients, eq(messages.clientId, clients.id))
      .leftJoin(appointments, eq(messages.appointmentId, appointments.id))
      .leftJoin(pets, eq(appointments.petId, pets.id))
      .leftJoin(communicationTemplates, eq(messages.templateId, communicationTemplates.id))
      .where(and(eq(messages.organizationId, membership.organizationId), eq(messages.locationId, membership.locationId)))
      .orderBy(desc(messages.createdAt)).limit(150);
    const events = await db.select().from(messageEvents).where(and(eq(messageEvents.organizationId, membership.organizationId), eq(messageEvents.locationId, membership.locationId))).orderBy(desc(messageEvents.createdAt)).limit(400);
    const canSharePortal = ["owner", "manager", "receptionist"].includes(membership.role)
      && membership.permissions.includes("calendar")
      && membership.permissions.includes("clients");
    const visibleRows = canSharePortal ? rows : rows.map((row) => ({ ...row, body: redactPortalLinks(row.body) }));
    return Response.json({
      messages: visibleRows,
      events,
      provider: publicDeliveryConfig(),
      canCompose: membership.permissions.includes("clients"),
      canSharePortal,
      now: new Date().toISOString(),
    });
  } catch (error) { return salonApiError(error, "Messages unavailable"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "messages");
    requireWorkspacePermission(membership, "clients");
    const body = await request.json() as Record<string, unknown>;
    const clientId = String(body.clientId || "");
    const channel = String(body.channel || "email") as typeof channels[number];
    const category = String(body.category || "transactional") as typeof categories[number];
    const messageBody = String(body.body || "").trim();
    const subject = String(body.subject || "").trim();
    const appointmentId = body.appointmentId ? String(body.appointmentId) : null;
    const scheduledFor = body.scheduledFor ? new Date(String(body.scheduledFor)) : new Date();
    if (!channels.includes(channel) || !categories.includes(category) || !messageBody || messageBody.length > 5000 || (channel === "email" && !subject) || Number.isNaN(scheduledFor.getTime())) throw new SalonAccessError("Complete the recipient, channel, subject, and message.", 400);
    const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, membership.organizationId))).limit(1);
    if (!client) throw new SalonAccessError("Client not found.", 404);
    if (category === "marketing" && !client.marketingConsent) throw new SalonAccessError("This client has not opted into marketing messages.", 409);
    if (appointmentId) {
      const [appointment] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.clientId, clientId), eq(appointments.organizationId, membership.organizationId))).limit(1);
      if (!appointment) throw new SalonAccessError("Appointment does not belong to this client.", 400);
    }
    const id = crypto.randomUUID();
    const now = new Date();
    const status = scheduledFor.getTime() > now.getTime() ? "scheduled" as const : "action_required" as const;
    const [created] = await db.insert(messages).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, clientId, appointmentId, dedupeKey: `manual:${id}`, channel, category, status, recipientName: client.fullName, recipientAddress: channel === "email" ? client.email : client.phone, subject, body: messageBody, scheduledFor: scheduledFor.toISOString(), createdByStaffId: membership.id }).returning();
    await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, messageId: id, type: "message.composed", actorType: "staff", actorId: membership.id, detailsJson: JSON.stringify({ channel, category, scheduledFor: scheduledFor.toISOString() }) });
    const delivery = await dispatchMessage(db, created.id);
    return Response.json({ message: "message" in delivery ? delivery.message : created, delivery: delivery.state }, { status: 201 });
  } catch (error) { return salonApiError(error, "Message could not be created"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "messages");
    const body = await request.json() as { messageId?: string; action?: string; error?: string };
    const messageId = String(body.messageId || ""); const action = String(body.action || "");
    const [existing] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.organizationId, membership.organizationId), eq(messages.locationId, membership.locationId))).limit(1);
    if (!existing) throw new SalonAccessError("Message not found.", 404);
    if (existing.direction === "inbound" && action !== "mark_handled") throw new SalonAccessError("Use Mark handled for an inbound client reply.", 400);
    if (action === "refresh_secure_link") {
      requireWorkspacePermission(membership, "clients");
      requireSchedulingAccess(membership);
      if (!existing.templateId || !["action_required", "scheduled", "failed"].includes(existing.status) || existing.providerMessageId) throw new SalonAccessError("This message cannot receive a new secure link.", 409);
      const [template] = await db.select({ key: communicationTemplates.key }).from(communicationTemplates).where(and(
        eq(communicationTemplates.id, existing.templateId),
        eq(communicationTemplates.organizationId, membership.organizationId),
        eq(communicationTemplates.locationId, membership.locationId),
      )).limit(1);
      if (!template || !PORTAL_LINK_TEMPLATE_KEYS.has(template.key)) throw new SalonAccessError("This message does not contain a client portal link.", 400);
      const refreshed = await refreshPortalLinkBody(db, { clientId: existing.clientId, body: existing.body, origin: process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin });
      if (!refreshed.refreshed) throw new SalonAccessError("A fresh secure link could not be created.", 503);
      const now = new Date().toISOString();
      const [updated] = await db.update(messages).set({ body: refreshed.body, updatedAt: now }).where(and(
        eq(messages.id, existing.id),
        eq(messages.updatedAt, existing.updatedAt),
        eq(messages.providerMessageId, ""),
      )).returning();
      if (!updated) throw new SalonAccessError("This message changed. Refresh and try again.", 409);
      await db.insert(messageEvents).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        locationId: membership.locationId,
        messageId,
        type: "message.secure_link_refreshed",
        actorType: "staff",
        actorId: membership.id,
        detailsJson: JSON.stringify({ sessionId: refreshed.sessionId, atDelivery: false }),
      });
      return Response.json({ message: updated });
    }
    if (action === "verify_recipient_and_retry") {
      if (existing.status !== "failed") throw new SalonAccessError("Only failed messages can be retried after recipient verification.", 409);
      const now = new Date().toISOString(), id = crypto.randomUUID();
      await db.update(clients).set(existing.channel === "email" ? { emailDeliverability: "unknown", emailDeliverabilityAt: now, updatedAt: now } : { smsDeliverability: "unknown", smsDeliverabilityAt: now, updatedAt: now }).where(and(eq(clients.id, existing.clientId), eq(clients.organizationId, membership.organizationId)));
      const [retry] = await db.insert(messages).values({ id, organizationId: existing.organizationId, locationId: existing.locationId, clientId: existing.clientId, appointmentId: existing.appointmentId, templateId: existing.templateId, dedupeKey: `verified-retry:${existing.id}:${id}`, channel: existing.channel, category: existing.category, status: "action_required", recipientName: existing.recipientName, recipientAddress: existing.recipientAddress, subject: existing.subject, body: existing.body, scheduledFor: now, createdByStaffId: membership.id }).returning();
      await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: existing.organizationId, locationId: existing.locationId, messageId: retry.id, type: "message.recipient_verified_retry", actorType: "staff", actorId: membership.id, detailsJson: JSON.stringify({ previousMessageId: existing.id, channel: existing.channel }) });
      const delivery = await dispatchMessage(db, retry.id); return Response.json({ message: "message" in delivery ? delivery.message : retry, delivery: delivery.state });
    }
    if (action === "mark_sent" && existing.category === "marketing") { const [recipient] = await db.select({ marketingConsent: clients.marketingConsent }).from(clients).where(and(eq(clients.id, existing.clientId), eq(clients.organizationId, membership.organizationId))).limit(1); if (!recipient?.marketingConsent) throw new SalonAccessError("This client is not currently opted into marketing messages.", 409); }
    const now = new Date().toISOString();
    let status: typeof existing.status; let eventType: string; let update: Partial<typeof messages.$inferInsert>;
    if (action === "mark_handled" && existing.direction === "inbound" && existing.status === "action_required") { status = "delivered"; eventType = "message.inbound_handled"; update = { status, deliveredAt: now, updatedAt: now }; }
    else if (action === "mark_sent" && existing.direction === "outbound" && ["action_required", "scheduled", "failed"].includes(existing.status)) { status = "sent"; eventType = "message.sent_manually"; update = { status, provider: "manual", sentAt: now, updatedAt: now, lastError: "" }; }
    else if (action === "mark_delivered" && existing.status === "sent") { status = "delivered"; eventType = "message.delivered_manually"; update = { status, provider: "manual", sentAt: existing.sentAt || now, updatedAt: now, lastError: "" }; }
    else if (action === "retry" && existing.status === "failed") { status = "action_required"; eventType = "message.retry_requested"; update = { status, lastError: "", updatedAt: now }; }
    else if (action === "cancel" && ["action_required", "scheduled", "failed"].includes(existing.status)) { if (existing.providerMessageId) await cancelProviderMessage(existing); status = "cancelled"; eventType = "message.cancelled"; update = { status, updatedAt: now }; }
    else if (action === "mark_failed" && ["action_required", "scheduled", "sent"].includes(existing.status)) { status = "failed"; eventType = "message.failed"; update = { status, lastError: String(body.error || "Manual delivery failed"), updatedAt: now }; }
    else throw new SalonAccessError("Choose a valid message action.", 400);
    const [updated] = await db.update(messages).set(update).where(eq(messages.id, messageId)).returning();
    await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, messageId, type: eventType, actorType: "staff", actorId: membership.id, detailsJson: JSON.stringify({ from: existing.status, to: status }) });
    return Response.json({ message: updated });
  } catch (error) { return salonApiError(error, "Message could not be updated"); }
}
