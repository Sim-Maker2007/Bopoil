import { and, eq } from "drizzle-orm";
import { resolvePortalSession } from "../../../../../../db/client-portal";
import { auditEvents, pets, vaccinationRecords } from "../../../../../../db/schema";
import { portalTokenFromRequest, requestIsSameOrigin } from "../../../../../../lib/portal-request";
import { mediaStore } from "../../../../../../lib/blob-storage";

function ids(request: Request) { const path = new URL(request.url).pathname.split("/").filter(Boolean); return { token: portalTokenFromRequest(request), id: decodeURIComponent(path.at(-1) || "") }; }
async function owned(request: Request) {
  const { token, id } = ids(request); const access = await resolvePortalSession(token); if (!access.client) return { access, record: null };
  const [record] = await access.db.select({ vaccination: vaccinationRecords, petName: pets.name }).from(vaccinationRecords).innerJoin(pets, eq(vaccinationRecords.petId, pets.id)).where(and(eq(vaccinationRecords.id, id), eq(vaccinationRecords.organizationId, access.client.organizationId), eq(pets.organizationId, access.client.organizationId), eq(pets.clientId, access.client.id))).limit(1); return { access, record };
}
export async function GET(request: Request) {
  try { const { access, record } = await owned(request); if (!access.client) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 }); if (!record?.vaccination.r2Key) return Response.json({ error: "Document not found." }, { status: 404 }); const object = await mediaStore.get(record.vaccination.r2Key); if (!object) return Response.json({ error: "Document not found." }, { status: 404 }); return new Response(object.body, { headers: { "content-type": record.vaccination.mimeType, "content-length": String(record.vaccination.sizeBytes), "content-disposition": `inline; filename="${record.vaccination.originalFilename.replace(/["\r\n]/g, "")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }); }
  catch { return Response.json({ error: "Document unavailable." }, { status: 500 }); }
}
export async function DELETE(request: Request) {
  try { if (!requestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 }); const { access, record } = await owned(request); if (!access.client) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401 }); if (!record) return Response.json({ error: "Vaccination not found." }, { status: 404 }); if (record.vaccination.status === "verified") return Response.json({ error: "Verified records are locked. Contact the salon to change this record." }, { status: 409 }); await access.db.batch([access.db.delete(vaccinationRecords).where(and(eq(vaccinationRecords.id, record.vaccination.id), eq(vaccinationRecords.organizationId, access.client.organizationId))), access.db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: record.vaccination.organizationId, actorType: "client", actorId: access.client.id, action: "vaccination.deleted", entityType: "vaccination_record", entityId: record.vaccination.id })]); if (record.vaccination.r2Key) await mediaStore.delete(record.vaccination.r2Key).catch((error) => console.error("Deleted vaccination metadata, but Blob cleanup must be retried.", error)); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "Vaccination could not be removed." }, { status: 500 }); }
}
