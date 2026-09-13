import { and, eq } from "drizzle-orm";
import { auditEvents, clientMediaAssets } from "../../../../db/schema";
import { mediaStore } from "../../../../lib/blob-storage";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

function idFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "clients");
    const [asset] = await db.select().from(clientMediaAssets).where(and(eq(clientMediaAssets.id, idFrom(request)), eq(clientMediaAssets.organizationId, membership.organizationId))).limit(1);
    if (!asset) throw new SalonAccessError("Photo not found.", 404);
    const object = await mediaStore.get(asset.r2Key); if (!object) throw new SalonAccessError("Photo file not found.", 404);
    return new Response(object.body, { headers: { "content-type": asset.mimeType, "content-length": String(asset.sizeBytes), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Photo unavailable"); }
}

export async function DELETE(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "clients");
    const id = idFrom(request);
    const [asset] = await db.select().from(clientMediaAssets).where(and(eq(clientMediaAssets.id, id), eq(clientMediaAssets.organizationId, membership.organizationId))).limit(1);
    if (!asset) throw new SalonAccessError("Photo not found.", 404);
    await db.batch([
      db.delete(clientMediaAssets).where(and(eq(clientMediaAssets.id, id), eq(clientMediaAssets.organizationId, membership.organizationId))),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "client.photo_deleted", entityType: "client_media_asset", entityId: id, detailsJson: JSON.stringify({ clientId: asset.clientId, kind: asset.kind }) }),
    ]);
    await mediaStore.delete(asset.r2Key).catch((error) => console.error("Deleted client photo metadata, but Blob cleanup must be retried.", error));
    return Response.json({ ok: true });
  } catch (error) { return salonApiError(error, "Client photo could not be deleted"); }
}
