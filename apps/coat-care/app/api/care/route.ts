import { and, asc, eq } from "drizzle-orm";
import { appointmentCareRecords, appointments, approvalRequests, auditEvents, invoices, mediaAssets, messages, petWarnings, pets } from "../../../db/schema";
import { queueAppointmentMessage } from "../../../db/communications";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

const coatConditions = ["not_assessed", "healthy", "tangled", "matted", "severely_matted", "skin_concern"] as const;
const warningCategories = ["allergy", "medical", "behavior", "mobility", "bite_risk", "dryer_restriction", "kennel_restriction", "emergency", "other"] as const;
const warningSeverities = ["attention", "high", "critical"] as const;

async function appointmentForStaff(db: ReturnType<typeof import("../../../db").getDb>, appointmentId: string, organizationId: string, locationId: string) {
  const [appointment] = await db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId), eq(appointments.locationId, locationId))).limit(1);
  if (!appointment) throw new SalonAccessError("Appointment not found.", 404);
  return appointment;
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const appointmentId = new URL(request.url).searchParams.get("appointmentId") || "";
    const appointment = await appointmentForStaff(db, appointmentId, membership.organizationId, membership.locationId);
    const [careRows, warnings, media, approvals, approvalMessages] = await Promise.all([
      db.select().from(appointmentCareRecords).where(and(eq(appointmentCareRecords.appointmentId, appointmentId), eq(appointmentCareRecords.organizationId, membership.organizationId))).limit(1),
      db.select().from(petWarnings).where(and(eq(petWarnings.petId, appointment.petId), eq(petWarnings.organizationId, membership.organizationId), eq(petWarnings.active, true))).orderBy(asc(petWarnings.createdAt)),
      db.select().from(mediaAssets).where(and(eq(mediaAssets.appointmentId, appointmentId), eq(mediaAssets.organizationId, membership.organizationId), eq(mediaAssets.locationId, membership.locationId))).orderBy(asc(mediaAssets.createdAt)),
      db.select().from(approvalRequests).where(and(eq(approvalRequests.appointmentId, appointmentId), eq(approvalRequests.organizationId, membership.organizationId))).orderBy(asc(approvalRequests.requestedAt)),
      db.select({ id: messages.id, dedupeKey: messages.dedupeKey, channel: messages.channel, status: messages.status, provider: messages.provider, deliveryAttempts: messages.deliveryAttempts, lastError: messages.lastError, sentAt: messages.sentAt, deliveredAt: messages.deliveredAt, updatedAt: messages.updatedAt }).from(messages).where(and(eq(messages.appointmentId, appointmentId), eq(messages.organizationId, membership.organizationId), eq(messages.locationId, membership.locationId))).orderBy(asc(messages.createdAt)),
    ]);
    const deliveryByApproval = new Map(approvalMessages.filter((message) => message.dedupeKey.startsWith("approval_request:")).map((message) => [message.dedupeKey.slice("approval_request:".length), message]));
    const approvalsWithDelivery = approvals.map((approval) => {
      const delivery = deliveryByApproval.get(approval.id) || null;
      const deliverySummary = !delivery ? "Automatic delivery unavailable — Copy link and share it with the client." : delivery.status === "delivered" ? `Message delivered by ${delivery.channel.toUpperCase()}.` : delivery.status === "sent" ? `Message sent by ${delivery.channel.toUpperCase()}.` : delivery.status === "failed" || delivery.status === "action_required" || delivery.provider === "unconnected" ? `Automatic delivery unavailable — Copy link${delivery.lastError ? ` (${delivery.lastError})` : ""}.` : delivery.status === "scheduled" ? "Message delivery scheduled." : "Message delivery in progress.";
      return { ...approval, deliverySummary, status: approval.status === "pending" && ["cancelled", "no_show"].includes(appointment.status) ? "cancelled" : approval.status === "pending" && new Date(approval.expiresAt).getTime() <= Date.now() ? "expired" : approval.status, delivery };
    });
    return Response.json({ appointment, care: careRows[0] || null, warnings, media: media.map((asset) => ({ ...asset, url: `/api/media/${asset.id}` })), approvals: approvalsWithDelivery });
  } catch (error) { return salonApiError(error, "Care record unavailable"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const body = await request.json() as Record<string, unknown>;
    const appointmentId = String(body.appointmentId || "");
    await appointmentForStaff(db, appointmentId, membership.organizationId, membership.locationId);
    const coatCondition = String(body.coatCondition || "not_assessed") as typeof coatConditions[number];
    const styleNotes = String(body.styleNotes || "").trim().slice(0, 3000);
    const productsUsed = String(body.productsUsed || "").trim().slice(0, 1200);
    const internalNotes = String(body.internalNotes || "").trim().slice(0, 3000);
    const clientReport = String(body.clientReport || "").trim().slice(0, 3000);
    const reportPublished = Boolean(body.reportPublished);
    if (!coatConditions.includes(coatCondition) || (reportPublished && !clientReport)) throw new SalonAccessError("Complete the coat assessment and report before publishing.", 400);
    const now = new Date().toISOString();
    const id = `care_${appointmentId}`;
    const [record] = await db.insert(appointmentCareRecords).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, appointmentId, coatCondition, styleNotes, productsUsed, internalNotes, clientReport, reportPublished, completedByStaffId: membership.id, updatedAt: now })
      .onConflictDoUpdate({ target: appointmentCareRecords.appointmentId, set: { coatCondition, styleNotes, productsUsed, internalNotes, clientReport, reportPublished, completedByStaffId: membership.id, updatedAt: now } }).returning();
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "appointment.care_record_updated", entityType: "appointment", entityId: appointmentId, detailsJson: JSON.stringify({ coatCondition, reportPublished, updatedAt: now }) });
    if (reportPublished) await queueAppointmentMessage(db, { appointmentId, templateKey: "report_card", dedupeKey: `report_card:${appointmentId}`, variables: { report_card: clientReport } }).catch((communicationError) => console.error("Care record saved, but its report card could not be queued", communicationError));
    return Response.json({ care: record });
  } catch (error) { return salonApiError(error, "Care record could not be saved"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || ""); const appointmentId = String(body.appointmentId || "");
    const appointment = await appointmentForStaff(db, appointmentId, membership.organizationId, membership.locationId);
    if (action === "create_warning") {
      const category = String(body.category || "other") as typeof warningCategories[number]; const severity = String(body.severity || "attention") as typeof warningSeverities[number]; const title = String(body.title || "").trim(); const details = String(body.details || "").trim();
      if (!warningCategories.includes(category) || !warningSeverities.includes(severity) || title.length < 3 || title.length > 100 || !details || details.length > 1500) throw new SalonAccessError("Complete the warning category, severity, title, and guidance.", 400);
      const id = crypto.randomUUID();
      const [warning] = await db.insert(petWarnings).values({ id, organizationId: membership.organizationId, petId: appointment.petId, category, severity, title, details, authorStaffId: membership.id }).returning();
      await db.update(pets).set({ safetyLevel: severity === "attention" ? "attention" : "high", updatedAt: new Date().toISOString() }).where(and(eq(pets.id, appointment.petId), eq(pets.organizationId, membership.organizationId)));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "pet.warning_created", entityType: "pet_warning", entityId: id, detailsJson: JSON.stringify({ petId: appointment.petId, category, severity }) });
      return Response.json({ warning }, { status: 201 });
    }
    if (action === "resolve_warning") {
      const warningId = String(body.warningId || "");
      const [warning] = await db.update(petWarnings).set({ active: false, updatedAt: new Date().toISOString() }).where(and(eq(petWarnings.id, warningId), eq(petWarnings.petId, appointment.petId), eq(petWarnings.organizationId, membership.organizationId))).returning();
      if (!warning) throw new SalonAccessError("Warning not found.", 404);
      const remaining = await db.select({ severity: petWarnings.severity }).from(petWarnings).where(and(eq(petWarnings.petId, appointment.petId), eq(petWarnings.organizationId, membership.organizationId), eq(petWarnings.active, true)));
      const safetyLevel = remaining.some((item) => ["high", "critical"].includes(item.severity)) ? "high" : remaining.length ? "attention" : "standard";
      await db.update(pets).set({ safetyLevel, updatedAt: new Date().toISOString() }).where(and(eq(pets.id, appointment.petId), eq(pets.organizationId, membership.organizationId)));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "pet.warning_resolved", entityType: "pet_warning", entityId: warningId, detailsJson: JSON.stringify({ petId: appointment.petId }) });
      return Response.json({ warning });
    }
    if (action === "request_approval") {
      const title = String(body.title || "").trim(); const explanation = String(body.explanation || "").trim(); const amountCents = Number(body.amountCents);
      if (title.length < 3 || title.length > 100 || !explanation || explanation.length > 1500 || !Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000) throw new SalonAccessError("Complete the approval title, explanation, and amount.", 400);
      const [closedInvoice] = await db.select({ status: invoices.status }).from(invoices).where(and(eq(invoices.appointmentId, appointmentId), eq(invoices.organizationId, membership.organizationId))).limit(1);
      if (closedInvoice) throw new SalonAccessError("Price approval must be completed before checkout begins.", 409);
      const id = crypto.randomUUID(); const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""); const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const [approval] = await db.insert(approvalRequests).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, appointmentId, clientId: appointment.clientId, token, title, explanation, amountCents, currency: appointment.currency, expiresAt, requestedByStaffId: membership.id }).returning();
      const approvalUrl = `${process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin}/approval/${token}`;
      let deliveryError = "";
      const delivery = await queueAppointmentMessage(db, { appointmentId, templateKey: "approval_request", dedupeKey: `approval_request:${id}`, variables: { approval_title: title, approval_amount: new Intl.NumberFormat("en-CA", { style: "currency", currency: appointment.currency }).format(amountCents / 100), approval_url: approvalUrl } }).catch((communicationError) => { deliveryError = communicationError instanceof Error ? communicationError.message : "Delivery could not be queued"; console.error("Approval saved, but its message could not be queued", communicationError); return null; });
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "approval.requested", entityType: "approval_request", entityId: id, detailsJson: JSON.stringify({ appointmentId, amountCents, expiresAt }) });
      return Response.json({ approval: { ...approval, approvalUrl, delivery: delivery ? { id: delivery.id, channel: delivery.channel, status: delivery.status, provider: delivery.provider, deliveryAttempts: delivery.deliveryAttempts, lastError: delivery.lastError } : null, deliveryError } }, { status: 201 });
    }
    throw new SalonAccessError("Choose a valid care action.", 400);
  } catch (error) { return salonApiError(error, "Care action could not be completed"); }
}
