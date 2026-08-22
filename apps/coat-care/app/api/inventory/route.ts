import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { auditEvents, inventoryItems, inventoryMovementClaims, inventoryMovements, locations, purchaseOrderLines, purchaseOrders, suppliers } from "../../../db/schema";
import { requireInventoryAccess, requireInventoryManagement, requireInventoryMovementAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../salon-access";
import { dateKeyInZone, zonedDayBounds } from "../../../lib/time-zone";
import { displayQuantity, movementCost, reorderQuantity } from "../../../lib/inventory";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = ["grooming_supply", "retail_product"] as const;
const units = ["each", "ml", "g", "oz", "lb", "pack", "case"] as const;
const movementKinds = ["purchase", "usage", "retail_sale", "waste", "adjustment", "return_to_supplier"] as const;
function validDate(value: string) { const parsed = new Date(`${value}T12:00:00.000Z`); return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function finiteMoney(value: unknown, maximum = 100_000_000) { const number = Number(value); return Number.isInteger(number) && number >= 0 && number <= maximum ? number : null; }
function finiteQuantity(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? Math.round(number * 1000) : null; }
function textValue(value: unknown, max: number) { return String(value || "").trim().slice(0, max); }
function nullableText(value: unknown, max: number) { return textValue(value, max) || null; }
function rangeDays(from: string, to: string) { return Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1; }

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireInventoryAccess(membership);
    const [location] = await db.select({ currency: locations.currency, timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1);
    if (!location) throw new SalonAccessError("Location not found.", 404);
    const query = new URL(request.url).searchParams, today = dateKeyInZone(new Date(), location.timezone), from = query.get("from") || `${today.slice(0, 8)}01`, to = query.get("to") || today;
    if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > 366) throw new SalonAccessError("Choose an inventory reporting range of up to 366 days.", 400);
    const start = zonedDayBounds(from, location.timezone).start.toISOString(), end = zonedDayBounds(to, location.timezone).end.toISOString();
    const scope = and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId));
    const [itemRows, supplierRows, positions, periodCosts, recentMovements, orderRows] = await Promise.all([
      db.select().from(inventoryItems).where(scope).orderBy(asc(inventoryItems.name)),
      db.select().from(suppliers).where(and(eq(suppliers.organizationId, membership.organizationId), eq(suppliers.locationId, membership.locationId))).orderBy(asc(suppliers.name)),
      db.select({ inventoryItemId: inventoryMovements.inventoryItemId, quantityOnHandMilli: sql<number>`coalesce(sum(${inventoryMovements.quantityDeltaMilli}), 0)`, inventoryValueCents: sql<number>`coalesce(sum(case when ${inventoryMovements.quantityDeltaMilli} >= 0 then ${inventoryMovements.totalCostCents} else -${inventoryMovements.totalCostCents} end), 0)` }).from(inventoryMovements).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId))).groupBy(inventoryMovements.inventoryItemId),
      db.select({ inventoryItemId: inventoryMovements.inventoryItemId, kind: inventoryMovements.kind, totalCostCents: sql<number>`coalesce(sum(${inventoryMovements.totalCostCents}), 0)` }).from(inventoryMovements).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId), gte(inventoryMovements.occurredAt, start), lt(inventoryMovements.occurredAt, end))).groupBy(inventoryMovements.inventoryItemId, inventoryMovements.kind),
      db.select({ id: inventoryMovements.id, inventoryItemId: inventoryMovements.inventoryItemId, kind: inventoryMovements.kind, quantityDeltaMilli: inventoryMovements.quantityDeltaMilli, unitCostCents: inventoryMovements.unitCostCents, totalCostCents: inventoryMovements.totalCostCents, lotNumber: inventoryMovements.lotNumber, expiresOn: inventoryMovements.expiresOn, note: inventoryMovements.note, occurredAt: inventoryMovements.occurredAt, itemName: inventoryItems.name, unit: inventoryItems.unit }).from(inventoryMovements).innerJoin(inventoryItems, eq(inventoryMovements.inventoryItemId, inventoryItems.id)).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId))).orderBy(desc(inventoryMovements.occurredAt), desc(inventoryMovements.createdAt)).limit(120),
      db.select().from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, membership.organizationId), eq(purchaseOrders.locationId, membership.locationId))).orderBy(desc(purchaseOrders.createdAt)).limit(100),
    ]);
    const orderLines = orderRows.length ? await db.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.organizationId, membership.organizationId), eq(purchaseOrderLines.locationId, membership.locationId), inArray(purchaseOrderLines.purchaseOrderId, orderRows.map((order) => order.id)))) : [];
    const items = itemRows.map((item) => {
      const position = positions.find((row) => row.inventoryItemId === item.id), quantityOnHandMilli = Number(position?.quantityOnHandMilli || 0), inventoryValueCents = Number(position?.inventoryValueCents || 0), averageUnitCostCents = quantityOnHandMilli > 0 ? Math.max(0, Math.round(inventoryValueCents * 1000 / quantityOnHandMilli)) : 0;
      const cost = (kind: string) => Number(periodCosts.find((row) => row.inventoryItemId === item.id && row.kind === kind)?.totalCostCents || 0);
      return { ...item, quantityOnHandMilli, quantityOnHand: displayQuantity(quantityOnHandMilli), inventoryValueCents, averageUnitCostCents, purchaseCostCents: cost("purchase"), usageCostCents: cost("usage"), retailCogsCents: cost("retail_sale"), wasteCostCents: cost("waste"), reorderQuantityMilli: reorderQuantity(quantityOnHandMilli, item.reorderPointMilli, item.targetStockMilli, item.preferredOrderMilli), lowStock: item.active && quantityOnHandMilli <= item.reorderPointMilli };
    });
    const orders = orderRows.map((order) => { const lines = orderLines.filter((line) => line.purchaseOrderId === order.id).map((line) => ({ ...line, itemName: itemRows.find((item) => item.id === line.inventoryItemId)?.name || "Inventory item", unit: itemRows.find((item) => item.id === line.inventoryItemId)?.unit || "each" })); return { ...order, supplierName: supplierRows.find((supplier) => supplier.id === order.supplierId)?.name || "Supplier", lines, subtotalCents: lines.reduce((sum, line) => sum + movementCost(line.quantityMilli, line.unitCostCents), 0), totalCents: lines.reduce((sum, line) => sum + movementCost(line.quantityMilli, line.unitCostCents), 0) + order.shippingCents + order.taxCents }; });
    const activeItems = items.filter((item) => item.active), metrics = { inventoryValueCents: activeItems.reduce((sum, item) => sum + item.inventoryValueCents, 0), lowStockItems: activeItems.filter((item) => item.lowStock).length, retailCogsCents: activeItems.reduce((sum, item) => sum + item.retailCogsCents, 0), usageCostCents: activeItems.reduce((sum, item) => sum + item.usageCostCents, 0), wasteCostCents: activeItems.reduce((sum, item) => sum + item.wasteCostCents, 0), openOrders: orders.filter((order) => ["draft", "ordered"].includes(order.status)).length };
    return Response.json({ range: { from, to }, location, metrics, items, suppliers: supplierRows, movements: recentMovements, orders, canManage: ["owner", "manager"].includes(membership.role), canMove: membership.role !== "accountant", disclaimer: "Perpetual inventory management estimate. Confirm year-end counts, valuation method, and tax reporting with your accountant." });
  } catch (error) { return salonApiError(error, "Inventory unavailable"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    const body = await request.json() as Record<string, unknown>, action = String(body.action || ""), now = new Date().toISOString(), idempotencyKey = textValue(body.idempotencyKey, 120);
    if (!idempotencyKey) throw new SalonAccessError("A request key is required.", 400);
    if (action === "create_supplier") {
      requireInventoryManagement(membership);
      const name = textValue(body.name, 160), contactName = textValue(body.contactName, 160), email = textValue(body.email, 254).toLowerCase(), phone = textValue(body.phone, 40), website = textValue(body.website, 300), accountNumber = textValue(body.accountNumber, 100), notes = textValue(body.notes, 1000), paymentTermsDays = Number(body.paymentTermsDays || 0);
      if (!name || !Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365 || (email && !email.includes("@")) || (website && !/^https?:\/\//i.test(website))) throw new SalonAccessError("Enter valid supplier details.", 400);
      const [existing] = await db.select().from(suppliers).where(and(eq(suppliers.organizationId, membership.organizationId), eq(suppliers.locationId, membership.locationId), eq(suppliers.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) return Response.json({ supplier: existing }, { status: 200 });
      const id = crypto.randomUUID();
      try {
        const [created] = await db.batch([
          db.insert(suppliers).values({ id, organizationId: membership.organizationId, locationId: membership.locationId, name, contactName, email, phone, website, accountNumber, notes, paymentTermsDays, idempotencyKey }).returning(),
          db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.supplier_created", entityType: "supplier", entityId: id, detailsJson: JSON.stringify({ name }) }),
        ]);
        return Response.json({ supplier: created[0] }, { status: 201 });
      } catch { throw new SalonAccessError("Supplier changed in another session. Refresh and try again.", 409); }
    }
    if (action === "create_item") {
      requireInventoryManagement(membership);
      const name = textValue(body.name, 160), sku = nullableText(body.sku, 80), barcode = nullableText(body.barcode, 80), category = String(body.category || "") as typeof categories[number], unit = String(body.unit || "") as typeof units[number], preferredSupplierId = nullableText(body.preferredSupplierId, 100), reorderPointMilli = finiteQuantity(body.reorderPoint), targetStockMilli = finiteQuantity(body.targetStock), preferredOrderMilli = finiteQuantity(body.preferredOrder), openingQuantityMilli = finiteQuantity(body.openingQuantity), unitCostCents = finiteMoney(body.unitCostCents), sellingPriceCents = finiteMoney(body.sellingPriceCents), taxable = body.taxable !== false;
      if (!name || !categories.includes(category) || !units.includes(unit) || reorderPointMilli === null || targetStockMilli === null || preferredOrderMilli === null || openingQuantityMilli === null || unitCostCents === null || sellingPriceCents === null || targetStockMilli < reorderPointMilli) throw new SalonAccessError("Enter valid item, stock, and pricing details.", 400);
      if (openingQuantityMilli > 0 && unitCostCents < 1) throw new SalonAccessError("Opening stock needs a unit cost.", 400);
      if (preferredSupplierId) { const [supplier] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, preferredSupplierId), eq(suppliers.organizationId, membership.organizationId), eq(suppliers.locationId, membership.locationId), eq(suppliers.active, true))).limit(1); if (!supplier) throw new SalonAccessError("Preferred supplier not found.", 404); }
      const id = crypto.randomUUID(), itemValues = { id, organizationId: membership.organizationId, locationId: membership.locationId, preferredSupplierId, name, sku, barcode, category, unit, reorderPointMilli, targetStockMilli, preferredOrderMilli, lastPurchaseUnitCostCents: unitCostCents, sellingPriceCents, taxable, idempotencyKey, stockVersion: openingQuantityMilli > 0 ? 1 : 0 };
      const [existing] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) return Response.json({ item: existing }, { status: 200 });
      const statements = [db.insert(inventoryItems).values(itemValues), ...(openingQuantityMilli > 0 ? [db.insert(inventoryMovements).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, inventoryItemId: id, supplierId: preferredSupplierId, kind: "opening" as const, quantityDeltaMilli: openingQuantityMilli, unitCostCents, totalCostCents: movementCost(openingQuantityMilli, unitCostCents), note: "Opening stock", occurredAt: now, idempotencyKey: `${idempotencyKey}:opening`, enteredByStaffId: membership.id })] : []), db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "inventory.item_created", entityType: "inventory_item", entityId: id, detailsJson: JSON.stringify({ name, category, unit, openingQuantityMilli }) })];
      if (statements.length === 2) await db.batch([statements[0], statements[1]]); else await db.batch([statements[0], statements[1], statements[2]]);
      const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId))).limit(1);
      return Response.json({ item }, { status: 201 });
    }
    if (action === "record_movement") {
      requireInventoryMovementAccess(membership);
      const inventoryItemId = textValue(body.inventoryItemId, 100), kind = String(body.kind || "") as typeof movementKinds[number], note = textValue(body.note, 500), lotNumber = textValue(body.lotNumber, 100), expiresOn = textValue(body.expiresOn, 10) || null, occurredOn = textValue(body.occurredOn, 10), requestedQuantityMilli = finiteQuantity(body.quantity), targetQuantityMilli = finiteQuantity(body.targetQuantity), requestedUnitCostCents = finiteMoney(body.unitCostCents);
      if (!inventoryItemId || !movementKinds.includes(kind) || !validDate(occurredOn) || (expiresOn && !validDate(expiresOn))) throw new SalonAccessError("Enter a valid movement, item, and date.", 400);
      if (["purchase", "return_to_supplier"].includes(kind)) requireInventoryManagement(membership);
      const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, inventoryItemId), eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId), eq(inventoryItems.active, true))).limit(1);
      if (!item) throw new SalonAccessError("Inventory item not found.", 404);
      const [existingMovement] = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId), eq(inventoryMovements.idempotencyKey, idempotencyKey))).limit(1);
      if (existingMovement) { if (existingMovement.inventoryItemId !== item.id) throw new SalonAccessError("That request key was already used for another stock item.", 409); return Response.json({ movement: existingMovement }, { status: 200 }); }
      const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1); if (!location) throw new SalonAccessError("Location not found.", 404);
      const today = dateKeyInZone(new Date(), location.timezone); if (occurredOn > today) throw new SalonAccessError("Future stock movements are not allowed.", 400);
      const [position] = await db.select({ quantity: sql<number>`coalesce(sum(${inventoryMovements.quantityDeltaMilli}), 0)`, value: sql<number>`coalesce(sum(case when ${inventoryMovements.quantityDeltaMilli} >= 0 then ${inventoryMovements.totalCostCents} else -${inventoryMovements.totalCostCents} end), 0)` }).from(inventoryMovements).where(and(eq(inventoryMovements.inventoryItemId, item.id), eq(inventoryMovements.organizationId, membership.organizationId), eq(inventoryMovements.locationId, membership.locationId)));
      const currentQuantity = Number(position?.quantity || 0), currentValue = Number(position?.value || 0), averageCost = currentQuantity > 0 ? Math.max(0, Math.round(currentValue * 1000 / currentQuantity)) : item.lastPurchaseUnitCostCents;
      let quantityDeltaMilli: number, unitCostCents: number;
      if (kind === "adjustment") { if (targetQuantityMilli === null || targetQuantityMilli < 0) throw new SalonAccessError("Enter the physical count.", 400); quantityDeltaMilli = targetQuantityMilli - currentQuantity; if (!quantityDeltaMilli) throw new SalonAccessError("The physical count already matches the book quantity.", 409); unitCostCents = quantityDeltaMilli > 0 ? (requestedUnitCostCents || averageCost) : averageCost; }
      else { if (requestedQuantityMilli === null || requestedQuantityMilli < 1) throw new SalonAccessError("Enter a movement quantity greater than zero.", 400); quantityDeltaMilli = kind === "purchase" ? requestedQuantityMilli : -requestedQuantityMilli; unitCostCents = kind === "purchase" ? (requestedUnitCostCents || 0) : averageCost; }
      if (kind === "purchase" && unitCostCents < 1) throw new SalonAccessError("Purchases need a unit cost.", 400);
      if (kind === "adjustment" && quantityDeltaMilli > 0 && unitCostCents < 1) throw new SalonAccessError("An upward count adjustment needs a unit cost.", 400);
      if (currentQuantity + quantityDeltaMilli < 0) throw new SalonAccessError(`Only ${displayQuantity(currentQuantity)} ${item.unit} is available. Count stock first if the book is wrong.`, 409);
      if (unitCostCents < 0) throw new SalonAccessError("A valid inventory cost is required.", 400);
      const occurredAt = occurredOn === today ? now : zonedDayBounds(occurredOn, location.timezone).start.toISOString(), movementId = crypto.randomUUID(), movementValues = { id: movementId, organizationId: membership.organizationId, locationId: membership.locationId, inventoryItemId: item.id, supplierId: item.preferredSupplierId, kind, quantityDeltaMilli, unitCostCents, totalCostCents: movementCost(quantityDeltaMilli, unitCostCents), lotNumber, expiresOn, note, occurredAt, idempotencyKey, enteredByStaffId: membership.id };
      try {
        const [, updated, inserted] = await db.batch([
          db.insert(inventoryMovementClaims).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: membership.locationId, inventoryItemId: item.id, expectedStockVersion: item.stockVersion, movementGroupId: movementId }),
          db.update(inventoryItems).set({ stockVersion: sql`${inventoryItems.stockVersion} + 1`, lastPurchaseUnitCostCents: kind === "purchase" ? unitCostCents : item.lastPurchaseUnitCostCents, updatedAt: now }).where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.organizationId, membership.organizationId), eq(inventoryItems.locationId, membership.locationId), eq(inventoryItems.stockVersion, item.stockVersion))).returning({ id: inventoryItems.id }),
          db.insert(inventoryMovements).values(movementValues).returning(),
          db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: `inventory.${kind}_recorded`, entityType: "inventory_movement", entityId: movementId, detailsJson: JSON.stringify({ inventoryItemId: item.id, quantityDeltaMilli, unitCostCents, occurredOn }) }),
        ]);
        if (!updated[0] || !inserted[0]) throw new SalonAccessError("Stock changed in another session. Refresh and try again.", 409);
        return Response.json({ movement: inserted[0] }, { status: 201 });
      } catch (error) { if (error instanceof SalonAccessError) throw error; throw new SalonAccessError("Stock changed in another session. Refresh and try again.", 409); }
    }
    throw new SalonAccessError("Choose a valid inventory action.", 400);
  } catch (error) { return salonApiError(error, "Inventory could not be updated"); }
}
