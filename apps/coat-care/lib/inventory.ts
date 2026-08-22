export type StockMovement = {
  kind: "opening" | "purchase" | "usage" | "retail_sale" | "waste" | "adjustment" | "return_to_supplier";
  quantityDeltaMilli: number;
  unitCostCents: number;
  totalCostCents: number;
  occurredAt?: string;
};

export function quantityMilli(value: number) { return Math.round(value * 1000); }
export function displayQuantity(value: number) { return Math.round(value) / 1000; }
export function movementCostSign(movement: Pick<StockMovement, "quantityDeltaMilli" | "totalCostCents">) { return movement.quantityDeltaMilli >= 0 ? movement.totalCostCents : -movement.totalCostCents; }

export function stockPosition(movements: StockMovement[], from?: string, to?: string) {
  const quantityOnHandMilli = movements.reduce((sum, movement) => sum + movement.quantityDeltaMilli, 0);
  const inventoryValueCents = movements.reduce((sum, movement) => sum + movementCostSign(movement), 0);
  const inRange = movements.filter((movement) => (!from || !movement.occurredAt || movement.occurredAt >= from) && (!to || !movement.occurredAt || movement.occurredAt < to));
  const costFor = (kind: StockMovement["kind"]) => inRange.filter((movement) => movement.kind === kind).reduce((sum, movement) => sum + movement.totalCostCents, 0);
  return {
    quantityOnHandMilli,
    inventoryValueCents,
    averageUnitCostCents: quantityOnHandMilli > 0 ? Math.max(0, Math.round(inventoryValueCents * 1000 / quantityOnHandMilli)) : 0,
    purchaseCostCents: costFor("purchase"),
    usageCostCents: costFor("usage"),
    retailCogsCents: costFor("retail_sale"),
    wasteCostCents: costFor("waste"),
  };
}

export function movementCost(quantityDeltaMilli: number, unitCostCents: number) {
  return Math.round(Math.abs(quantityDeltaMilli) * unitCostCents / 1000);
}

export function reorderQuantity(currentMilli: number, reorderPointMilli: number, targetStockMilli: number, preferredOrderMilli: number) {
  if (currentMilli > reorderPointMilli) return 0;
  return Math.max(preferredOrderMilli, targetStockMilli - currentMilli, 0);
}
