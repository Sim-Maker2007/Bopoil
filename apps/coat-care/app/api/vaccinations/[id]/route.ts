import { and, eq } from "drizzle-orm";
import { pets, vaccinationRecords } from "../../../../db/schema";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";
import { mediaStore } from "../../../../lib/blob-storage";

function idFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const [record] = await db.select({ vaccination: vaccinationRecords }).from(vaccinationRecords).innerJoin(pets, eq(vaccinationRecords.petId, pets.id)).where(and(eq(vaccinationRecords.id, idFrom(request)), eq(vaccinationRecords.organizationId, membership.organizationId), eq(pets.organizationId, membership.organizationId))).limit(1);
    if (!record?.vaccination.r2Key) throw new SalonAccessError("Vaccination document not found.", 404);
    const object = await mediaStore.get(record.vaccination.r2Key);
    if (!object) throw new SalonAccessError("Vaccination document not found.", 404);
    return new Response(object.body, { headers: { "content-type": record.vaccination.mimeType, "content-length": String(record.vaccination.sizeBytes), "content-disposition": `inline; filename="${record.vaccination.originalFilename.replace(/["\r\n]/g, "")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Vaccination document unavailable"); }
}
