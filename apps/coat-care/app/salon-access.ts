import { and, asc, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { ensurePilotData, PILOT } from "../db/pilot";
import { locations, organizations, staff, staffInvitations, staffLocations } from "../db/schema";
import { getChatGPTUser } from "./chatgpt-auth";
import { parsePermissions, type WorkspacePermission } from "../lib/salon-permissions";

export class SalonAccessError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function acceptInvitations(email: string, displayName: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const invitations = await db.select().from(staffInvitations).where(and(
    eq(staffInvitations.email, email), eq(staffInvitations.status, "pending"),
    gt(staffInvitations.expiresAt, now),
  ));
  for (const invitation of invitations) {
    const invitedStaffId = crypto.randomUUID();
    const guardedOrganizationId = sql<string>`(
      select organization_id from staff_invitations
      where id = ${invitation.id}
        and email = ${email}
        and status = 'pending'
        and expires_at > ${now}
    )`;
    const invitedPersonId = sql<string>`(
      select id from staff
      where organization_id = ${invitation.organizationId}
        and email = ${email}
        and active = 1
      limit 1
    )`;
    try {
      await db.batch([
        db.insert(staff).values({
          id: invitedStaffId, organizationId: invitation.organizationId, locationId: invitation.locationId,
          email, displayName, role: invitation.role,
        }).onConflictDoNothing(),
        db.update(staff).set({ active: true }).where(and(eq(staff.organizationId, invitation.organizationId), eq(staff.email, email))),
        db.insert(staffLocations).values({
          id: crypto.randomUUID(), organizationId: guardedOrganizationId, staffId: invitedPersonId,
          locationId: invitation.locationId, role: invitation.role,
        }).onConflictDoUpdate({
          target: [staffLocations.staffId, staffLocations.locationId],
          set: { role: invitation.role, active: true, updatedAt: now },
        }),
        db.update(staffInvitations).set({ status: "accepted", acceptedAt: now })
          .where(and(eq(staffInvitations.id, invitation.id), eq(staffInvitations.email, email), eq(staffInvitations.status, "pending"), gt(staffInvitations.expiresAt, now))),
      ]);
    } catch (error) {
      if (error instanceof Error && /constraint|null|unique/i.test(error.message)) {
        const [current] = await db.select({ status: staffInvitations.status }).from(staffInvitations).where(eq(staffInvitations.id, invitation.id)).limit(1);
        if (current?.status !== "pending") continue;
      }
      throw error;
    }
  }
}

async function ensureBootstrapOwner(email: string, displayName: string) {
  const configuredOwner = (process.env.SALON_OWNER_EMAIL || "").trim().toLowerCase();
  if (!configuredOwner || email !== configuredOwner) return;
  const db = getDb();
  let [owner] = await db.select({ id: staff.id }).from(staff).where(and(
    eq(staff.organizationId, PILOT.organizationId),
    eq(staff.email, email),
  )).limit(1);
  if (!owner) {
    await db.insert(staff).values({
      id: crypto.randomUUID(),
      organizationId: PILOT.organizationId,
      locationId: PILOT.locationId,
      email,
      displayName: displayName || "BOPOIL Owner",
      role: "owner",
    }).onConflictDoNothing();
    [owner] = await db.select({ id: staff.id }).from(staff).where(and(
      eq(staff.organizationId, PILOT.organizationId),
      eq(staff.email, email),
    )).limit(1);
  }
  if (!owner) throw new SalonAccessError("The owner profile could not be initialized.", 500);
  await db.insert(staffLocations).values({
    id: crypto.randomUUID(),
    organizationId: PILOT.organizationId,
    staffId: owner.id,
    locationId: PILOT.locationId,
    role: "owner",
  }).onConflictDoUpdate({
    target: [staffLocations.staffId, staffLocations.locationId],
    set: { role: "owner", active: true, updatedAt: new Date().toISOString() },
  });
}

export async function requireSalonAccess() {
  const user = await getChatGPTUser();
  if (!user) throw new SalonAccessError("Sign in required", 401);

  await ensurePilotData();
  const db = getDb();
  const email = user.email.toLowerCase();
  const displayName = user.fullName || user.displayName;
  await ensureBootstrapOwner(email, displayName);
  await acceptInvitations(email, displayName);

  const people = await db.select({
    id: staff.id, organizationId: staff.organizationId, locationId: staff.locationId, email: staff.email,
    displayName: staff.displayName, role: staff.role, active: staff.active, createdAt: staff.createdAt,
    organizationName: organizations.name, organizationSlug: organizations.slug,
  }).from(staff).innerJoin(organizations, eq(staff.organizationId, organizations.id))
    .where(and(eq(staff.email, email), eq(staff.active, true))).orderBy(asc(organizations.name));

  if (!people.length) throw new SalonAccessError("Create your salon to open the workspace.", 403, "onboarding_required");

  const cookieStore = await cookies();
  const selectedOrganizationId = cookieStore.get("salon_organization")?.value;
  const person = people.find((item) => item.organizationId === selectedOrganizationId) || people[0];
  let memberships = await db.select({
    id: staffLocations.id, locationId: staffLocations.locationId, role: staffLocations.role,
    permissionsJson: staffLocations.permissionsJson,
    locationName: locations.name, city: locations.city, region: locations.region, active: staffLocations.active,
  }).from(staffLocations).innerJoin(locations, eq(staffLocations.locationId, locations.id))
    .where(and(eq(staffLocations.organizationId, person.organizationId), eq(staffLocations.staffId, person.id),
      eq(staffLocations.active, true), eq(locations.active, true))).orderBy(asc(locations.name));

  if (!memberships.length) {
    await db.insert(staffLocations).values({
      id: crypto.randomUUID(), organizationId: person.organizationId, staffId: person.id,
      locationId: person.locationId, role: person.role,
    }).onConflictDoNothing();
    memberships = await db.select({
      id: staffLocations.id, locationId: staffLocations.locationId, role: staffLocations.role,
      permissionsJson: staffLocations.permissionsJson,
      locationName: locations.name, city: locations.city, region: locations.region, active: staffLocations.active,
    }).from(staffLocations).innerJoin(locations, eq(staffLocations.locationId, locations.id))
      .where(and(eq(staffLocations.organizationId, person.organizationId), eq(staffLocations.staffId, person.id),
        eq(staffLocations.active, true), eq(locations.active, true))).orderBy(asc(locations.name));
  }
  if (!memberships.length) throw new SalonAccessError("No active salon location is assigned to this account.", 403);

  const selectedLocationId = cookieStore.get("salon_location")?.value;
  const selected = memberships.find((item) => item.locationId === selectedLocationId) || memberships[0];
  const organizationsForUser = people.map((item) => ({
    organizationId: item.organizationId, organizationName: item.organizationName,
    organizationSlug: item.organizationSlug, role: item.role,
  }));
  const membership = {
    ...person, membershipId: selected.id, locationId: selected.locationId, role: selected.role,
    permissions: parsePermissions(selected.role, selected.permissionsJson),
    locations: memberships, organizations: organizationsForUser,
  };
  return { user, membership, db };
}

/** Temporary compatibility name while public pilot storefront routes remain on Coat & Care. */
export const requirePilotSalonAccess = requireSalonAccess;

export function requireWorkspacePermission(membership: { role: string; permissions?: WorkspacePermission[] }, permission: WorkspacePermission) {
  const permissions = membership.permissions || parsePermissions(membership.role);
  if (!permissions.includes(permission)) throw new SalonAccessError("Cet accès n’est pas activé pour votre compte.", 403);
}

export function requireSalonManager(membership: { role: string }) {
  if (!["owner", "manager"].includes(membership.role)) throw new SalonAccessError("Owner or manager access required", 403);
}

export function requireSalonOwner(membership: { role: string }) {
  if (membership.role !== "owner") throw new SalonAccessError("Owner access required", 403);
}

export function requireFinancialAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "finance");
  if (!["owner", "manager", "receptionist", "accountant"].includes(membership.role)) throw new SalonAccessError("Financial access is not available for this role", 403);
}

export function requireSchedulingAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "calendar");
  if (!["owner", "manager", "receptionist"].includes(membership.role)) throw new SalonAccessError("Scheduling access is not available for this role", 403);
}

export function requireBookkeepingAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "finance");
  if (!["owner", "manager", "accountant"].includes(membership.role)) throw new SalonAccessError("Bookkeeping access is not available for this role", 403);
}

export function requireInventoryAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "inventory");
  if (!["owner", "manager", "receptionist", "groomer", "bather", "accountant"].includes(membership.role)) throw new SalonAccessError("Inventory access is not available for this role", 403);
}

export function requireInventoryManagement(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "inventory");
  if (!["owner", "manager"].includes(membership.role)) throw new SalonAccessError("Owner or manager inventory access required", 403);
}

export function requireInventoryMovementAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "inventory");
  if (!["owner", "manager", "receptionist", "groomer", "bather"].includes(membership.role)) throw new SalonAccessError("Stock movement access is not available for this role", 403);
}

export function requirePayrollAccess(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "workforce");
  if (!['owner', 'manager', 'accountant'].includes(membership.role)) throw new SalonAccessError("Payroll access is not available for this role", 403);
}

export function requirePayrollManagement(membership: { role: string; permissions?: WorkspacePermission[] }) {
  requireWorkspacePermission(membership, "workforce");
  if (!['owner', 'manager'].includes(membership.role)) throw new SalonAccessError("Owner or manager payroll access required", 403);
}

export function salonApiError(error: unknown, fallback: string) {
  if (error instanceof SalonAccessError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
