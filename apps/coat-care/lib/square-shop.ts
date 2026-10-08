import { squareConfig, squareRequest } from "./square.ts";

// Retail boutique layer on top of Square. Products, prices and images come
// from the Square Catalog; checkout is a Square-hosted Online Checkout payment
// link, so card data and payment never touch this application. The salon
// curates everything in its Square dashboard.

export type ShopProduct = {
  id: string; // Square catalog item-variation id — the id used at checkout
  itemId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  imageUrl: string;
  imageUrls: string[];
  category: string; // primary (reporting) category, shown on the product badge
  categories: string[]; // every Square category the item is filed under, primary first
  brands: string[]; // brand read from the item name, plus any category named after a brand
  itemName: string; // the item alone, shared by all of its variations
  variation: string; // the variation's own name ("M Vert", "250g"), "" when it has none
  options: ShopOption[]; // what sets the variation apart from the item's others; empty for an item sold one way
};

// One choice that sets a variation apart, e.g. { name: "Couleur", value: "Bleu",
// swatch: "#2f6db5" }. The swatch is a hex colour, "camo" for the camouflage
// pattern, or "" when the choice is not a colour.
export type ShopOption = { name: string; value: string; swatch: string };

// A category used by at least one listed product, with the photo set on the
// category in Square ("" when it has none).
export type ShopCategory = { name: string; imageUrl: string };

type Money = { amount?: number; currency?: string };

type Availability = {
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
};

type CatalogObject = Availability & {
  id: string;
  type: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    product_type?: string;
    is_archived?: boolean;
    description?: string;
    description_plaintext?: string;
    image_ids?: string[];
    category_id?: string;
    categories?: Array<{ id?: string }>;
    reporting_category?: { id?: string };
    variations?: Array<Availability & { id: string; item_variation_data?: { name?: string; sellable?: boolean; pricing_type?: string; price_money?: Money; image_ids?: string[]; item_option_values?: Array<{ item_option_id?: string; item_option_value_id?: string }>; location_overrides?: Array<{ location_id?: string; price_money?: Money; sold_out?: boolean }> } }>;
  };
  image_data?: { url?: string };
  category_data?: { name?: string; image_ids?: string[] };
  item_option_data?: { name?: string; display_name?: string; show_colors?: boolean; values?: Array<{ id: string; item_option_value_data?: { name?: string; color?: string } }> };
};

type CatalogSearchResult = { objects?: CatalogObject[]; related_objects?: CatalogObject[]; cursor?: string };
type PaymentLinkResult = { payment_link?: { id?: string; url?: string; long_url?: string } };

export type ShopConfig = ReturnType<typeof shopConfig>;

// Square's French dashboard labels the default variation "Article de base".
// English dashboards use Regular / Default. None of those belong on a storefront title.
const GENERIC_VARIATION = /^(regular|r[ée]gulier|default|standard|article de base)(\s+(item|variation))?$/i;

function genericVariationName(name = "") {
  return GENERIC_VARIATION.test(name.trim());
}

function shopDisplayName(itemName = "", variationName = "") {
  const base = itemName.replace(/\s*[—–-]\s*article de base\s*$/i, "").trim() || "Article";
  if (!variationName || genericVariationName(variationName)) return base;
  return `${base} — ${variationName}`;
}

// Square has no brand field. The salon names retail items "BRAND Product"
// (« SMACK Chiens Poulet — 25g », « DOGMÄ Lotion Yeux 120ml »), so the brand is
// the run of words in capitals that opens the name. Abbreviations used in
// item names are spelled out here, keyed by the whole brand or its first word.
const BRAND_ALIASES: Record<string, string> = {
  LB: "Lucky Bones",
  "LB-C": "Lucky Bones",
  "LB-D": "Lucky Bones",
  TRIX: "TRIXIE",
  GF: "GF PET",
};
const BRAND_FIRST_WORD = /^[\p{Lu}\d][\p{Lu}\d'’+.-]*$/u;
const BRAND_NEXT_WORD = /^(&|\p{Lu}[\p{Lu}'’-]*)$/u;

export function brandFromName(name = "") {
  const words = name.replace(/^[^\p{L}\d]+/u, "").split(/\s+/);
  // A name made of the brand alone has no product part to tell them apart.
  if (words.length < 2 || !BRAND_FIRST_WORD.test(words[0]) || !/\p{Lu}/u.test(words[0])) return "";
  let end = 1;
  while (end < words.length - 1 && BRAND_NEXT_WORD.test(words[end])) end++;
  while (words[end - 1] === "&") end--;
  const brand = words.slice(0, end).join(" ");
  return BRAND_ALIASES[brand] || BRAND_ALIASES[words[0]] || brand;
}

function brandKey(name: string) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Settles each product's brands across the whole catalog: « BACI » and
// « BACI+ » are one brand shown with its most common spelling, a line such as
// « ZEUS NOSH » files under « ZEUS », and a Square category named after a
// brand (« Lucky Bones ») adds its products to that brand.
function groupBrands(products: ShopProduct[]) {
  const keys = new Set(products.flatMap((product) => product.brands.map(brandKey)));
  const grouped = (brand: string) => {
    const first = brand.split(" ")[0];
    return first !== brand && keys.has(brandKey(first)) ? first : brand;
  };
  const spellings = new Map<string, Map<string, number>>();
  for (const product of products) {
    for (const brand of product.brands.map(grouped)) {
      const counts = spellings.get(brandKey(brand)) || new Map<string, number>();
      counts.set(brand, (counts.get(brand) || 0) + 1);
      spellings.set(brandKey(brand), counts);
    }
  }
  const display = new Map([...spellings].map(([key, counts]) => [key, [...counts].sort((a, b) => b[1] - a[1])[0][0]]));
  for (const product of products) {
    product.brands = uniqueIds([...product.brands.map(grouped), ...product.categories].map((name) => display.get(brandKey(name))));
  }
  return products;
}

// Colours written in Square variation names (unaccented, lowercase), drawn as swatches.
const SWATCHES: Record<string, string> = {
  "bleu fonce": "#1f3466",
  "bleu marine": "#1d2b4f",
  "bleu pale": "#9cc3e6",
  marine: "#1d2b4f",
  bleu: "#2f6db5",
  vert: "#3c8d4a",
  noir: "#141414",
  noire: "#141414",
  rose: "#e58fb1",
  rouge: "#c8312f",
  mauve: "#9b6bb5",
  violet: "#6e3fa3",
  jaune: "#f2c94c",
  beige: "#d9c7a7",
  gris: "#9a9a9a",
  grise: "#9a9a9a",
  blanc: "#ffffff",
  blanche: "#ffffff",
  brun: "#7a4e2d",
  brune: "#7a4e2d",
  orange: "#ef8a2b",
  turquoise: "#2bb3b1",
  argent: "#c0c0c0",
  camo: "camo",
};
const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
// Clothing sizes as the salon writes them: S, M, XL, 3XL, S/P, L/G…
const SIZE_WORD = /^\(?(\d?X{0,3}[SML]|XXS|XS|S\/P|M\/M|L\/G|XL\/TG|TP|TG)\)?$/i;
// Weights, volumes and packs: 250g, 1 L, 3.5 lbs, Paquet (5), Unité.
const FORMAT = /^(\d+([.,]\d+)?\s?(mg|g|kg|ml|l|lbs?|oz)|paquets?\b.*|unites?)$/;
const OPTION_ORDER = ["Couleur", "Taille", "Format", "Modèle"];

function plain(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function colorSwatch(value = "") {
  const words = plain(value).split(/\s+/);
  return SWATCHES[words.slice(0, 2).join(" ")] || SWATCHES[words[0]] || "";
}

function capitalized(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Reads the choices out of a variation name: « M Vert » is a size and a
// colour, « 250g » a format. Whatever is left over is a « Modèle ».
export function parseVariationName(name = ""): Record<string, string> {
  if (FORMAT.test(plain(name))) return { Format: name.trim() };
  const words = name.split(/\s+/).filter(Boolean);
  const parts: Record<string, string> = {};
  const at = words.findIndex((word) => SIZE_WORD.test(word));
  if (at !== -1) parts.Taille = words.splice(at, 1)[0].replace(/[()]/g, "").toUpperCase();
  const rest = capitalized(words.join(" "));
  if (rest) parts[FORMAT.test(plain(rest)) ? "Format" : colorSwatch(rest) ? "Couleur" : "Modèle"] = rest;
  return parts;
}

type SquareOptions = Map<string, { name: string; colors: boolean; values: Map<string, { name: string; color: string }> }>;

function indexItemOptions(objects: CatalogObject[]): SquareOptions {
  const options: SquareOptions = new Map();
  for (const object of objects) {
    const data = object.type === "ITEM_OPTION" ? object.item_option_data : undefined;
    if (!data) continue;
    const values = new Map((data.values || []).map((value) => [value.id, { name: value.item_option_value_data?.name || "", color: value.item_option_value_data?.color || "" }]));
    options.set(object.id, { name: data.display_name || data.name || "", colors: Boolean(data.show_colors), values });
  }
  return options;
}

// The choices set with Square's own item options (Couleur, Taille…), or null
// when the variation has none or one cannot be resolved.
function squareOptionChoices(values: Array<{ item_option_id?: string; item_option_value_id?: string }> = [], options: SquareOptions) {
  if (!values.length) return null;
  const choices: ShopOption[] = [];
  for (const entry of values) {
    const option = options.get(entry.item_option_id || "");
    const value = option?.values.get(entry.item_option_value_id || "");
    if (!option?.name || !value?.name) return null;
    const swatch = option.colors && HEX_COLOR.test(value.color) ? value.color.slice(0, 7) : option.colors ? colorSwatch(value.name) : "";
    choices.push({ name: option.name, value: value.name, swatch });
  }
  return choices;
}

// The choices that set each listed variation of one item apart. Square item
// options are used when every variation has them; otherwise the variation
// names are split into colour, size and format. When the names do not split
// cleanly, each whole name is one choice.
function variantOptions(variations: Array<{ label: string; square: ShopOption[] | null }>): ShopOption[][] {
  if (variations.length < 2) return variations.map(() => []);
  if (variations.every((variation) => variation.square)) return variations.map((variation) => variation.square!);
  const parsed = variations.map((variation) => parseVariationName(variation.label));
  const names = OPTION_ORDER.filter((name) => parsed.some((parts) => name in parts));
  const varying = names.filter((name) => new Set(parsed.map((parts) => parts[name])).size > 1);
  const keys = parsed.map((parts) => varying.map((name) => parts[name]).join("\u0000"));
  const clean = varying.length && parsed.every((parts) => names.every((name) => name in parts)) && new Set(keys).size === keys.length;
  if (clean) {
    return parsed.map((parts) => varying.map((name) => ({ name, value: parts[name], swatch: name === "Couleur" ? colorSwatch(parts[name]) : "" })));
  }
  const kinds = new Set(parsed.map((parts) => Object.keys(parts).join()));
  const name = kinds.size === 1 && (kinds.has("Format") || kinds.has("Couleur")) ? [...kinds][0] : "Modèle";
  return variations.map((variation) => [{ name, value: variation.label, swatch: name === "Couleur" ? colorSwatch(variation.label) : "" }]);
}

function httpsUrl(url = "") {
  return /^https:\/\//i.test(url) ? url : "";
}

function indexCatalogImages(objects: CatalogObject[] = []) {
  const images = new Map<string, string>();
  for (const object of objects) {
    const url = object.type === "IMAGE" ? httpsUrl(object.image_data?.url) : "";
    if (url) images.set(object.id, url);
  }
  return images;
}

function uniqueIds(ids: Array<string | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

function variationImageIds(item: NonNullable<CatalogObject["item_data"]>, variationId: string) {
  const variation = item.variations?.find((entry) => entry.id === variationId);
  return uniqueIds([...(variation?.item_variation_data?.image_ids || []), ...(item.image_ids || [])]);
}

function catalogImageIds(objects: CatalogObject[] = []) {
  return uniqueIds(objects.flatMap((object) => {
    if (object.type === "CATEGORY") return object.category_data?.image_ids || [];
    if (object.type !== "ITEM" || !object.item_data) return [];
    return [
      ...(object.item_data.image_ids || []),
      ...(object.item_data.variations || []).flatMap((variation) => variation.item_variation_data?.image_ids || []),
    ];
  }));
}

async function retrieveMissingImages(ids: string[], images: Map<string, string>, fetcher?: typeof fetch) {
  const missing = ids.filter((id) => !images.has(id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const result = await squareRequest<{ objects?: CatalogObject[] }>("catalog/batch-retrieve", {
      method: "POST",
      fetcher,
      body: { object_ids: missing.slice(offset, offset + 100), include_related_objects: false, include_deleted_objects: false },
    });
    for (const [id, url] of indexCatalogImages(result.objects || [])) images.set(id, url);
  }
}

export function shopConfig(config = squareConfig()) {
  return {
    hasToken: Boolean(config.accessToken),
    locationId: config.externalLocationId,
    // A location is required to build orders and payment links, so both the
    // token and the location id must be present before the store is live.
    configured: Boolean(config.accessToken && config.externalLocationId),
  };
}

// Respect location availability for both the item and each sellable variation.
function availableAt(object: Availability, locationId: string) {
  if (object.is_deleted) return false;
  if (!locationId) return true;
  if (object.absent_at_location_ids?.includes(locationId)) return false;
  return object.present_at_all_locations !== false || Boolean(object.present_at_location_ids?.includes(locationId));
}

export function normalizeCatalog(objects: CatalogObject[] = [], related: CatalogObject[] = [], locationId = ""): ShopProduct[] {
  const images = indexCatalogImages([...related, ...objects]);
  const categories = new Map<string, string>();
  for (const object of [...related, ...objects]) {
    if (object.type === "CATEGORY" && object.category_data?.name) categories.set(object.id, object.category_data.name);
  }
  const itemOptions = indexItemOptions([...related, ...objects]);
  const products: ShopProduct[] = [];
  for (const object of objects) {
    if (object.type !== "ITEM" || !availableAt(object, locationId)) continue;
    const item = object.item_data;
    // Appointment services, gift cards and archived items are not retail goods.
    if (!item || item.is_archived || (item.product_type && item.product_type !== "REGULAR")) continue;
    const categoryNames = uniqueIds([
      item.reporting_category?.id,
      ...(item.categories || []).map((entry) => entry.id),
      item.category_id,
    ].map((id) => (id && categories.get(id)) || ""));
    const itemCategories = categoryNames.length ? categoryNames : ["Boutique"];
    const nameBrand = brandFromName(item.name);
    const listed: Array<{ product: ShopProduct; label: string; square: ShopOption[] | null }> = [];
    for (const variation of item.variations || []) {
      const data = variation.item_variation_data;
      if (!availableAt(variation, locationId) || !data || data.sellable === false || data.pricing_type === "VARIABLE_PRICING") continue;
      const override = data.location_overrides?.find((entry) => entry.location_id === locationId);
      if (override?.sold_out) continue;
      const price = override?.price_money || data.price_money;
      if (!price || !Number.isSafeInteger(price.amount) || price.amount! < 0) continue;
      const imageUrls = variationImageIds(item, variation.id).map((id) => images.get(id) || "").filter(Boolean);
      const variationName = genericVariationName(data.name) ? "" : (data.name || "").trim();
      listed.push({ label: variationName || "Standard", square: squareOptionChoices(data.item_option_values, itemOptions), product: {
        id: variation.id,
        itemId: object.id,
        name: shopDisplayName(item.name || "Article", data.name || ""),
        description: item.description_plaintext || (item.description || "").replace(/<[^>]*>/g, ""),
        priceCents: price.amount!,
        currency: price.currency || "CAD",
        imageUrl: imageUrls[0] || "",
        imageUrls,
        category: itemCategories[0],
        categories: itemCategories,
        brands: nameBrand ? [nameBrand] : [],
        itemName: shopDisplayName(item.name || "Article"),
        variation: variationName,
        options: [],
      } });
    }
    const options = variantOptions(listed);
    listed.forEach((entry, index) => products.push({ ...entry.product, options: options[index] }));
  }
  return groupBrands(products);
}

export function normalizeCategories(objects: CatalogObject[] = [], related: CatalogObject[] = [], products: ShopProduct[] = []): ShopCategory[] {
  const images = indexCatalogImages([...related, ...objects]);
  const used = new Set(products.flatMap((product) => product.categories));
  const photos = new Map<string, string>();
  for (const object of [...related, ...objects]) {
    const name = object.type === "CATEGORY" ? object.category_data?.name || "" : "";
    if (!used.has(name) || photos.get(name)) continue;
    photos.set(name, (object.category_data?.image_ids || []).map((id) => images.get(id) || "").find(Boolean) || "");
  }
  return [...used].map((name) => ({ name, imageUrl: photos.get(name) || "" }));
}

export async function fetchShop(fetcher?: typeof fetch): Promise<{ products: ShopProduct[]; categories: ShopCategory[] }> {
  const objects: CatalogObject[] = [];
  const related: CatalogObject[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const result = await squareRequest<CatalogSearchResult>("catalog/search", {
      method: "POST",
      fetcher,
      // Square's related_objects only carry an item's reporting category, so the
      // categories themselves are listed too to name every category an item is in,
      // and so are the item options (Couleur, Taille…) that name variations.
      body: { object_types: ["ITEM", "CATEGORY", "ITEM_OPTION"], include_related_objects: true, include_deleted_objects: false, ...(cursor ? { cursor } : {}) },
    });
    objects.push(...result.objects || []);
    related.push(...result.related_objects || []);
    cursor = result.cursor;
    if (cursor && seen.has(cursor)) throw new Error("Le catalogue ne peut pas être chargé entièrement.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  const images = indexCatalogImages([...related, ...objects]);
  try {
    await retrieveMissingImages(catalogImageIds(objects), images, fetcher);
  } catch {
    // Search often returns only the first IMAGE in related_objects. Extra photos
    // are worth a second fetch, but the catalog should still load without them.
  }
  related.push(...[...images.entries()].map(([id, url]) => ({ id, type: "IMAGE", image_data: { url } })));
  const products = normalizeCatalog(objects, related, shopConfig().locationId);
  return { products, categories: normalizeCategories(objects, related, products) };
}

export async function fetchShopCatalog(fetcher?: typeof fetch): Promise<ShopProduct[]> {
  return (await fetchShop(fetcher)).products;
}

export type CheckoutItem = { id: string; quantity: number };

// Pure transform: cart lines -> Square Online Checkout payment-link request.
// Prices are intentionally omitted; Square resolves them from the catalog so
// the client can never set its own price.
export function buildPaymentLinkBody(
  items: CheckoutItem[],
  options: { locationId: string; idempotencyKey: string; redirectUrl?: string },
) {
  return {
    idempotency_key: options.idempotencyKey,
    order: {
      location_id: options.locationId,
      pricing_options: { auto_apply_taxes: true },
      line_items: items.map((item) => ({ quantity: String(item.quantity), catalog_object_id: item.id })),
    },
    checkout_options: {
      ask_for_shipping_address: false,
      ...(options.redirectUrl ? { redirect_url: options.redirectUrl } : {}),
    },
  };
}

export function sanitizeCartItems(input: unknown, allowed?: Set<string>): CheckoutItem[] {
  const rows = Array.isArray(input) ? input : [];
  const merged = new Map<string, number>();
  for (const row of rows) {
    const id = String((row as { id?: unknown })?.id || "").trim();
    if (!id || (allowed && !allowed.has(id))) continue;
    const quantity = Math.floor(Number((row as { quantity?: unknown })?.quantity) || 0);
    if (!Number.isFinite(quantity) || quantity < 1) continue;
    merged.set(id, Math.min(99, (merged.get(id) || 0) + quantity));
  }
  return [...merged.entries()].map(([id, quantity]) => ({ id, quantity }));
}

export async function createShopCheckout(
  items: CheckoutItem[],
  options: { fetcher?: typeof fetch; redirectUrl?: string; idempotencyKey?: string } = {},
): Promise<{ url: string; items: CheckoutItem[] }> {
  const shop = shopConfig();
  if (!shop.configured) throw new Error("La boutique Square n'est pas encore configurée.");

  // Validate against the live catalog so only real, current variations reach
  // Square and a stale or tampered cart id is rejected cleanly.
  const catalog = await fetchShopCatalog(options.fetcher);
  const allowed = new Set(catalog.map((product) => product.id));
  const requested = sanitizeCartItems(items);
  const cleaned = sanitizeCartItems(requested, allowed);
  if (!cleaned.length) throw new Error("Aucun article valide dans le panier.");
  if (cleaned.length !== requested.length) throw new Error("Un article n’est plus disponible. Actualisez la boutique et vérifiez votre panier avant de payer.");
  const currencies = new Set(catalog.filter((product) => cleaned.some((item) => item.id === product.id)).map((product) => product.currency));
  if (currencies.size !== 1) throw new Error("Les articles du panier doivent utiliser la même devise.");

  const body = buildPaymentLinkBody(cleaned, {
    locationId: shop.locationId,
    idempotencyKey: options.idempotencyKey || crypto.randomUUID(),
    redirectUrl: options.redirectUrl,
  });
  const result = await squareRequest<PaymentLinkResult>("online-checkout/payment-links", {
    method: "POST",
    fetcher: options.fetcher,
    body,
  });
  const url = result.payment_link?.url || result.payment_link?.long_url || "";
  if (!url) throw new Error("Square n'a pas retourné de lien de paiement.");
  return { url, items: cleaned };
}
