import { and, asc, eq, isNull } from "drizzle-orm";
import { auditEvents, employeePortalInvitations, services, staff, staffAvailability, staffLocations, staffServiceSkills } from "../../../db/schema";
import { randomToken, sha256 } from "../../../lib/employee-auth";
import { deliverEmployeeInvitation } from "../../../lib/employee-invitation-delivery";
import { deliveryConfig } from "../../../lib/message-delivery";
import { safePublicOrigin } from "../../../lib/portal-links";
import { defaultPermissions, sanitizePermissions } from "../../../lib/salon-permissions";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

function explicitPermissions(value: string | null) {
  if (value == null) return null;
  try { return sanitizePermissions(JSON.parse(value)); } catch { return []; }
}

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "team");
    const [people, availability, skills, serviceRows] = await Promise.all([
      db.select({ id: staff.id, organizationId: staff.organizationId, locationId: staffLocations.locationId, email: staff.email, displayName: staff.displayName, role: staffLocations.role, permissionsJson: staffLocations.permissionsJson, active: staff.active, createdAt: staff.createdAt }).from(staffLocations).innerJoin(staff, eq(staffLocations.staffId, staff.id)).where(and(eq(staffLocations.organizationId, membership.organizationId), eq(staffLocations.locationId, membership.locationId), eq(staffLocations.active, true), eq(staff.active, true))).orderBy(asc(staff.displayName)),
      db.select().from(staffAvailability).where(and(eq(staffAvailability.organizationId, membership.organizationId), eq(staffAvailability.locationId, membership.locationId))),
      db.select().from(staffServiceSkills).where(and(eq(staffServiceSkills.organizationId, membership.organizationId), eq(staffServiceSkills.locationId, membership.locationId))),
      db.select({ id: services.id, name: services.name, active: services.active }).from(services).where(and(eq(services.organizationId, membership.organizationId), eq(services.locationId, membership.locationId))).orderBy(asc(services.name)),
    ]);
    return Response.json({ staff: people.map(({ permissionsJson, ...person }) => ({ ...person, permissions: explicitPermissions(permissionsJson) })), availability, skills, services: serviceRows, canManage: ["owner", "manager"].includes(membership.role), canCreateAdmin: membership.role === "owner" });
  } catch (error) {
    return salonApiError(error, "Team unavailable");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "team");
    requireSalonManager(membership);
    const body = await request.json() as Record<string, unknown>;
    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const requestedRole = String(body.role || (body.accountType === "admin" ? "manager" : "groomer"));
    const allowedRoles = ["manager", "receptionist", "groomer", "bather", "accountant"] as const;
    const role = allowedRoles.includes(requestedRole as typeof allowedRoles[number])
      ? requestedRole as typeof allowedRoles[number]
      : "groomer";
    const rolePermissions = new Set(defaultPermissions(role));
    const permissions = sanitizePermissions(body.permissions).filter((permission) => role === "manager" || rolePermissions.has(permission));
    if (displayName.length < 2 || displayName.length > 80) throw new SalonAccessError("Enter the team member's full name.", 400);
    if (role === "manager" && membership.role !== "owner") throw new SalonAccessError("Only the owner can add an administrator.", 403);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new SalonAccessError("Enter a valid email address.", 400);
    if (permissions.length && !email) throw new SalonAccessError("An email address is required for CRM access.", 400);
    if (email) {
      const [existing] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.organizationId, membership.organizationId), eq(staff.email, email))).limit(1);
      if (existing) throw new SalonAccessError("A team member already uses this email address.", 409);
    }
    const staffId = crypto.randomUUID();
    const now = new Date().toISOString();
    const token = randomToken();
    const tokenHash = await sha256(token);
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const publicOrigin = safePublicOrigin(process.env.DELIVERY_PUBLIC_URL) || safePublicOrigin(request.url);
    if (!publicOrigin) throw new Error("A secure public site URL is required to create an employee invitation.");
    const employeeInvitationUrl = new URL(`/employee/setup/${encodeURIComponent(token)}`, publicOrigin).toString();
    const crmUrl = email && permissions.length ? new URL("/salon", publicOrigin).toString() : null;
    await db.batch([
      db.insert(staff).values({ id: staffId, organizationId: membership.organizationId, locationId: membership.locationId, email: email || null, displayName, role }),
      db.insert(staffLocations).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, staffId, locationId: membership.locationId, role, permissionsJson: JSON.stringify(permissions) }),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "staff.created", entityType: "staff", entityId: staffId, detailsJson: JSON.stringify({ role, permissions }) }),
      db.update(employeePortalInvitations).set({ revokedAt: now }).where(and(eq(employeePortalInvitations.staffId, staffId), isNull(employeePortalInvitations.usedAt), isNull(employeePortalInvitations.revokedAt))),
      db.insert(employeePortalInvitations).values({ id: invitationId, organizationId: membership.organizationId, staffId, tokenHash, expiresAt, invitedByStaffId: membership.id }),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "employee_portal.invited", entityType: "staff", entityId: staffId, detailsJson: JSON.stringify({ expiresAt, hasEmail: Boolean(email), crmAccess: permissions.length > 0 }) }),
    ]);

    const invitationDelivery = await deliverEmployeeInvitation({
      invitationId,
      recipient: email,
      displayName,
      organizationName: membership.organizationName,
      employeeInvitationUrl,
      crmUrl,
      expiresAt,
    }, deliveryConfig());
    try {
      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        organizationId: membership.organizationId,
        actorType: "system",
        action: invitationDelivery.state === "sent" ? "employee_invitation.email_sent" : invitationDelivery.state === "failed" ? "employee_invitation.email_failed" : "employee_invitation.manual_share_required",
        entityType: "staff",
        entityId: staffId,
        detailsJson: JSON.stringify({
          state: invitationDelivery.state,
          recipient: invitationDelivery.recipient,
          reason: "reason" in invitationDelivery ? invitationDelivery.reason : undefined,
          providerMessageId: invitationDelivery.state === "sent" ? invitationDelivery.providerMessageId : undefined,
        }),
      });
    } catch (auditError) {
      console.error("Employee invitation delivery result could not be audited", auditError);
    }
    return Response.json({
      member: { id: staffId, displayName, email: email || null, role, permissions },
      employeeInvitationUrl,
      crmUrl,
      expiresAt,
      delivery: {
        state: invitationDelivery.state,
        recipient: invitationDelivery.recipient,
        reason: "reason" in invitationDelivery ? invitationDelivery.reason : null,
      },
    });
  } catch (error) {
    return salonApiError(error, "The team member could not be added");
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "team");
    requireSalonManager(membership);
    const body = await request.json() as { staffId?: string; availability?: Array<{ weekday: number; startTime: string; endTime: string; active: boolean }>; serviceIds?: string[] };
    const staffId = String(body.staffId || "");
    const [person] = await db.select({ id: staff.id }).from(staffLocations).innerJoin(staff, eq(staffLocations.staffId, staff.id)).where(and(eq(staff.id, staffId), eq(staff.organizationId, membership.organizationId), eq(staffLocations.locationId, membership.locationId), eq(staffLocations.active, true))).limit(1);
    if (!person) throw new SalonAccessError("Team member not found.", 404);
    const days = body.availability || [];
    if (days.length !== 7 || new Set(days.map((day) => day.weekday)).size !== 7 || days.some((day) => !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || !/^\d{2}:\d{2}$/.test(day.startTime) || !/^\d{2}:\d{2}$/.test(day.endTime) || (day.active && day.startTime >= day.endTime))) {
      throw new SalonAccessError("Availability must include seven valid days and end after it starts.", 400);
    }
    const allowedServices = await db.select({ id: services.id }).from(services).where(and(eq(services.organizationId, membership.organizationId), eq(services.locationId, membership.locationId)));
    const allowedIds = new Set(allowedServices.map((service) => service.id));
    const serviceIds = [...new Set(body.serviceIds || [])];
    if (serviceIds.some((id) => !allowedIds.has(id))) throw new SalonAccessError("One or more services are invalid.", 400);

    const now = new Date().toISOString();
    const availabilityWrites = [...days].sort((left, right) => left.weekday - right.weekday).map((day) =>
      db.insert(staffAvailability).values({ id: `availability_${staffId}_${membership.locationId}_${day.weekday}`, organizationId: membership.organizationId, locationId: membership.locationId, staffId, ...day, updatedAt: now })
        .onConflictDoUpdate({ target: [staffAvailability.staffId, staffAvailability.locationId, staffAvailability.weekday], set: { startTime: day.startTime, endTime: day.endTime, active: day.active, updatedAt: now } })
    );
    const removeSkills = db.delete(staffServiceSkills).where(and(
      eq(staffServiceSkills.organizationId, membership.organizationId),
      eq(staffServiceSkills.locationId, membership.locationId),
      eq(staffServiceSkills.staffId, staffId),
    ));
    const audit = db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "staff.schedule_updated", entityType: "staff", entityId: staffId, detailsJson: JSON.stringify({ locationId: membership.locationId, days, serviceIds }) });
    if (serviceIds.length) {
      await db.batch([
        availabilityWrites[0], availabilityWrites[1], availabilityWrites[2], availabilityWrites[3], availabilityWrites[4], availabilityWrites[5], availabilityWrites[6],
        removeSkills,
        db.insert(staffServiceSkills).values(serviceIds.map((serviceId) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, staffId, serviceId }))),
        audit,
      ]);
    } else {
      await db.batch([
        availabilityWrites[0], availabilityWrites[1], availabilityWrites[2], availabilityWrites[3], availabilityWrites[4], availabilityWrites[5], availabilityWrites[6],
        removeSkills,
        audit,
      ]);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return salonApiError(error, "Team schedule could not be updated");
  }
}
