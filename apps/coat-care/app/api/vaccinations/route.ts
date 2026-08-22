import { and, eq } from "drizzle-orm";
import { auditEvents, pets, vaccinationRecords } from "../../../db/schema";
import { requireSalonAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "clients"); if (!["owner", "manager", "receptionist"].includes(membership.role)) throw new SalonAccessError("Manager or reception access required.", 403);
    const body = await request.json() as { vaccinationId?: string; status?: string }; const status = String(body.status || ""); if (!["verified", "rejected"].includes(status)) throw new SalonAccessError("Choose verified or rejected.", 400);
    const [record] = await db.select({ id: vaccinationRecords.id, petId: vaccinationRecords.petId }).from(vaccinationRecords).innerJoin(pets, eq(vaccinationRecords.petId, pets.id)).where(and(eq(vaccinationRecords.id, String(body.vaccinationId || "")), eq(vaccinationRecords.organizationId, membership.organizationId), eq(pets.organizationId, membership.organizationId))).limit(1); if (!record) throw new SalonAccessError("Vaccination record not found.", 404);
    const [updated] = await db.update(vaccinationRecords).set({ status: status as "verified" | "rejected", verifiedByStaffId: membership.id, verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(vaccinationRecords.id, record.id)).returning();
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: `vaccination.${status}`, entityType: "vaccination_record", entityId: record.id, detailsJson: JSON.stringify({ petId: record.petId }) }); return Response.json({ vaccination: updated });
  } catch (error) { return salonApiError(error, "Vaccination could not be reviewed"); }
}
