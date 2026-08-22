import { and, eq, inArray } from "drizzle-orm";
import { getDb } from ".";
import { appointments, clients, communicationTemplates, locations, messageEvents, messages, pets, services } from "./schema";
import { reminderSendAt, renderCommunicationTemplate } from "../lib/communication-templates";
import { cancelProviderMessage, dispatchMessage } from "../lib/message-delivery";

type Db = ReturnType<typeof getDb>;

async function appointmentVariables(db: Db, appointmentId: string) {
  const [row] = await db.select({ appointment: appointments, client: clients, petName: pets.name, serviceName: services.name, timezone: locations.timezone })
    .from(appointments)
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(pets, eq(appointments.petId, pets.id))
    .innerJoin(services, eq(appointments.serviceId, services.id))
    .innerJoin(locations, eq(appointments.locationId, locations.id))
    .where(eq(appointments.id, appointmentId)).limit(1);
  if (!row) return null;
  const date = new Date(row.appointment.startsAt);
  return {
    row,
    variables: {
      client_name: row.client.fullName,
      pet_name: row.petName,
      service_name: row.serviceName,
      appointment_date: new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone, weekday: "long", month: "long", day: "numeric" }).format(date),
      appointment_time: new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone, hour: "numeric", minute: "2-digit" }).format(date),
    },
  };
}

export async function queueAppointmentMessage(db: Db, input: { appointmentId: string; templateKey: string; dedupeKey: string; scheduledFor?: string; variables?: Record<string, string> }) {
  const context = await appointmentVariables(db, input.appointmentId);
  if (!context) return null;
  const organizationId = context.row.appointment.organizationId;
  const [template] = await db.select().from(communicationTemplates).where(and(eq(communicationTemplates.organizationId, organizationId), eq(communicationTemplates.locationId, context.row.appointment.locationId), eq(communicationTemplates.key, input.templateKey), eq(communicationTemplates.active, true))).limit(1);
  if (!template) return null;
  const scheduledFor = input.scheduledFor || new Date().toISOString();
  const variables = { ...context.variables, ...input.variables };
  const [created] = await db.insert(messages).values({
    id: crypto.randomUUID(), organizationId, locationId: context.row.appointment.locationId,
    clientId: context.row.appointment.clientId, appointmentId: input.appointmentId, templateId: template.id,
    dedupeKey: input.dedupeKey, channel: template.channel, category: template.category,
    status: new Date(scheduledFor).getTime() > Date.now() ? "scheduled" : "action_required",
    recipientName: context.row.client.fullName,
    recipientAddress: template.channel === "email" ? context.row.client.email : context.row.client.phone,
    subject: renderCommunicationTemplate(template.subject, variables), body: renderCommunicationTemplate(template.body, variables), scheduledFor,
  }).onConflictDoNothing().returning();
  if (created) {
    await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId, locationId: context.row.appointment.locationId, messageId: created.id, type: "message.queued", actorType: "system", detailsJson: JSON.stringify({ templateKey: input.templateKey, scheduledFor }) });
    const delivery = await dispatchMessage(db, created.id).catch((error) => { console.error("Automatic delivery could not start", error); return null; });
    if (delivery && "message" in delivery && delivery.message) return delivery.message;
  }
  return created || null;
}

export async function queueBookingCommunications(db: Db, appointmentId: string, startsAt: string, status = "confirmed", variables?: Record<string, string>, dedupeSuffix = "") {
  const templateKey = status === "requested" ? "booking_request_received" : "booking_confirmation";
  const suffix = dedupeSuffix ? `:${dedupeSuffix}` : "";
  await queueAppointmentMessage(db, { appointmentId, templateKey, dedupeKey: `${templateKey}:${appointmentId}${suffix}`, variables });
  if (status === "requested") return;
  const reminderAt = reminderSendAt(startsAt);
  await queueAppointmentMessage(db, { appointmentId, templateKey: "appointment_reminder", dedupeKey: `appointment_reminder:${appointmentId}${suffix}`, scheduledFor: reminderAt, variables });
}

export async function queuePortalAccessMessage(db: Db, input: { clientId: string; locationId: string; portalUrl: string; dedupeKey: string }) {
  const [[client], [template]] = await Promise.all([
    db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1),
    db.select().from(communicationTemplates).where(and(eq(communicationTemplates.locationId, input.locationId), eq(communicationTemplates.key, "portal_access"), eq(communicationTemplates.active, true))).limit(1),
  ]);
  if (!client || !template) return null;
  const variables = { client_name: client.fullName, portal_url: input.portalUrl };
  const [created] = await db.insert(messages).values({ id: crypto.randomUUID(), organizationId: client.organizationId, locationId: input.locationId, clientId: client.id, templateId: template.id, dedupeKey: input.dedupeKey, channel: template.channel, category: "transactional", status: "action_required", recipientName: client.fullName, recipientAddress: template.channel === "email" ? client.email : client.phone, subject: renderCommunicationTemplate(template.subject, variables), body: renderCommunicationTemplate(template.body, variables) }).onConflictDoNothing().returning();
  if (created) { await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, locationId: input.locationId, messageId: created.id, type: "message.queued", actorType: "system", detailsJson: JSON.stringify({ templateKey: "portal_access" }) }); await dispatchMessage(db, created.id).catch((error) => console.error("Automatic delivery could not start", error)); }
  return created || null;
}

export async function queueClientTemplateMessage(db: Db, input: { clientId: string; locationId: string; templateKey: string; dedupeKey: string; variables: Record<string, string> }) {
  const [[client], [template]] = await Promise.all([
    db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1),
    db.select().from(communicationTemplates).where(and(eq(communicationTemplates.locationId, input.locationId), eq(communicationTemplates.key, input.templateKey), eq(communicationTemplates.active, true))).limit(1),
  ]);
  if (!client || !template) return null;
  const variables = { client_name: client.fullName, ...input.variables };
  const [created] = await db.insert(messages).values({ id: crypto.randomUUID(), organizationId: client.organizationId, locationId: input.locationId, clientId: client.id, templateId: template.id, dedupeKey: input.dedupeKey, channel: template.channel, category: "transactional", status: "action_required", recipientName: client.fullName, recipientAddress: template.channel === "email" ? client.email : client.phone, subject: renderCommunicationTemplate(template.subject, variables), body: renderCommunicationTemplate(template.body, variables) }).onConflictDoNothing().returning();
  if (created) { await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: client.organizationId, locationId: input.locationId, messageId: created.id, type: "message.queued", actorType: "system", detailsJson: JSON.stringify({ templateKey: input.templateKey }) }); await dispatchMessage(db, created.id).catch((error) => console.error("Automatic delivery could not start", error)); }
  return created || null;
}

export async function cancelPendingAppointmentMessages(db: Db, appointmentId: string, actorId: string, actorType: "staff" | "client" | "system" = "staff") {
  const pending = await db.select().from(messages).where(and(eq(messages.appointmentId, appointmentId), inArray(messages.status, ["scheduled", "action_required", "failed"])));
  if (!pending.length) return;
  const now = new Date().toISOString();
  for (const item of pending) {
    if (item.providerMessageId) {
      try { await cancelProviderMessage(item); }
      catch (error) { const reason = `Provider cancellation failed: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 500); await db.update(messages).set({ lastError: reason, updatedAt: now }).where(eq(messages.id, item.id)); await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: item.organizationId, locationId: item.locationId, messageId: item.id, type: "message.provider_cancellation_failed", actorType: "system", actorId, detailsJson: JSON.stringify({ reason }) }); continue; }
    }
    await db.update(messages).set({ status: "cancelled", updatedAt: now }).where(eq(messages.id, item.id));
    await db.insert(messageEvents).values({ id: crypto.randomUUID(), organizationId: item.organizationId, locationId: item.locationId, messageId: item.id, type: "message.cancelled", actorType, actorId, detailsJson: JSON.stringify({ reason: "appointment_cancelled" }) });
  }
}
