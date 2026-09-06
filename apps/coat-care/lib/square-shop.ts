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

type CatalogObject = {
  id: string;
  type: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    description?: string;
    description_plaintext?: string;
    image_ids?: string[];
    category_id?: string;
    categories?: Array<{ id?: string }>;
    reporting_category?: { id?: string };
    variations?: Array<{ id: string; item_variation_data?: { name?: string; price_money?: Money } }>;
  };
  image_data?: { url?: string };
  category_data?: { name?: string };
};

type CatalogSearchResult = { objects?: CatalogObject[]; related_objects?: CatalogObject[] };
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

// Pure transform: fold a Square catalog search (items + related images and
// categories) into a flat, front-end friendly product list. One product per
// item, priced from its first priced variation.
export function normalizeCatalog(objects: CatalogObject[] = [], related: CatalogObject[] = []): ShopProduct[] {
  const images = new Map<string, string>();
  const categories = new Map<string, string>();
  for (const object of [...related, ...objects]) {
    if (object.type === "IMAGE" && object.image_data?.url) images.set(object.id, object.image_data.url);
    if (object.type === "CATEGORY" && object.category_data?.name) categories.set(object.id, object.category_data.name);
  }

  const products: ShopProduct[] = [];
  for (const object of objects) {
    if (object.type !== "ITEM" || object.is_deleted) continue;
    const item = object.item_data;
    if (!item) continue;
    const variation = (item.variations || []).find(
      (candidate) => typeof candidate.item_variation_data?.price_money?.amount === "number",
    );
    if (!variation) continue;
    const price = variation.item_variation_data!.price_money!;
    const categoryId = item.reporting_category?.id || item.categories?.[0]?.id || item.category_id || "";
    const imageId = item.image_ids?.[0] || "";
    products.push({
      id: variation.id,
      itemId: object.id,
      name: item.name || "Article",
      description: item.description_plaintext || item.description || "",
      priceCents: Number(price.amount) || 0,
      currency: price.currency || "CAD",
      imageUrl: images.get(imageId) || "",
      category: categories.get(categoryId) || "Boutique",
    });
  }
  return products;
}

export async function fetchShopCatalog(fetcher?: typeof fetch): Promise<ShopProduct[]> {
  const result = await squareRequest<CatalogSearchResult>("catalog/search-catalog-objects", {
    method: "POST",
    fetcher,
    body: { object_types: ["ITEM"], include_related_objects: true, include_deleted_objects: false },
  });
  return normalizeCatalog(result.objects || [], result.related_objects || []);
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
    if (quantity < 1) continue;
    merged.set(id, Math.min(99, (merged.get(id) || 0) + quantity));
  }
  return [...merged.entries()].map(([id, quantity]) => ({ id, quantity }));
}

export async function createShopCheckout(
  items: CheckoutItem[],
  options: { fetcher?: typeof fetch; redirectUrl?: string } = {},
): Promise<{ url: string; items: CheckoutItem[] }> {
  const shop = shopConfig();
  if (!shop.configured) throw new Error("La boutique Square n'est pas encore configurée.");

  // Validate against the live catalog so only real, current variations reach
  // Square and a stale or tampered cart id is rejected cleanly.
  const catalog = await fetchShopCatalog(options.fetcher);
  const allowed = new Set(catalog.map((product) => product.id));
  const cleaned = sanitizeCartItems(items, allowed);
  if (!cleaned.length) throw new Error("Aucun article valide dans le panier.");

  const body = buildPaymentLinkBody(cleaned, {
    locationId: shop.locationId,
    idempotencyKey: crypto.randomUUID(),
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
