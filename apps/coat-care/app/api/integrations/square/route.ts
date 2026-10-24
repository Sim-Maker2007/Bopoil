import { squareConfig } from "../../../../lib/square";
import { isSquareResource, runSquareDataSync, type SquareResource, type SyncResult } from "../../../../lib/square-data-sync";
import { squareStatusPayload } from "../../../../lib/square-status";
import { reconcileSquareBookings } from "../../../../lib/square-sync";
import { requireSalonAccess, requireSalonManager, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

// The Square integration panel: what is configured, what each resource last
// did, how much data the mirror holds, the latest webhook deliveries, and a way
// to run a synchronization now. Owners and managers see and drive it.

export const maxDuration = 60;

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "settings");
    requireSalonManager(membership);
    return Response.json(await squareStatusPayload(db, membership), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square integration status unavailable.");
  }
}

// Runs a synchronization now. "all" reads the appointments first, then every
// mirrored resource; a single resource runs alone. "full" re-reads a resource
// from the start (the customer directory, two years of sales).
export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "settings");
    requireSalonManager(membership);
    if (!squareConfig().syncConfigured) throw new SalonAccessError("Add SQUARE_ACCESS_TOKEN to the environment before synchronizing.", 409);
    const body = await request.json().catch(() => ({})) as { resource?: unknown; full?: unknown };
    const resource = typeof body.resource === "string" ? body.resource : "all";
    const full = body.full === true;
    const now = new Date();
    const deadline = Date.now() + 48_000;
    const results: Array<SyncResult | { resource: "bookings"; synced: number; unchanged?: number; error?: string }> = [];
    if (resource === "all" || resource === "bookings") {
      try {
        const bookings = await reconcileSquareBookings(db, now, true, { deadline: resource === "bookings" ? deadline : Date.now() + 20_000 });
        results.push({ resource: "bookings", synced: "synced" in bookings ? bookings.synced : 0, unchanged: "unchanged" in bookings ? bookings.unchanged : 0 });
      } catch (error) {
        results.push({ resource: "bookings", synced: 0, error: (error instanceof Error ? error.message : "Square reconciliation failed").slice(0, 300) });
      }
    }
    if (resource === "all" || isSquareResource(resource)) {
      const resources: SquareResource[] | undefined = isSquareResource(resource) ? [resource] : undefined;
      const outcome = await runSquareDataSync(db, { now, force: true, full, deadline, resources });
      if (outcome.configured) results.push(...outcome.results);
    } else if (resource !== "all" && resource !== "bookings") {
      throw new SalonAccessError("Choose a Square resource to synchronize.", 400);
    }
    return Response.json({ results, status: await squareStatusPayload(db, membership) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Square synchronization could not be started.");
  }
}
