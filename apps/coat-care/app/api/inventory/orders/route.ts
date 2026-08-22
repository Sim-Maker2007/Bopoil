import { and, eq, inArray, sql } from "drizzle-orm";
import { auditEvents, inventoryItems, inventoryMovementClaims, inventoryMovements, locations, purchaseOrderClaims, purchaseOrderLines, purchaseOrders, suppliers } from "../../../../db/schema";
import { requireInventoryManagement, requireSalonAccess, salonApiError, SalonAccessError } from "../../../salon-access";
import { dateKeyInZone } from "../../../../lib/time-zone";
import { movementCost } from "../../../../lib/inventory";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function textValue(value: unknown, max: number) { return String(value || "").trim().slice(0, max); }
function money(value: unknown) { const number = Number(value || 0); return Number.isInteger(number) && number >= 0 && number <= 100_000_000 ? number : null; }

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireInventoryManagement(membership);
    const body = await request.json() as { supplierId?: string; expectedOn?: string; shippingCents?: number; taxCents?: number; notes?: string; idempotencyKey?: string; lines?: Array<{ inventoryItemId?: string; quantity?: number; unitCostCents?: number; lotNumber?: string; expiresOn?: string }> };
    const supplierId = textValue(body.supplierId, 100), expectedOn = textValue(body.expectedOn, 10) || null, shippingCents = money(body.shippingCents), taxCents = money(body.taxCents), notes = textValue(body.notes, 1000), idempotencyKey = textValue(body.idempotencyKey, 120), lines = Array.isArray(body.lines) ? body.lines.slice(0, 100) : [];
    if (!supplierId || !idempotencyKey || shippingCents === null || taxCents === null || (expectedOn && !validDate(expectedOn)) || !lines.length) throw new SalonAccessError("Choose a supplier and add valid order lines.", 400);
    const normalized = lines.map((line) => ({ inventoryItemId: textValue(line.inventoryItemId, 100), quantityMilli: Math.round(Number(line.quantity) * 1000), unitCostCents: money(line.unitCostCents), lotNumber: textValue(line.lotNumber, 100), expiresOn: textValue(line.expiresOn, 10) || null }));
    if (normalized.some((line) => !line.inventoryItemId || !Number.isInteger(line.quantityMilli) || line.quantityMilli < 1 || line.quantityMilli > 1_000_000_000 || line.unitCostCents === null || line.unitCostCents < 1 || (line.expiresOn && !validDate(line.expiresOn))) || new Set(normalized.map((line) => line.inventoryItemId)).size !== normalized.length) throw new SalonAccessError("Every order line needs one unique item, a quantity, and a unit cost.", 400);
    const [[supplier], itemRows, [location], [existing]] = await Promise.all([
      db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, membership.organizationId), eq(suppliers.locationId, membership.locationId), eq(suppliers.active, true))).limit(1),
      db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId), eq(inventoryItems.active, true), inArray(inventoryItems.id, normalized.map((line) => line.inventoryItemId)))),
      db.select({ currency: locations.currency, timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1),
      db.select().from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.idempotencyKey, idempotencyKey))).limit(1),
    ]);
    if (existing) return Response.json({ order: existing }, { status: 200 });
    if (!supplier || !location || itemRows.length !== normalized.length) throw new SalonAccessError("Supplier or inventory item not found in this location.", 404);
    if (expectedOn && expectedOn < dateKeyInZone(new Date(), location.timezone)) throw new SalonAccessError("Expected delivery cannot be in the past.", 400);
    const id = crypto.randomUUID(), orderNumber = `PO-${new Date().toISOString().slice(2, 7).replace("-", "")}-${id.slice(0, 6).toUpperCase()}`;
    const [created] = await db.batch([
      db.insert(purchaseOrders).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, supplierId, orderNumber, expectedOn, shippingCents, taxCents, currency: location.currency, notes, idempotencyKey, createdByStaffId: membership.id, updatedByStaffId: membership.id }).returning(),
      db.insert(purchaseOrderLines).values(normalized.map((line) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, purchaseOrderId: id, inventoryItemId: line.inventoryItemId, quantityMilli: line.quantityMilli, unitCostCents: line.unitCostCents!, lotNumber: line.lotNumber, expiresOn: line.expiresOn }))),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.purchase_order_created", entityType: "purchase_order", entityId: id, detailsJson: JSON.stringify({ supplierId, orderNumber, lineCount: normalized.length, expectedOn }) }),
    ]);
    return Response.json({ order: created[0] }, { status: 201 });
  } catch (error) { return salonApiError(error, "Purchase order could not be created"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireInventoryManagement(membership);
    const body = await request.json() as { orderId?: string; action?: string; reason?: string }, orderId = textValue(body.orderId, 100), action = String(body.action || ""), reason = textValue(body.reason, 500), now = new Date().toISOString();
    const [order] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId))).limit(1);
    if (!order) throw new SalonAccessError("Purchase order not found.", 404);
    if (action === "place_order") {
      if (order.status !== "draft") throw new SalonAccessError("Only a draft order can be placed.", 409);
      const [, updated] = await db.batch([
        db.insert(purchaseOrderClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, purchaseOrderId: order.id, expectedUpdatedAt: order.updatedAt, action, actorStaffId: membership.id }),
        db.update(purchaseOrders).set({ status: "ordered", orderedOn: now.slice(0, 10), updatedByStaffId: membership.id, updatedAt: now }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId), eq(purchaseOrders.status, "draft"), eq(purchaseOrders.updatedAt, order.updatedAt))).returning(),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.purchase_order_placed", entityType: "purchase_order", entityId: order.id, detailsJson: JSON.stringify({ orderNumber: order.orderNumber }) }),
      ]);
      if (!updated[0]) throw new SalonAccessError("The order changed in another session. Refresh and try again.", 409);
      return Response.json({ order: updated[0] });
    }
    if (action === "cancel") {
      if (reason.length < 3) throw new SalonAccessError("Explain why the order is being cancelled.", 400);
      if (!["draft", "ordered"].includes(order.status)) throw new SalonAccessError("This order can no longer be cancelled.", 409);
      const [, updated] = await db.batch([
        db.insert(purchaseOrderClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, purchaseOrderId: order.id, expectedUpdatedAt: order.updatedAt, action, actorStaffId: membership.id }),
        db.update(purchaseOrders).set({ status: "cancelled", notes: `${order.notes}${order.notes ? "\n" : ""}Cancelled: ${reason}`, updatedByStaffId: membership.id, updatedAt: now }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId), inArray(purchaseOrders.status, ["draft", "ordered"]), eq(purchaseOrders.updatedAt, order.updatedAt))).returning(),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.purchase_order_cancelled", entityType: "purchase_order", entityId: order.id, detailsJson: JSON.stringify({ reason }) }),
      ]);
      if (!updated[0]) throw new SalonAccessError("The order changed in another session. Refresh and try again.", 409);
      return Response.json({ order: updated[0] });
    }
    if (action === "receive") {
      if (order.status !== "ordered") throw new SalonAccessError("Only an ordered purchase order can be received.", 409);
      const lines = await db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.purchaseOrderId, order.id), eq(purchaseOrderLines.organizationId, membership.organizationId), eq(purchaseOrderLines.locationId, membership.locationId)));
      if (!lines.length) throw new SalonAccessError("This order has no lines to receive.", 409);
      const itemRows = await db.select({ id: inventoryItems.id, stockVersion: inventoryItems.stockVersion }).from(inventoryItems).where(and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId), eq(inventoryItems.active, true), inArray(inventoryItems.id, lines.map((line) => line.inventoryItemId))));
      if (itemRows.length !== lines.length) throw new SalonAccessError("An order item is no longer active at this location.", 409);
      const movements = lines.map((line) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, inventoryItemId: line.inventoryItemId, supplierId: order.supplierId, purchaseOrderId: order.id, kind: "purchase" as const, quantityDeltaMilli: line.quantityMilli, unitCostCents: line.unitCostCents, totalCostCents: movementCost(line.quantityMilli, line.unitCostCents), lotNumber: line.lotNumber, expiresOn: line.expiresOn, note: `Received ${order.orderNumber}`, occurredAt: now, idempotencyKey: `purchase-order:${order.id}:${line.id}:received`, enteredByStaffId: membership.id }));
      const costCases = sql.join(lines.map((line) => sql`when ${line.inventoryItemId} then ${line.unitCostCents}`), sql.raw(" "));
      try {
        const [, , , updated] = await db.batch([
          db.insert(purchaseOrderClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, purchaseOrderId: order.id, expectedUpdatedAt: order.updatedAt, action, actorStaffId: membership.id }),
          db.insert(inventoryMovementClaims).values(itemRows.map((item) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, inventoryItemId: item.id, expectedStockVersion: item.stockVersion, movementGroupId: order.id }))),
          db.update(inventoryItems).set({ stockVersion: sql`${inventoryItems.stockVersion} + 1`, lastPurchaseUnitCostCents: sql`case ${inventoryItems.id} ${costCases} else ${inventoryItems.lastPurchaseUnitCostCents} end`, updatedAt: now }).where(and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId), inArray(inventoryItems.id, lines.map((line) => line.inventoryItemId)))),
          db.update(purchaseOrders).set({ status: "received", receivedAt: now, updatedByStaffId: membership.id, updatedAt: now }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId), eq(purchaseOrders.status, "ordered"), eq(purchaseOrders.updatedAt, order.updatedAt))).returning(),
          db.insert(inventoryMovements).values(movements),
          db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.purchase_order_received", entityType: "purchase_order", entityId: order.id, detailsJson: JSON.stringify({ orderNumber: order.orderNumber, lineCount: lines.length, inventoryCostCents: movements.reduce((sum, movement) => sum + movement.totalCostCents, 0) }) }),
        ]);
        if (!updated[0]) throw new SalonAccessError("The order changed in another session. Refresh and try again.", 409);
        return Response.json({ order: updated[0] });
      } catch (error) { if (error instanceof SalonAccessError) throw error; throw new SalonAccessError("Stock or order state changed in another session. Refresh and try again.", 409); }
    }
    throw new SalonAccessError("Choose a valid purchase order action.", 400);
  } catch (error) { return salonApiError(error, "Purchase order could not be updated"); }
}
