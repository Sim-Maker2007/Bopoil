import { requireSalonAccess, requireSalonManager, salonApiError } from "../../../../salon-access";
import { reconcileSquareBookings } from "../../../../../lib/square-sync";

export async function POST() {
  try {
    const { db, membership } = await requireSalonAccess();
    requireSalonManager(membership);
    return Response.json(await reconcileSquareBookings(db, new Date(), true));
  } catch (error) {
    return salonApiError(error, "Square appointments could not be synchronized.");
  }
}
