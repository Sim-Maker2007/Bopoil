import { and, eq } from "drizzle-orm";
import { auditEvents, expenseReceipts, expenses } from "../../../../db/schema";
import { requireBookkeepingAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../salon-access";
import { isAllowedVaccineDocument } from "../../../../lib/media-validation";
import { mediaStore } from "../../../../lib/blob-storage";

const mimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(request: Request) {
  let storedKey = "";
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const form = await request.formData(), file = form.get("file"), expenseId = String(form.get("expenseId") || "");
    if (!(file instanceof File) || !mimeTypes.includes(file.type) || file.size < 1 || file.size > 4 * 1024 * 1024) throw new SalonAccessError("Choose a PDF, JPEG, PNG, or WebP receipt up to 4 MB.", 400);
    const [expense] = await db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.organizationId, membership.organizationId), eq(expenses.locationId, membership.locationId), eq(expenses.status, "posted"))).limit(1);
    if (!expense) throw new SalonAccessError("Posted expense not found.", 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isAllowedVaccineDocument(file.type, bytes)) throw new SalonAccessError("The receipt contents do not match a supported file format.", 400);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" } as Record<string, string>)[file.type], id = crypto.randomUUID();
    storedKey = `${membership.organizationId}/${membership.locationId}/accounting/${expense.id}/${id}.${extension}`;
    await mediaStore.put(storedKey, bytes, { httpMetadata: { contentType: file.type } });
    const [receiptRows] = await db.batch([
      db.insert(expenseReceipts).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, expenseId: expense.id, r2Key: storedKey, originalFilename: file.name.slice(0, 180), mimeType: file.type, sizeBytes: file.size, uploadedByStaffId: membership.id }).returning(),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "expense.receipt_uploaded", entityType: "expense_receipt", entityId: id, detailsJson: JSON.stringify({ expenseId: expense.id, sizeBytes: file.size, mimeType: file.type }) }),
    ]);
    storedKey = "";
    const receipt = receiptRows[0];
    if (!receipt) throw new Error("Receipt metadata was not persisted.");
    return Response.json({ receipt: { ...receipt, url: `/api/accounting/receipts/${receipt.id}` } }, { status: 201 });
  } catch (error) {
    if (storedKey) await mediaStore.delete(storedKey).catch(() => undefined);
    return salonApiError(error, "Receipt could not be uploaded");
  }
}
