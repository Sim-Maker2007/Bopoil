import { and, eq } from "drizzle-orm";
import { auditEvents, mediaAssets } from "../../../../db/schema";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";
import { mediaStore } from "../../../../lib/blob-storage";

function idFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "clients"); const id = idFrom(request);
    const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, membership.organizationId), eq(mediaAssets.locationId, membership.locationId))).limit(1);
    if (!asset) throw new SalonAccessError("Photo not found.", 404);
    const object = await mediaStore.get(asset.r2Key); if (!object) throw new SalonAccessError("Photo file not found.", 404);
    return new Response(object.body, { headers: { "content-type": asset.mimeType, "content-length": String(asset.sizeBytes), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Photo unavailable"); }
}

export async function DELETE(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "clients"); const id = idFrom(request);
    const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, membership.organizationId), eq(mediaAssets.locationId, membership.locationId))).limit(1);
    if (!asset) throw new SalonAccessError("Photo not found.", 404);
    await db.batch([
      db.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.organizationId, membership.organizationId), eq(mediaAssets.locationId, membership.locationId))),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "appointment.photo_deleted", entityType: "media_asset", entityId: id, detailsJson: JSON.stringify({ appointmentId: asset.appointmentId, kind: asset.kind }) }),
    ]);
    await mediaStore.delete(asset.r2Key).catch((error) => console.error("Deleted photo metadata, but Blob cleanup must be retried.", error));
    return Response.json({ ok: true });
  } catch (error) { return salonApiError(error, "Photo could not be deleted"); }
}
