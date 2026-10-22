import { squareRequest, SquareRequestError } from "./square.ts";
import {
  type CatalogObject,
  type DiscountData,
  type PricingRuleData,
  type ProductSetData,
  descriptionText,
  discountPercentage,
  indexCatalogImages,
  loadCatalogObjects,
  normalizeCatalog,
  retrieveMissingImages,
  shopConfig,
  shopToday,
  uniqueIds,
} from "./square-shop.ts";

// The salon's product admin (/salon → Online store). Square stays the only
// catalog: every change is written to the Square catalog, so the boutique, the
// point of sale in the shop and Square's reports always agree. Promotions are
// Square automatic discounts (a discount, the products it covers and a pricing
// rule with its dates), which Square applies at the till and at the boutique's
// checkout alike.

export type AdminImage = { id: string; url: string };

export type AdminVariation = {
  id: string;
  name: string;
  sku: string;
  priceCents: number | null; // null when the price is entered at the till
  currency: string;
};

export type AdminProduct = {
  id: string;
  name: string;
  description: string;
  images: AdminImage[];
  categoryIds: string[];
  mainCategoryId: string; // Square's reporting category, the badge on the boutique card
  variations: AdminVariation[];
  onSite: boolean; // listed in the boutique: priced, sellable and stocked at the salon's location
  updatedAt: string;
};

export type AdminCategory = { id: string; name: string; parentId: string; imageUrl: string; productCount: number };

export type AdminPromotion = {
  id: string;
  name: string;
  percentage: number; // 0 when the discount is not a plain percentage
  startsOn: string;
  endsOn: string;
  allProducts: boolean;
  productIds: string[];
  categoryIds: string[];
  status: "active" | "scheduled" | "ended";
  editable: boolean; // false for a rule set up in Square with conditions this admin does not offer
};

export type AdminCatalog = { products: AdminProduct[]; categories: AdminCategory[]; promotions: AdminPromotion[]; today: string };

export type ProductPatch = {
  name?: string;
  description?: string;
  categoryIds?: string[];
  mainCategoryId?: string;
  prices?: Record<string, number>; // variation id -> cents
  imageIds?: string[]; // the item's photos in their new order, the first being the main one
};

export type PromotionInput = {
  name: string;
  percentage: number;
  startsOn: string;
  endsOn: string;
  allProducts: boolean;
  productIds: string[];
  categoryIds: string[];
};

export class ShopAdminError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };

// Square stores descriptions as simple HTML: a blank line starts a paragraph,
// a single new line is a line break.
export function textToHtml(text: string) {
  return text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/).filter((part) => part.trim())
    .map((part) => `<p>${part.trim().replace(/[&<>"]/g, (char) => ESCAPES[char]).replace(/\n/g, "<br>")}</p>`).join("");
}

function retailItem(object: CatalogObject) {
  const item = object.type === "ITEM" && !object.is_deleted ? object.item_data : undefined;
  return Boolean(item && !item.is_archived && (!item.product_type || item.product_type === "REGULAR"));
}

function itemCategoryIds(item: NonNullable<CatalogObject["item_data"]>) {
  return uniqueIds([...(item.categories || []).map((entry) => entry.id), item.reporting_category?.id, item.category_id]);
}

function toAdminProduct(object: CatalogObject, images: Map<string, string>, locationId: string, onSite: Set<string>): AdminProduct {
  const item = object.item_data!;
  const categoryIds = itemCategoryIds(item);
  return {
    id: object.id,
    name: item.name || "",
    description: descriptionText(item),
    images: (item.image_ids || []).map((id) => ({ id, url: images.get(id) || "" })),
    categoryIds,
    mainCategoryId: item.reporting_category?.id || categoryIds[0] || "",
    variations: (item.variations || []).filter((variation) => !variation.is_deleted).map((variation) => {
      const data = variation.item_variation_data || {};
      // The boutique sells at the salon location's price when Square has one.
      const override = data.location_overrides?.find((entry) => entry.location_id === locationId && entry.price_money);
      const price = data.pricing_type === "VARIABLE_PRICING" ? undefined : override?.price_money || data.price_money;
      return {
        id: variation.id,
        name: data.name || "",
        sku: data.sku || "",
        priceCents: Number.isSafeInteger(price?.amount) ? price!.amount! : null,
        currency: price?.currency || "CAD",
      };
    }),
    onSite: onSite.has(object.id),
    updatedAt: object.updated_at || "",
  };
}

function promotionStatus(rule: PricingRuleData, today: string): AdminPromotion["status"] {
  if (rule.valid_from_date && rule.valid_from_date > today) return "scheduled";
  if (rule.valid_until_date && rule.valid_until_date < today) return "ended";
  return "active";
}

function toAdminPromotion(rule: CatalogObject, byId: Map<string, CatalogObject>, today: string): AdminPromotion {
  const data = rule.pricing_rule_data || {};
  const discount = byId.get(data.discount_id || "")?.discount_data;
  const set = byId.get(data.match_products_id || "")?.product_set_data;
  const ids = set?.product_ids_any || [];
  const productIds = ids.filter((id) => byId.get(id)?.type === "ITEM");
  const categoryIds = ids.filter((id) => byId.get(id)?.type === "CATEGORY");
  // A product or category deleted since is simply left out; a single size
  // (a variation) or anything else is beyond what this admin edits.
  const otherIds = ids.filter((id) => byId.has(id) && !["ITEM", "CATEGORY"].includes(byId.get(id)!.type));
  const percentage = discountPercentage(discount);
  // This admin writes « x % off these items or categories, from one day to
  // another ». A rule with anything more stays editable in Square only.
  const editable = Boolean(percentage && set && (set.all_products || ids.length) && !otherIds.length
    && !set.product_ids_all?.length && !set.quantity_exact && !set.quantity_min && !set.quantity_max
    && !data.time_period_ids?.length && !data.customer_group_ids_any?.length && !data.minimum_order_subtotal_money
    && !data.exclude_products_id && !data.apply_products_id && !data.valid_from_local_time && !data.valid_until_local_time);
  return {
    id: rule.id,
    name: (data.name || discount?.name || "").trim() || "Promotion",
    percentage,
    startsOn: data.valid_from_date || "",
    endsOn: data.valid_until_date || "",
    allProducts: Boolean(set?.all_products),
    productIds,
    categoryIds,
    status: promotionStatus(data, today),
    editable,
  };
}

const ADMIN_OBJECT_TYPES = ["ITEM", "CATEGORY", "PRICING_RULE", "PRODUCT_SET", "DISCOUNT"];

export async function loadAdminCatalog(fetcher?: typeof fetch, today = shopToday()): Promise<AdminCatalog> {
  const { objects, related } = await loadCatalogObjects(ADMIN_OBJECT_TYPES, fetcher);
  const all = [...related, ...objects];
  const images = indexCatalogImages(all);
  const locationId = shopConfig().locationId;
  const onSite = new Set(normalizeCatalog(objects, related, locationId, today).map((product) => product.itemId));
  const products = objects.filter(retailItem).map((object) => toAdminProduct(object, images, locationId, onSite))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { ignorePunctuation: true }));
  const counts = new Map<string, number>();
  for (const product of products) for (const id of product.categoryIds) counts.set(id, (counts.get(id) || 0) + 1);
  const categoryObjects = objects.filter((object) => object.type === "CATEGORY" && !object.is_deleted && object.category_data?.name);
  const known = new Set(categoryObjects.map((object) => object.id));
  const categories = categoryObjects.map((object) => {
    const parentId = object.category_data?.parent_category?.id || "";
    return {
      id: object.id,
      name: object.category_data!.name!,
      parentId: parentId !== object.id && known.has(parentId) ? parentId : "",
      imageUrl: (object.category_data?.image_ids || []).map((id) => images.get(id) || "").find(Boolean) || "",
      productCount: counts.get(object.id) || 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const byId = new Map(all.map((object) => [object.id, object]));
  for (const object of all) {
    for (const variation of object.item_data?.variations || []) byId.set(variation.id, { id: variation.id, type: "ITEM_VARIATION" });
  }
  const promotions = objects.filter((object) => object.type === "PRICING_RULE" && !object.is_deleted)
    .map((rule) => toAdminPromotion(rule, byId, today))
    .sort((a, b) => ["active", "scheduled", "ended"].indexOf(a.status) - ["active", "scheduled", "ended"].indexOf(b.status) || b.startsOn.localeCompare(a.startsOn));
  return { products, categories, promotions, today };
}

async function retrieveObject(id: string, fetcher?: typeof fetch, includeRelated = false) {
  try {
    const query = new URLSearchParams({ include_related_objects: String(includeRelated) });
    return await squareRequest<{ object?: CatalogObject; related_objects?: CatalogObject[] }>(`catalog/object/${encodeURIComponent(id)}`, { query, fetcher });
  } catch (error) {
    if (error instanceof SquareRequestError && error.status === 404) throw new ShopAdminError("This product no longer exists in Square. Refresh the list.", 404);
    throw error;
  }
}

// One product as the admin shows it, read fresh from Square after a change.
export async function loadAdminProduct(itemId: string, fetcher?: typeof fetch): Promise<AdminProduct> {
  const { object, related_objects: related = [] } = await retrieveObject(itemId, fetcher, true);
  if (!object || !retailItem(object)) throw new ShopAdminError("This product is not sold in the boutique.", 404);
  const images = indexCatalogImages(related);
  try {
    await retrieveMissingImages(object.item_data?.image_ids || [], images, fetcher);
  } catch {
    // The product still opens; a photo Square could not return shows as missing.
  }
  const locationId = shopConfig().locationId;
  const onSite = new Set(normalizeCatalog([object], related, locationId).map((product) => product.itemId));
  return toAdminProduct(object, images, locationId, onSite);
}

// Applies the edited fields to the item exactly as Square returned it, so
// whatever this admin does not edit (variations' SKUs, taxes, modifiers,
// stock settings…) is written back unchanged.
export function applyProductPatch(object: CatalogObject, patch: ProductPatch, locationId: string) {
  const item = object.item_data;
  if (object.type !== "ITEM" || !item) throw new ShopAdminError("This product is not sold in the boutique.", 404);
  if (patch.name !== undefined) item.name = patch.name;
  if (patch.description !== undefined) {
    // description_html replaces the deprecated description; Square derives
    // description_plaintext from it.
    item.description_html = textToHtml(patch.description);
    delete item.description;
    delete item.description_plaintext;
  }
  if (patch.categoryIds !== undefined) {
    const ordinals = new Map((item.categories || []).map((entry) => [entry.id, entry]));
    item.categories = patch.categoryIds.map((id) => ordinals.get(id) || { id });
    const main = patch.mainCategoryId && patch.categoryIds.includes(patch.mainCategoryId) ? patch.mainCategoryId : patch.categoryIds[0];
    if (main) item.reporting_category = { id: main };
    else delete item.reporting_category;
    delete item.category_id;
  }
  if (patch.prices) {
    for (const [variationId, amount] of Object.entries(patch.prices)) {
      const variation = item.variations?.find((entry) => entry.id === variationId && !entry.is_deleted);
      if (!variation?.item_variation_data) throw new ShopAdminError("One of the sizes was removed in Square. Refresh the product.", 409);
      const data = variation.item_variation_data;
      const currency = data.price_money?.currency || data.location_overrides?.find((entry) => entry.price_money?.currency)?.price_money?.currency || "CAD";
      data.pricing_type = "FIXED_PRICING";
      data.price_money = { amount, currency };
      // A price set for the salon's location in Square would otherwise win.
      for (const override of data.location_overrides || []) {
        if (override.location_id === locationId && override.price_money) override.price_money = { amount, currency };
      }
    }
  }
  if (patch.imageIds !== undefined) {
    const current = new Set(item.image_ids || []);
    if (patch.imageIds.some((id) => !current.has(id))) throw new ShopAdminError("The photos changed in Square meanwhile. Refresh the product.", 409);
    item.image_ids = patch.imageIds;
  }
  return object;
}

async function upsertObject(object: CatalogObject, fetcher?: typeof fetch) {
  const result = await squareRequest<{ catalog_object?: CatalogObject }>("catalog/object", {
    method: "POST",
    fetcher,
    body: { idempotency_key: crypto.randomUUID(), object },
  });
  if (!result.catalog_object) throw new Error("Square did not return the saved object.");
  return result.catalog_object;
}

// Read, change, write. Square refuses a write made over an older version; the
// change is then applied again to the newer one (a photo added a moment ago,
// an edit at the till), once.
async function updateObject(id: string, change: (object: CatalogObject) => CatalogObject, fetcher?: typeof fetch) {
  for (let attempt = 0; ; attempt += 1) {
    const { object } = await retrieveObject(id, fetcher);
    if (!object || object.is_deleted) throw new ShopAdminError("This entry no longer exists in Square. Refresh the list.", 404);
    try {
      return await upsertObject(change(object), fetcher);
    } catch (error) {
      if (attempt === 0 && error instanceof SquareRequestError && error.code === "VERSION_MISMATCH") continue;
      throw error;
    }
  }
}

export async function updateProduct(itemId: string, patch: ProductPatch, fetcher?: typeof fetch) {
  const locationId = shopConfig().locationId;
  await updateObject(itemId, (object) => {
    if (!retailItem(object)) throw new ShopAdminError("This product is not sold in the boutique.", 404);
    return applyProductPatch(object, patch, locationId);
  }, fetcher);
  return loadAdminProduct(itemId, fetcher);
}

// Adds a photo to a product or a category. Square takes JPEG, PNG and GIF up
// to 15 MB; the admin sends a resized JPEG well under that.
export async function uploadCatalogImage(objectId: string, file: Blob, options: { filename: string; primary: boolean; fetcher?: typeof fetch }) {
  const form = new FormData();
  form.append("request", JSON.stringify({
    idempotency_key: crypto.randomUUID(),
    object_id: objectId,
    is_primary: options.primary,
    image: { id: "#photo", type: "IMAGE", image_data: { name: options.filename.slice(0, 255) } },
  }));
  form.append("file", file, options.filename);
  const result = await squareRequest<{ image?: CatalogObject }>("catalog/images", { method: "POST", body: form, fetcher: options.fetcher });
  const url = result.image?.image_data?.url || "";
  if (!result.image?.id || !url) throw new Error("Square did not return the uploaded photo.");
  return { id: result.image.id, url };
}

// Categories have one level of subcategories: a subcategory's parent is a
// top-level category, and a category with subcategories stays top-level.
export function checkCategoryParent(categories: Array<{ id: string; parentId: string }>, id: string, parentId: string) {
  if (!parentId) return;
  const parent = categories.find((category) => category.id === parentId);
  if (!parent) throw new ShopAdminError("The parent category no longer exists. Refresh the list.", 409);
  if (parentId === id) throw new ShopAdminError("A category cannot be its own parent.");
  if (parent.parentId) throw new ShopAdminError("Choose a main category as the parent: subcategories have no subcategories of their own.");
  if (id && categories.some((category) => category.parentId === id)) throw new ShopAdminError("This category has subcategories, so it stays a main category.");
}

export async function saveCategory(input: { id: string; name: string; parentId: string }, fetcher?: typeof fetch) {
  const { objects } = await loadCatalogObjects(["CATEGORY"], fetcher);
  const categories = objects.filter((object) => object.type === "CATEGORY" && !object.is_deleted)
    .map((object) => ({ id: object.id, parentId: object.category_data?.parent_category?.id || "" }));
  if (input.id && !categories.some((category) => category.id === input.id)) throw new ShopAdminError("This category no longer exists. Refresh the list.", 404);
  checkCategoryParent(categories, input.id, input.parentId);
  const place = (data: NonNullable<CatalogObject["category_data"]> & { is_top_level?: boolean; root_category?: string; path_to_root?: unknown }) => {
    data.name = input.name;
    if (input.parentId) data.parent_category = { ...(data.parent_category?.id === input.parentId ? data.parent_category : {}), id: input.parentId };
    else delete data.parent_category;
    data.is_top_level = !input.parentId;
    // Square works out the place in the tree again from the parent.
    delete data.root_category;
    delete data.path_to_root;
    return data;
  };
  if (!input.id) {
    return upsertObject({ id: "#category", type: "CATEGORY", category_data: { ...place({}), category_type: "REGULAR_CATEGORY" } as CatalogObject["category_data"] }, fetcher);
  }
  return updateObject(input.id, (object) => {
    if (object.type !== "CATEGORY") throw new ShopAdminError("This category no longer exists. Refresh the list.", 404);
    object.category_data = place(object.category_data || {});
    return object;
  }, fetcher);
}

async function batchRetrieve(ids: string[], fetcher?: typeof fetch) {
  const result = await squareRequest<{ objects?: CatalogObject[] }>("catalog/batch-retrieve", {
    method: "POST",
    fetcher,
    body: { object_ids: ids, include_related_objects: false, include_deleted_objects: false },
  });
  return new Map((result.objects || []).map((object) => [object.id, object]));
}

// The pricing rule and the discount and product set it uses, when this admin can edit them.
async function editablePromotion(ruleId: string, fetcher?: typeof fetch) {
  const { object: rule } = await retrieveObject(ruleId, fetcher);
  const data = rule?.pricing_rule_data;
  if (!rule || rule.type !== "PRICING_RULE" || rule.is_deleted || !data) throw new ShopAdminError("This promotion no longer exists in Square. Refresh the list.", 404);
  const linked = await batchRetrieve(uniqueIds([data.discount_id, data.match_products_id]), fetcher);
  const set = linked.get(data.match_products_id || "");
  const known = new Map<string, CatalogObject>([[rule.id, rule], ...linked]);
  const ids = set?.product_set_data?.product_ids_any || [];
  if (ids.length) for (const [id, object] of await batchRetrieve(ids, fetcher)) known.set(id, object);
  if (!toAdminPromotion(rule, known, shopToday()).editable) throw new ShopAdminError("This promotion has conditions set in Square. Change it in the Square dashboard.", 409);
  return { rule, discount: linked.get(data.discount_id || "")!, set: set! };
}

export async function savePromotion(ruleId: string, input: PromotionInput, fetcher?: typeof fetch) {
  const discountData: DiscountData = { name: input.name, discount_type: "FIXED_PERCENTAGE", percentage: String(input.percentage), modify_tax_basis: "MODIFY_TAX_BASIS" };
  const setData: ProductSetData = input.allProducts
    ? { name: input.name, all_products: true }
    : { name: input.name, product_ids_any: uniqueIds([...input.categoryIds, ...input.productIds]) };
  const dates: PricingRuleData = { valid_from_date: input.startsOn, ...(input.endsOn ? { valid_until_date: input.endsOn } : {}) };
  let objects: CatalogObject[];
  if (!ruleId) {
    objects = [
      { id: "#discount", type: "DISCOUNT", discount_data: discountData },
      { id: "#products", type: "PRODUCT_SET", product_set_data: setData },
      { id: "#rule", type: "PRICING_RULE", pricing_rule_data: { name: input.name, discount_id: "#discount", match_products_id: "#products", ...dates } },
    ];
  } else {
    const { rule, discount, set } = await editablePromotion(ruleId, fetcher);
    const ruleData: PricingRuleData = { ...rule.pricing_rule_data, name: input.name };
    delete ruleData.valid_from_date;
    delete ruleData.valid_until_date;
    objects = [
      { ...discount, discount_data: { ...discount.discount_data, ...discountData } },
      { ...set, product_set_data: setData },
      { ...rule, pricing_rule_data: { ...ruleData, ...dates } },
    ];
  }
  const result = await squareRequest<{ objects?: CatalogObject[]; id_mappings?: Array<{ client_object_id?: string; object_id?: string }> }>("catalog/batch-upsert", {
    method: "POST",
    fetcher,
    body: { idempotency_key: crypto.randomUUID(), batches: [{ objects }] },
  });
  const id = ruleId || result.id_mappings?.find((mapping) => mapping.client_object_id === "#rule")?.object_id || "";
  if (!id) throw new Error("Square did not return the saved promotion.");
  return id;
}

// Removes the pricing rule with its discount and product set, so nothing of
// the promotion is left at the till.
export async function deletePromotion(ruleId: string, fetcher?: typeof fetch) {
  const { rule, discount, set } = await editablePromotion(ruleId, fetcher);
  await squareRequest("catalog/batch-delete", { method: "POST", fetcher, body: { object_ids: [rule.id, set.id, discount.id] } });
}
