import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { inventoryItems, inventoryMovements, locations, purchaseOrderLines, purchaseOrders, suppliers } from "../../../../db/schema";
import { requireInventoryAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../salon-access";
import { toCsv } from "../../../../lib/accounting";
import { displayQuantity, movementCost } from "../../../../lib/inventory";
import { zonedDayBounds } from "../../../../lib/time-zone";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function rangeDays(from: string, to: string) { return Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1; }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireInventoryAccess(membership);
    const query = new URL(request.url).searchParams, kind = String(query.get("type") || "stock"), from = String(query.get("from") || ""), to = String(query.get("to") || "");
    if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > 366 || !["stock", "movements", "purchase_orders"].includes(kind)) throw new SalonAccessError("Choose a valid export and range of up to 366 days.", 400);
    const [location] = await db.select({ currency: locations.currency, timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const start = zonedDayBounds(from, location.timezone).start.toISOString(), end = zonedDayBounds(to, location.timezone).end.toISOString();
    const [items, supplierRows] = await Promise.all([
      db.select().from(inventoryItems).where(and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId))),
      db.select().from(suppliers).where(and(eq(suppliers.organizationId, membership.organizationId), eq(suppliers.locationId, membership.locationId))),
    ]);
    let csv: string;
    if (kind === "stock") {
      const positions = await db.select({ inventoryItemId: inventoryMovements.inventoryItemId, quantity: sql<number>`coalesce(sum(${inventoryMovements.quantityDeltaMilli}), 0)`, value: sql<number>`coalesce(sum(case when ${inventoryMovements.quantityDeltaMilli} >= 0 then ${inventoryMovements.totalCostCents} else -${inventoryMovements.totalCostCents} end), 0)` }).from(inventoryMovements).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId))).groupBy(inventoryMovements.inventoryItemId);
      csv = toCsv(["Item", "SKU", "Barcode", "Category", "Unit", "On hand", "Reorder point", "Target stock", "Preferred order", "Average unit cost", "Inventory value", "Selling price", "Preferred supplier", "Active", "Currency", "As of"], items.map((item) => { const position = positions.find((row) => row.inventoryItemId === item.id), quantity = Number(position?.quantity || 0), value = Number(position?.value || 0); return [item.name, item.sku, item.barcode, item.category, item.unit, displayQuantity(quantity), displayQuantity(item.reorderPointMilli), displayQuantity(item.targetStockMilli), displayQuantity(item.preferredOrderMilli), quantity > 0 ? Math.round(value * 1000 / quantity) / 100 : 0, value / 100, item.sellingPriceCents / 100, supplierRows.find((supplier) => supplier.id === item.preferredSupplierId)?.name || "", item.active ? "yes" : "no", location.currency, to]; }));
    } else if (kind === "movements") {
      const movements = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId), gte(inventoryMovements.occurredAt, start), lt(inventoryMovements.occurredAt, end)));
      csv = toCsv(["Date", "Item", "SKU", "Movement", "Quantity change", "Unit", "Unit cost", "Total cost", "Lot", "Expires", "Purchase order", "Note", "Currency"], movements.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((movement) => { const item = items.find((candidate) => candidate.id === movement.inventoryItemId); return [movement.occurredAt, item?.name || "Inventory item", item?.sku || "", movement.kind, displayQuantity(movement.quantityDeltaMilli), item?.unit || "each", movement.unitCostCents / 100, movement.totalCostCents / 100, movement.lotNumber, movement.expiresOn, movement.purchaseOrderId, movement.note, location.currency]; }));
    } else {
      const orders = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId), gte(purchaseOrders.createdAt, start), lt(purchaseOrders.createdAt, end)));
      const lines = orders.length ? await db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.organizationId, membership.organizationId), eq(purchaseOrderLines.locationId, membership.locationId), inArray(purchaseOrderLines.purchaseOrderId, orders.map((order) => order.id)))) : [];
      csv = toCsv(["Order", "Status", "Supplier", "Created", "Ordered", "Expected", "Received", "Item", "SKU", "Quantity", "Unit", "Unit cost", "Line total", "Shipping", "Tax", "Currency", "Notes"], orders.flatMap((order) => lines.filter((line) => line.purchaseOrderId === order.id).map((line) => { const item = items.find((candidate) => candidate.id === line.inventoryItemId); return [order.orderNumber, order.status, supplierRows.find((supplier) => supplier.id === order.supplierId)?.name || "Supplier", order.createdAt, order.orderedOn, order.expectedOn, order.receivedAt, item?.name || "Inventory item", item?.sku || "", displayQuantity(line.quantityMilli), item?.unit || "each", line.unitCostCents / 100, movementCost(line.quantityMilli, line.unitCostCents) / 100, order.shippingCents / 100, order.taxCents / 100, order.currency, order.notes]; })));
    }
    const filename = `coat-care-inventory-${kind}-${from}-to-${to}.csv`;
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return salonApiError(error, "Inventory export unavailable"); }
}
