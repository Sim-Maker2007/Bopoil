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
  category: string;
};

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
    variations?: Array<Availability & { id: string; item_variation_data?: { name?: string; sellable?: boolean; pricing_type?: string; price_money?: Money; location_overrides?: Array<{ location_id?: string; price_money?: Money; sold_out?: boolean }> } }>;
  };
  image_data?: { url?: string };
  category_data?: { name?: string };
};

type CatalogSearchResult = { objects?: CatalogObject[]; related_objects?: CatalogObject[]; cursor?: string };
type PaymentLinkResult = { payment_link?: { id?: string; url?: string; long_url?: string } };

export type ShopConfig = ReturnType<typeof shopConfig>;

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
  const images = new Map<string, string>();
  const categories = new Map<string, string>();
  for (const object of [...related, ...objects]) {
    if (object.type === "IMAGE" && object.image_data?.url) images.set(object.id, object.image_data.url);
    if (object.type === "CATEGORY" && object.category_data?.name) categories.set(object.id, object.category_data.name);
  }
  const products: ShopProduct[] = [];
  for (const object of objects) {
    if (object.type !== "ITEM" || !availableAt(object, locationId)) continue;
    const item = object.item_data;
    // Appointment services, gift cards and archived items are not retail goods.
    if (!item || item.is_archived || (item.product_type && item.product_type !== "REGULAR")) continue;
    const categoryId = item.reporting_category?.id || item.categories?.[0]?.id || item.category_id || "";
    for (const variation of item.variations || []) {
      const data = variation.item_variation_data;
      if (!availableAt(variation, locationId) || !data || data.sellable === false || data.pricing_type === "VARIABLE_PRICING") continue;
      const override = data.location_overrides?.find((entry) => entry.location_id === locationId);
      if (override?.sold_out) continue;
      const price = override?.price_money || data.price_money;
      if (!price || !Number.isSafeInteger(price.amount) || price.amount! < 0) continue;
      const variationName = data.name && !/^(regular|régulier|default)$/i.test(data.name) ? data.name : "";
      products.push({
        id: variation.id,
        itemId: object.id,
        name: (item.name || "Article") + (variationName ? ` — ${variationName}` : ""),
        description: item.description_plaintext || (item.description || "").replace(/<[^>]*>/g, ""),
        priceCents: price.amount!,
        currency: price.currency || "CAD",
        imageUrl: images.get(item.image_ids?.[0] || "") || "",
        category: categories.get(categoryId) || "Boutique",
      });
    }
  }
  return products;
}

export async function fetchShopCatalog(fetcher?: typeof fetch): Promise<ShopProduct[]> {
  const objects: CatalogObject[] = [];
  const related: CatalogObject[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const result = await squareRequest<CatalogSearchResult>("catalog/search", {
      method: "POST",
      fetcher,
      body: { object_types: ["ITEM"], include_related_objects: true, include_deleted_objects: false, ...(cursor ? { cursor } : {}) },
    });
    objects.push(...result.objects || []);
    related.push(...result.related_objects || []);
    cursor = result.cursor;
    if (cursor && seen.has(cursor)) throw new Error("Le catalogue ne peut pas être chargé entièrement.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return normalizeCatalog(objects, related, shopConfig().locationId);
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
