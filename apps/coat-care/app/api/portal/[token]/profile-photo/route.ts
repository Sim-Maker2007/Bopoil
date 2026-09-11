import { and, eq } from "drizzle-orm";
import { auditEvents, clientMediaAssets } from "../../../../../db/schema";
import { resolvePortalSession } from "../../../../../db/client-portal";
import { isAllowedImageBytes } from "../../../../../lib/media-validation";
import { mediaStore } from "../../../../../lib/blob-storage";
import { portalTokenFromRequest, requestIsSameOrigin } from "../../../../../lib/portal-request";

const mimeTypes = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  let storedKey = "";
  try {
    if (!requestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
    const access = await resolvePortalSession(portalTokenFromRequest(request));
    if (!access.client || !access.session) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 });
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !mimeTypes.includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) return Response.json({ error: "Choose a JPEG, PNG, or WebP image up to 4 MB." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isAllowedImageBytes(file.type, bytes)) return Response.json({ error: "The file contents do not match a supported image format." }, { status: 400 });
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    const id = crypto.randomUUID(); storedKey = `${access.client.organizationId}/clients/${access.client.id}/${id}.${extension}`;
    await mediaStore.put(storedKey, bytes, { httpMetadata: { contentType: file.type } });
    const previous = await access.db.select({ r2Key: clientMediaAssets.r2Key }).from(clientMediaAssets).where(and(eq(clientMediaAssets.organizationId, access.client.organizationId), eq(clientMediaAssets.clientId, access.client.id), eq(clientMediaAssets.kind, "profile")));
    await access.db.batch([
      access.db.delete(clientMediaAssets).where(and(eq(clientMediaAssets.organizationId, access.client.organizationId), eq(clientMediaAssets.clientId, access.client.id), eq(clientMediaAssets.kind, "profile"))),
      access.db.insert(clientMediaAssets).values({ id, organizationId: access.client.organizationId, clientId: access.client.id, kind: "profile", r2Key: storedKey, originalFilename: file.name.slice(0, 180), mimeType: file.type, sizeBytes: file.size, clientVisible: true, uploadedByClient: true }),
      access.db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: access.client.organizationId, actorType: "client", actorId: access.client.id, action: "client.profile_photo_updated", entityType: "client_media_asset", entityId: id }),
    ]);
    storedKey = "";
    await Promise.all(previous.map((asset) => mediaStore.delete(asset.r2Key).catch((error) => console.error("Replaced profile photo metadata, but old Blob cleanup must be retried.", error))));
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    if (storedKey) await mediaStore.delete(storedKey).catch(() => undefined);
    console.error("Client profile photo upload failed", error);
    return Response.json({ error: "Profile photo could not be uploaded." }, { status: 500 });
  }
}
