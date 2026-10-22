import { isValidDateKey } from "../../../lib/time-zone";
import { deletePromotion, loadAdminCatalog, saveCategory, savePromotion, updateProduct, type ProductPatch } from "../../../lib/shop-admin";
import { shopConfig } from "../../../lib/square-shop";
import { SalonAccessError } from "../../salon-access";
import { recordShopChange, requireShopAdmin, shopAdminError, squareId, squareIds } from "./shop-admin-request";

const noStore = { "cache-control": "no-store" };

function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== "string") throw new SalonAccessError(`Enter the ${label}.`, 400);
  const trimmed = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !trimmed) || trimmed.length > max) throw new SalonAccessError(required ? `Enter the ${label} (up to ${max} characters).` : `Keep the ${label} under ${max} characters.`, 400);
  return trimmed;
}

function productPatch(body: Record<string, unknown>): ProductPatch {
  const patch: ProductPatch = {};
  if (body.name !== undefined) patch.name = text(body.name, "product name", 255);
  if (body.description !== undefined) patch.description = text(body.description, "description", 4000, false);
  if (body.categoryIds !== undefined) {
    patch.categoryIds = squareIds(body.categoryIds, "categories", 50);
    patch.mainCategoryId = body.mainCategoryId ? squareId(body.mainCategoryId, "main category") : "";
  }
  if (body.prices !== undefined) {
    if (!body.prices || typeof body.prices !== "object" || Array.isArray(body.prices) || Object.keys(body.prices).length > 100) throw new SalonAccessError("Enter valid prices.", 400);
    patch.prices = {};
    for (const [id, cents] of Object.entries(body.prices)) {
      if (!Number.isSafeInteger(cents) || (cents as number) < 0 || (cents as number) > 10_000_000) throw new SalonAccessError("Enter prices between 0 $ and 100 000 $.", 400);
      patch.prices[squareId(id, "size")] = cents as number;
    }
  }
  if (body.imageIds !== undefined) patch.imageIds = squareIds(body.imageIds, "photos", 50);
  if (!Object.keys(patch).length) throw new SalonAccessError("Nothing to save.", 400);
  return patch;
}

function promotionInput(body: Record<string, unknown>) {
  const percentage = Number(body.percentage);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100 || Math.abs(Math.round(percentage * 100) - percentage * 100) > 1e-9) throw new SalonAccessError("Enter a discount between 0.01 % and 100 %.", 400);
  const startsOn = String(body.startsOn || ""), endsOn = String(body.endsOn || "");
  if (!isValidDateKey(startsOn) || (endsOn && (!isValidDateKey(endsOn) || endsOn < startsOn))) throw new SalonAccessError("Choose a start date, and an end date on or after it.", 400);
  const allProducts = body.allProducts === true;
  const productIds = allProducts ? [] : squareIds(body.productIds ?? [], "products", 500);
  const categoryIds = allProducts ? [] : squareIds(body.categoryIds ?? [], "categories", 100);
  if (!allProducts && !productIds.length && !categoryIds.length) throw new SalonAccessError("Choose the products or categories on promotion.", 400);
  return { name: text(body.name, "promotion name", 255), percentage, startsOn, endsOn, allProducts, productIds, categoryIds };
}

export async function GET() {
  try {
    await requireShopAdmin();
    const shop = shopConfig();
    if (!shop.hasToken) return Response.json({ configured: false }, { headers: noStore });
    const catalog = await loadAdminCatalog();
    return Response.json({ configured: true, locationConfigured: shop.configured, ...catalog }, { headers: noStore });
  } catch (error) { return shopAdminError(error, "The Square catalog could not be loaded"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireShopAdmin();
    if (!shopConfig().hasToken) throw new SalonAccessError("Connect Square first: SQUARE_ACCESS_TOKEN is not set.", 503);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new SalonAccessError("The request is invalid.", 400);
    const action = String(body.action || "");

    if (action === "update_product") {
      const itemId = squareId(body.itemId, "product");
      const patch = productPatch(body);
      const product = await updateProduct(itemId, patch);
      await recordShopChange(db, membership, "boutique.product_updated", "square_item", itemId, { name: product.name, fields: Object.keys(patch).filter((key) => key !== "mainCategoryId"), prices: patch.prices });
      return Response.json({ product }, { headers: noStore });
    }

    if (action === "save_category") {
      const id = body.id ? squareId(body.id, "category") : "";
      const name = text(body.name, "category name", 255);
      const parentId = body.parentId ? squareId(body.parentId, "parent category") : "";
      const saved = await saveCategory({ id, name, parentId });
      await recordShopChange(db, membership, id ? "boutique.category_updated" : "boutique.category_created", "square_category", saved.id, { name, parentId });
      return Response.json({ category: { id: saved.id, name } }, { headers: noStore });
    }

    if (action === "save_promotion") {
      const id = body.id ? squareId(body.id, "promotion") : "";
      const input = promotionInput(body);
      const savedId = await savePromotion(id, input);
      await recordShopChange(db, membership, id ? "boutique.promotion_updated" : "boutique.promotion_created", "square_pricing_rule", savedId, input);
      return Response.json({ id: savedId }, { headers: noStore });
    }

    if (action === "delete_promotion") {
      const id = squareId(body.id, "promotion");
      await deletePromotion(id);
      await recordShopChange(db, membership, "boutique.promotion_deleted", "square_pricing_rule", id, {});
      return Response.json({ ok: true }, { headers: noStore });
    }

    throw new SalonAccessError("Unknown action.", 400);
  } catch (error) { return shopAdminError(error, "The change could not be saved in Square"); }
}
