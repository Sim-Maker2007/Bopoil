import { and, eq } from "drizzle-orm";
import { requireSalonAccess, requireWorkspacePermission, salonApiError } from "../../salon-access";
import { auditEvents, pets } from "../../../db/schema";

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const payload = await request.json() as { petId?: string; safetyLevel?: string; handlingNotes?: string };
    const petId = payload.petId?.trim() ?? "";
    const safetyLevel = payload.safetyLevel?.trim() ?? "";
    const handlingNotes = payload.handlingNotes?.trim().slice(0, 1200) ?? "";
    if (!petId || !["standard", "attention", "high"].includes(safetyLevel)) {
      return Response.json({ error: "Pet and a valid safety level are required." }, { status: 400 });
    }

    const [existing] = await db.select().from(pets).where(and(eq(pets.id, petId), eq(pets.organizationId, membership.organizationId))).limit(1);
    if (!existing) return Response.json({ error: "Pet not found." }, { status: 404 });

    const changedAt = new Date().toISOString();
    const [updated] = await db.update(pets).set({
      safetyLevel: safetyLevel as typeof existing.safetyLevel,
      handlingNotes,
      updatedAt: changedAt,
    }).where(and(eq(pets.id, petId), eq(pets.organizationId, membership.organizationId))).returning();

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: membership.organizationId,
      actorType: "staff",
      actorId: membership.id,
      action: "pet.safety_updated",
      entityType: "pet",
      entityId: petId,
      detailsJson: JSON.stringify({ safetyLevel, changedAt }),
    });

    return Response.json({ pet: { id: updated.id, safetyLevel: updated.safetyLevel, handlingNotes: updated.handlingNotes, updatedAt: updated.updatedAt } });
  } catch (error) {
    return salonApiError(error, "Pet record could not be updated.");
  }
}
