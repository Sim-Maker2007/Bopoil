import { and, asc, eq, inArray } from "drizzle-orm";
import { messages } from "../../../../db/schema";
import { dispatchMessage, publicDeliveryConfig } from "../../../../lib/message-delivery";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "messages"); const body = await request.json() as { action?: string; messageId?: string };
    const action = String(body.action || "sync"); let ids: string[];
    if (action === "message") {
      const messageId = String(body.messageId || ""); const [owned] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.id, messageId), eq(messages.organizationId, membership.organizationId), eq(messages.locationId, membership.locationId))).limit(1);
      if (!owned) throw new SalonAccessError("Message not found.", 404); ids = [owned.id];
    } else if (action === "sync") {
      const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.organizationId, membership.organizationId), eq(messages.locationId, membership.locationId), inArray(messages.status, ["action_required", "scheduled", "processing", "failed"]))).orderBy(asc(messages.scheduledFor)).limit(30); ids = rows.map((item) => item.id);
    } else throw new SalonAccessError("Choose a valid delivery action.", 400);
    const results = await Promise.all(ids.map((id) => dispatchMessage(db, id))); const counts: Record<string, number> = {};
    for (const result of results) counts[result.state] = (counts[result.state] || 0) + 1;
    return Response.json({ attempted: ids.length, counts, provider: publicDeliveryConfig() });
  } catch (error) { return salonApiError(error, "Delivery could not be started"); }
}
