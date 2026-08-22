import { and, eq } from "drizzle-orm";
import { appointments, auditEvents, mediaAssets } from "../../../db/schema";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { isAllowedImageBytes } from "../../../lib/media-validation";
import { mediaStore } from "../../../lib/blob-storage";

const kinds = ["before", "after", "coat_issue", "incident"] as const;
const mimeTypes = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  let storedKey = "";
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const form = await request.formData(); const file = form.get("file"); const appointmentId = String(form.get("appointmentId") || ""); const kind = String(form.get("kind") || "before") as typeof kinds[number]; const caption = String(form.get("caption") || "").trim().slice(0, 300);
    if (!(file instanceof File) || !kinds.includes(kind) || !mimeTypes.includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) throw new SalonAccessError("Choose a JPEG, PNG, or WebP image up to 4 MB.", 400);
    const [appointment] = await db.select({ id: appointments.id, petId: appointments.petId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, membership.organizationId), eq(appointments.locationId, membership.locationId))).limit(1);
    if (!appointment) throw new SalonAccessError("Appointment not found.", 404);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (!isAllowedImageBytes(file.type, fileBytes)) throw new SalonAccessError("The file contents do not match a supported image format.", 400);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type]; const id = crypto.randomUUID(); storedKey = `${membership.organizationId}/${membership.locationId}/${appointmentId}/${id}.${extension}`;
    await mediaStore.put(storedKey, fileBytes, { httpMetadata: { contentType: file.type } });
    const [assetRows] = await db.batch([
      db.insert(mediaAssets).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, appointmentId, petId: appointment.petId, kind, r2Key: storedKey, originalFilename: file.name.slice(0, 180), mimeType: file.type, sizeBytes: file.size, caption, uploadedByStaffId: membership.id }).returning(),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "appointment.photo_uploaded", entityType: "media_asset", entityId: id, detailsJson: JSON.stringify({ appointmentId, petId: appointment.petId, kind, sizeBytes: file.size }) }),
    ]);
    storedKey = "";
    const asset = assetRows[0];
    if (!asset) throw new Error("Photo metadata was not persisted.");
    return Response.json({ asset: { ...asset, url: `/api/media/${id}` } }, { status: 201 });
  } catch (error) {
    if (storedKey) await mediaStore.delete(storedKey).catch(() => undefined);
    return salonApiError(error, "Photo could not be uploaded");
  }
}
