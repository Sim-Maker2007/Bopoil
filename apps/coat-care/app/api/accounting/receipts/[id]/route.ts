import { and, eq, inArray } from "drizzle-orm";
import { auditEvents, expenseReceipts } from "../../../../../db/schema";
import { requireBookkeepingAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../../salon-access";
import { mediaStore } from "../../../../../lib/blob-storage";

function idFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership); const id = idFrom(request);
    const [receipt] = await db.select().from(expenseReceipts).where(and(eq(expenseReceipts.id, id), eq(expenseReceipts.organizationId, membership.organizationId), inArray(expenseReceipts.locationId, membership.locations.map((item) => item.locationId)))).limit(1);
    if (!receipt) throw new SalonAccessError("Receipt not found.", 404);
    const object = await mediaStore.get(receipt.r2Key); if (!object) throw new SalonAccessError("Receipt file not found.", 404);
    return new Response(object.body, { headers: { "content-type": receipt.mimeType, "content-length": String(receipt.sizeBytes), "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.originalFilename)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Receipt unavailable"); }
}

export async function DELETE(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership); const id = idFrom(request);
    const [receipt] = await db.select().from(expenseReceipts).where(and(eq(expenseReceipts.id, id), eq(expenseReceipts.organizationId, membership.organizationId), eq(expenseReceipts.locationId, membership.locationId))).limit(1);
    if (!receipt) throw new SalonAccessError("Receipt not found.", 404);
    await db.batch([
      db.insert(auditEvents).values({ id: `expense-receipt-delete:${id}`, organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "expense.receipt_deleted", entityType: "expense_receipt", entityId: id, detailsJson: JSON.stringify({ expenseId: receipt.expenseId, originalFilename: receipt.originalFilename }) }),
      db.delete(expenseReceipts).where(and(eq(expenseReceipts.id, id), eq(expenseReceipts.organizationId, membership.organizationId), eq(expenseReceipts.locationId, membership.locationId))),
    ]);
    // Once the database no longer advertises the receipt, a Blob failure can only
    // leave an unreachable orphan; it cannot leave live metadata with no file.
    await mediaStore.delete(receipt.r2Key).catch((error) => console.error("Receipt metadata was deleted, but Blob cleanup must be retried", error));
    return Response.json({ ok: true });
  } catch (error) { return salonApiError(error, "Receipt could not be deleted"); }
}
