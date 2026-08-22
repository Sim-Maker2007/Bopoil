import { and, asc, eq } from "drizzle-orm";
import { auditEvents, communicationTemplates } from "../../../../db/schema";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "messages");
    const templates = await db.select().from(communicationTemplates).where(and(eq(communicationTemplates.organizationId, membership.organizationId), eq(communicationTemplates.locationId, membership.locationId))).orderBy(asc(communicationTemplates.name));
    return Response.json({ templates, canManage: ["owner", "manager"].includes(membership.role) });
  } catch (error) { return salonApiError(error, "Templates unavailable"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "messages"); requireSalonManager(membership);
    const body = await request.json() as { templateId?: string; name?: string; subject?: string; body?: string; channel?: "email" | "sms"; active?: boolean };
    const templateId = String(body.templateId || ""); const name = String(body.name || "").trim(); const subject = String(body.subject || "").trim(); const templateBody = String(body.body || "").trim();
    if (!name || name.length > 80 || !templateBody || templateBody.length > 5000 || !["email", "sms"].includes(String(body.channel)) || (body.channel === "email" && !subject)) throw new SalonAccessError("Complete the template name, channel, subject, and body.", 400);
    const [updated] = await db.update(communicationTemplates).set({ name, subject, body: templateBody, channel: body.channel!, active: body.active !== false, updatedAt: new Date().toISOString() }).where(and(eq(communicationTemplates.id, templateId), eq(communicationTemplates.organizationId, membership.organizationId), eq(communicationTemplates.locationId, membership.locationId))).returning();
    if (!updated) throw new SalonAccessError("Template not found.", 404);
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "communication_template.updated", entityType: "communication_template", entityId: templateId, detailsJson: JSON.stringify({ name, channel: body.channel, active: body.active !== false }) });
    return Response.json({ template: updated });
  } catch (error) { return salonApiError(error, "Template could not be updated"); }
}
