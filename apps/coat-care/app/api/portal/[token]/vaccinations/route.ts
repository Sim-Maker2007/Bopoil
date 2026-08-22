import { and, eq } from "drizzle-orm";
import { resolvePortalSession } from "../../../../../db/client-portal";
import { auditEvents, pets, vaccinationRecords } from "../../../../../db/schema";
import { isAllowedVaccineDocument } from "../../../../../lib/media-validation";
import { portalTokenFromRequest, requestIsSameOrigin } from "../../../../../lib/portal-request";
import { isValidDateKey } from "../../../../../lib/time-zone";
import { mediaStore } from "../../../../../lib/blob-storage";

function date(value: FormDataEntryValue | null, optional = false) { const text = String(value || ""); return ((optional && !text) || isValidDateKey(text)) ? text : null; }

export async function POST(request: Request) {
  let storedKey = "";
  try {
    if (!requestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
    const access = await resolvePortalSession(portalTokenFromRequest(request)); if (!access.client) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 });
    const form = await request.formData(); const petId = String(form.get("petId") || ""); const vaccineName = String(form.get("vaccineName") || "").trim().slice(0, 80); const administeredOn = date(form.get("administeredOn"), true); const expiresOn = date(form.get("expiresOn")); const veterinarian = String(form.get("veterinarian") || "").trim().slice(0, 120); const file = form.get("file");
    const [pet] = await access.db.select({ id: pets.id }).from(pets).where(and(eq(pets.id, petId), eq(pets.clientId, access.client.id), eq(pets.organizationId, access.client.organizationId))).limit(1);
    if (!pet || vaccineName.length < 2 || administeredOn === null || expiresOn === null || (administeredOn && administeredOn > expiresOn)) return Response.json({ error: "Complete the pet and vaccine, with a valid-until date after administration." }, { status: 400 });
    let fileValues = {};
    if (file instanceof File && file.size > 0) {
      if (file.size > 4 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return Response.json({ error: "Upload a PDF, JPEG, PNG, or WebP up to 4 MB." }, { status: 400 });
      const bytes = new Uint8Array(await file.arrayBuffer()); if (!isAllowedVaccineDocument(file.type, bytes)) return Response.json({ error: "The document contents do not match its file type." }, { status: 400 });
      const extension = ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type]; storedKey = `${access.client.organizationId}/client-vaccinations/${access.client.id}/${petId}/${crypto.randomUUID()}.${extension}`;
      await mediaStore.put(storedKey, bytes, { httpMetadata: { contentType: file.type } }); fileValues = { r2Key: storedKey, originalFilename: file.name.slice(0, 180), mimeType: file.type, sizeBytes: file.size };
    }
    const id = crypto.randomUUID(); await access.db.batch([
      access.db.insert(vaccinationRecords).values({ id, organizationId: access.client.organizationId, petId, vaccineName, administeredOn, expiresOn, veterinarian, ...fileValues }),
      access.db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: access.client.organizationId, actorType: "client", actorId: access.client.id, action: "vaccination.submitted", entityType: "vaccination_record", entityId: id, detailsJson: JSON.stringify({ petId, hasDocument: Boolean(storedKey) }) }),
    ]);
    storedKey = "";
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) { if (storedKey) await mediaStore.delete(storedKey).catch(() => undefined); return Response.json({ error: error instanceof Error ? error.message : "Vaccination could not be saved." }, { status: 500 }); }
}
