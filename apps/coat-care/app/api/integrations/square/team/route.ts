import { and, asc, eq, sql } from "drizzle-orm";
import { squarePayments, squareTeamMembers, staff } from "../../../../../db/schema";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError } from "../../../../salon-access";

// Square's team roster next to the Coat & Care one: who is active in Square,
// which teammate each member is linked to, and what each has rung up.

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "settings");
    requireSalonManager(membership);
    const [members, sales] = await Promise.all([
      db.select({
        id: squareTeamMembers.id, staffId: squareTeamMembers.staffId, givenName: squareTeamMembers.givenName, familyName: squareTeamMembers.familyName, emailAddress: squareTeamMembers.emailAddress, phoneNumber: squareTeamMembers.phoneNumber, referenceId: squareTeamMembers.referenceId,
        status: squareTeamMembers.status, isOwner: squareTeamMembers.isOwner, assignedLocationsJson: squareTeamMembers.assignedLocationsJson, squareCreatedAt: squareTeamMembers.squareCreatedAt, squareUpdatedAt: squareTeamMembers.squareUpdatedAt, syncedAt: squareTeamMembers.syncedAt,
        staffName: staff.displayName, staffRole: staff.role, staffActive: staff.active,
      }).from(squareTeamMembers).leftJoin(staff, eq(squareTeamMembers.staffId, staff.id)).where(eq(squareTeamMembers.organizationId, membership.organizationId)).orderBy(asc(squareTeamMembers.status), asc(squareTeamMembers.givenName)),
      db.select({ teamMemberId: squarePayments.teamMemberId, payments: sql<number>`count(*)`.mapWith(Number), grossCents: sql<number>`coalesce(sum(${squarePayments.totalCents}), 0)`.mapWith(Number) })
        .from(squarePayments).where(and(eq(squarePayments.organizationId, membership.organizationId), eq(squarePayments.status, "COMPLETED"))).groupBy(squarePayments.teamMemberId),
    ]);
    const salesById = new Map(sales.map((row) => [row.teamMemberId, row]));
    return Response.json({
      members: members.map((member) => ({ ...member, displayName: [member.givenName, member.familyName].filter(Boolean).join(" ") || member.emailAddress || member.id, assignedLocations: (() => { try { return JSON.parse(member.assignedLocationsJson) as { assignment_type?: string; location_ids?: string[] }; } catch { return {}; } })(), sales: salesById.get(member.id) || { payments: 0, grossCents: 0 } })),
      canManage: true,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square team unavailable.");
  }
}
