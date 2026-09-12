import { and, eq } from "drizzle-orm";
import { auditEvents, clientMediaAssets, clients } from "../../../db/schema";
import { isAllowedImageBytes } from "../../../lib/media-validation";
import { mediaStore } from "../../../lib/blob-storage";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

const kinds = ["profile", "gallery"] as const;
const mimeTypes = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  let storedKey = "";
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const form = await request.formData();
    const file = form.get("file");
    const clientId = String(form.get("clientId") || "").trim();
    const kind = String(form.get("kind") || "gallery") as typeof kinds[number];
    const caption = String(form.get("caption") || "").trim().slice(0, 300);
    const clientVisible = form.get("clientVisible") !== "false";
    if (!(file instanceof File) || !kinds.includes(kind) || !mimeTypes.includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) throw new SalonAccessError("Choose a JPEG, PNG, or WebP image up to 4 MB.", 400);
    const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, membership.organizationId))).limit(1);
    if (!client) throw new SalonAccessError("Client not found.", 404);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (!isAllowedImageBytes(file.type, fileBytes)) throw new SalonAccessError("The file contents do not match a supported image format.", 400);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    const id = crypto.randomUUID();
    storedKey = `${membership.organizationId}/clients/${clientId}/${id}.${extension}`;
    await mediaStore.put(storedKey, fileBytes, { httpMetadata: { contentType: file.type } });
    const previousProfiles = kind === "profile" ? await db.select({ id: clientMediaAssets.id, r2Key: clientMediaAssets.r2Key }).from(clientMediaAssets).where(and(eq(clientMediaAssets.organizationId, membership.organizationId), eq(clientMediaAssets.clientId, clientId), eq(clientMediaAssets.kind, "profile"))) : [];
    const assetInsert = db.insert(clientMediaAssets).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, clientId, kind, r2Key: storedKey, originalFilename: file.name.slice(0, 180), mimeType: file.type, sizeBytes: file.size, caption, clientVisible, uploadedByStaffId: membership.id }).returning();
    const auditInsert = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "client.photo_uploaded", entityType: "client_media_asset", entityId: id, detailsJson: JSON.stringify({ clientId, kind, clientVisible, sizeBytes: file.size }) });
    const assetRows = kind === "profile"
      ? (await db.batch([db.delete(clientMediaAssets).where(and(eq(clientMediaAssets.organizationId, membership.organizationId), eq(clientMediaAssets.clientId, clientId), eq(clientMediaAssets.kind, "profile"))), assetInsert, auditInsert]))[1]
      : (await db.batch([assetInsert, auditInsert]))[0];
    storedKey = "";
    await Promise.all(previousProfiles.map((asset) => mediaStore.delete(asset.r2Key).catch((error) => console.error("Replaced profile photo metadata, but old Blob cleanup must be retried.", error))));
    const asset = assetRows[0];
    if (!asset) throw new Error("Photo metadata was not persisted.");
    return Response.json({ asset: { ...asset, url: `/api/client-media/${id}` } }, { status: 201 });
  } catch (error) {
    if (storedKey) await mediaStore.delete(storedKey).catch(() => undefined);
    return salonApiError(error, "Client photo could not be uploaded");
  }
}
