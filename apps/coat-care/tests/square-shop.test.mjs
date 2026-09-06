import assert from "node:assert/strict";
import test from "node:test";

// squareRequest reads these at call time; set before importing the module.
process.env.SQUARE_ACCESS_TOKEN = "test-token";
process.env.SQUARE_LOCATION_ID = "LOC123";
process.env.SQUARE_API_VERSION = "2026-07-15";

const {
  normalizeCatalog,
  buildPaymentLinkBody,
  sanitizeCartItems,
  fetchShopCatalog,
  createShopCheckout,
  shopConfig,
} = await import("../lib/square-shop.ts");

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
  };
}

const sampleCatalog = {
  objects: [
    {
      id: "ITEM_1",
      type: "ITEM",
      item_data: {
        name: "Shampooing doux",
        description: "Nettoie en douceur.",
        image_ids: ["IMG_1"],
        categories: [{ id: "CAT_1" }],
        variations: [
          { id: "VAR_1", item_variation_data: { name: "Régulier", price_money: { amount: 2400, currency: "CAD" } } },
        ],
      },
    },
    {
      id: "ITEM_NO_PRICE",
      type: "ITEM",
      item_data: {
        name: "Sans prix",
        variations: [{ id: "VAR_X", item_variation_data: { name: "n/a" } }],
      },
    },
    {
      id: "ITEM_DELETED",
      type: "ITEM",
      is_deleted: true,
      item_data: { name: "Retiré", variations: [{ id: "VAR_D", item_variation_data: { price_money: { amount: 100, currency: "CAD" } } }] },
    },
  ],
  related_objects: [
    { id: "IMG_1", type: "IMAGE", image_data: { url: "https://squarecdn.test/img1.jpg" } },
    { id: "CAT_1", type: "CATEGORY", category_data: { name: "Soins" } },
  ],
};

test("normalizeCatalog maps items to priced products with images and categories", () => {
  const products = normalizeCatalog(sampleCatalog.objects, sampleCatalog.related_objects);
  assert.equal(products.length, 1, "only the priced, non-deleted item is kept");
  assert.deepEqual(products[0], {
    id: "VAR_1",
    itemId: "ITEM_1",
    name: "Shampooing doux",
    description: "Nettoie en douceur.",
    priceCents: 2400,
    currency: "CAD",
    imageUrl: "https://squarecdn.test/img1.jpg",
    category: "Soins",
  });
});

test("normalizeCatalog falls back gracefully when image/category are missing", () => {
  const products = normalizeCatalog(
    [{ id: "I", type: "ITEM", item_data: { name: "X", variations: [{ id: "V", item_variation_data: { price_money: { amount: 500, currency: "USD" } } }] } }],
    [],
  );
  assert.equal(products[0].imageUrl, "");
  assert.equal(products[0].category, "Boutique");
  assert.equal(products[0].currency, "USD");
});

test("sanitizeCartItems merges duplicates, clamps quantity and filters unknown ids", () => {
  const allowed = new Set(["VAR_1", "VAR_2"]);
  const cleaned = sanitizeCartItems(
    [
      { id: "VAR_1", quantity: 2 },
      { id: "VAR_1", quantity: 3 },
      { id: "VAR_2", quantity: 200 },
      { id: "GHOST", quantity: 1 },
      { id: "VAR_2", quantity: 0 },
    ],
    allowed,
  );
  assert.deepEqual(cleaned, [
    { id: "VAR_1", quantity: 5 },
    { id: "VAR_2", quantity: 99 },
  ]);
});

test("buildPaymentLinkBody omits prices and lets Square resolve them from the catalog", () => {
  const body = buildPaymentLinkBody(
    [{ id: "VAR_1", quantity: 2 }, { id: "VAR_2", quantity: 1 }],
    { locationId: "LOC123", idempotencyKey: "key-1", redirectUrl: "https://bopoil.ca/boutique.html?commande=reussie" },
  );
  assert.equal(body.idempotency_key, "key-1");
  assert.equal(body.order.location_id, "LOC123");
  assert.deepEqual(body.order.line_items, [
    { quantity: "2", catalog_object_id: "VAR_1" },
    { quantity: "1", catalog_object_id: "VAR_2" },
  ]);
  assert.equal(body.checkout_options.redirect_url, "https://bopoil.ca/boutique.html?commande=reussie");
  const serializedLines = JSON.stringify(body.order.line_items);
  assert.ok(!serializedLines.includes("price"), "line items must not carry a client-supplied price");
  assert.ok(!serializedLines.includes("amount"), "line items must not carry a client-supplied amount");
});

test("shopConfig is only configured with both a token and a location", () => {
  assert.equal(shopConfig({ accessToken: "t", externalLocationId: "L" }).configured, true);
  assert.equal(shopConfig({ accessToken: "t", externalLocationId: "" }).configured, false);
  assert.equal(shopConfig({ accessToken: "", externalLocationId: "L" }).configured, false);
});

test("fetchShopCatalog posts a catalog search and returns normalized products", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(sampleCatalog);
  };
  const products = await fetchShopCatalog(fetcher);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /catalog\/search-catalog-objects$/);
  assert.equal(calls[0].init.method, "POST");
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.object_types, ["ITEM"]);
  assert.equal(sent.include_related_objects, true);
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "VAR_1");
});

test("createShopCheckout validates the cart against Square and returns a payment link", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("catalog/search-catalog-objects")) return jsonResponse(sampleCatalog);
    if (href.endsWith("online-checkout/payment-links")) {
      const sent = JSON.parse(init.body);
      assert.equal(sent.order.location_id, "LOC123");
      assert.deepEqual(sent.order.line_items, [{ quantity: "2", catalog_object_id: "VAR_1" }]);
      return jsonResponse({ payment_link: { id: "PL_1", url: "https://square.link/u/pay123" } });
    }
    throw new Error(`unexpected request: ${href}`);
  };

  const result = await createShopCheckout(
    [{ id: "VAR_1", quantity: 2 }, { id: "GHOST", quantity: 5 }],
    { fetcher, redirectUrl: "https://bopoil.ca/boutique.html?commande=reussie" },
  );
  assert.equal(result.url, "https://square.link/u/pay123");
  assert.deepEqual(result.items, [{ id: "VAR_1", quantity: 2 }]);
  assert.ok(calls.some((c) => c.endsWith("catalog/search-catalog-objects")));
  assert.ok(calls.some((c) => c.endsWith("online-checkout/payment-links")));
});

test("createShopCheckout rejects a cart with no valid Square items", async () => {
  const fetcher = async (url) => {
    if (String(url).endsWith("catalog/search-catalog-objects")) return jsonResponse(sampleCatalog);
    throw new Error("should not create a payment link for an empty cart");
  };
  await assert.rejects(
    () => createShopCheckout([{ id: "GHOST", quantity: 1 }], { fetcher }),
    /Aucun article valide/,
  );
});
