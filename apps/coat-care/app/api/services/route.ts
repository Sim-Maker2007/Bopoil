import { and, asc, eq } from "drizzle-orm";
import { auditEvents, services } from "../../../db/schema";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

function serviceValues(body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const durationMinutes = Number(body.durationMinutes);
  const bufferMinutes = Number(body.bufferMinutes);
  const priceFromCents = Number(body.priceFromCents);
  const depositCents = Number(body.depositCents);
  const bathMinutes = Number(body.bathMinutes ?? 30);
  const dryerMinutes = Number(body.dryerMinutes ?? 30);
  const groomingTableMinutes = Number(body.groomingTableMinutes ?? Math.max(0, durationMinutes - bathMinutes - dryerMinutes));
  const kennelMinutes = Number(body.kennelMinutes ?? 0);
  if (name.length < 2 || name.length > 80) throw new SalonAccessError("Enter a service name between 2 and 80 characters.", 400);
  if (!description || description.length > 220) throw new SalonAccessError("Add a short service description.", 400);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw new SalonAccessError("Duration must be between 15 minutes and 8 hours.", 400);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) throw new SalonAccessError("Buffer must be between 0 and 120 minutes.", 400);
  if (!Number.isInteger(priceFromCents) || priceFromCents < 0 || priceFromCents > 500000) throw new SalonAccessError("Enter a valid service price.", 400);
  if (!Number.isInteger(depositCents) || depositCents < 0 || depositCents > priceFromCents) throw new SalonAccessError("Deposit cannot exceed the service price.", 400);
  const phases = [bathMinutes, dryerMinutes, groomingTableMinutes, kennelMinutes];
  if (phases.some((value) => !Number.isInteger(value) || value < 0 || value > 480) || phases.reduce((sum, value) => sum + value, 0) > durationMinutes) throw new SalonAccessError("Resource phases must be whole minutes and fit inside the service duration.", 400);
  return { name, description, durationMinutes, bufferMinutes, priceFromCents, depositCents, bathMinutes, dryerMinutes, groomingTableMinutes, kennelMinutes, active: body.active !== false };
}

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "services");
    const rows = await db.select().from(services).where(and(
      eq(services.organizationId, membership.organizationId),
      eq(services.locationId, membership.locationId),
    )).orderBy(asc(services.name));
    return Response.json({ services: rows, canManage: ["owner", "manager"].includes(membership.role) });
  } catch (error) {
    return salonApiError(error, "Services unavailable");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "services");
    requireSalonManager(membership);
    const body = await request.json() as Record<string, unknown>;
    const values = serviceValues(body);
    const id = crypto.randomUUID();
    const [created] = await db.insert(services).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, ...values }).returning();
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "service.created", entityType: "service", entityId: id, detailsJson: JSON.stringify(values) });
    return Response.json({ service: created }, { status: 201 });
  } catch (error) {
    return salonApiError(error, "Service could not be created");
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "services");
    requireSalonManager(membership);
    const body = await request.json() as Record<string, unknown>;
    const serviceId = String(body.serviceId || "");
    const values = serviceValues(body);
    const [updated] = await db.update(services).set(values).where(and(
      eq(services.id, serviceId),
      eq(services.organizationId, membership.organizationId),
      eq(services.locationId, membership.locationId),
    )).returning();
    if (!updated) throw new SalonAccessError("Service not found.", 404);
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "service.updated", entityType: "service", entityId: serviceId, detailsJson: JSON.stringify(values) });
    return Response.json({ service: updated });
  } catch (error) {
    return salonApiError(error, "Service could not be updated");
  }
}
