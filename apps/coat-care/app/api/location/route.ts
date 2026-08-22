import { auditEvents } from "../../../db/schema";
import { requireSalonAccess, salonApiError, SalonAccessError } from "../../salon-access";

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    const body = await request.json() as { locationId?: string; organizationId?: string };
    if (body.organizationId && body.organizationId !== membership.organizationId) {
      const organization = membership.organizations.find((item) => item.organizationId === body.organizationId);
      if (!organization) throw new SalonAccessError("You do not have access to that salon.", 403);
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "staff.organization_switched", entityType: "organization", entityId: organization.organizationId });
      const headers = new Headers();
      headers.append("Set-Cookie", `salon_organization=${encodeURIComponent(organization.organizationId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
      headers.append("Set-Cookie", "salon_location=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      return Response.json({ organization }, { headers });
    }
    const location = membership.locations.find((item) => item.locationId === body.locationId);
    if (!location) throw new SalonAccessError("You do not have access to that location.", 403);
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "staff.location_switched", entityType: "location", entityId: location.locationId });
    return Response.json({ location }, { headers: { "Set-Cookie": `salon_location=${encodeURIComponent(location.locationId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` } });
  } catch (error) {
    return salonApiError(error, "Location could not be changed");
  }
}
