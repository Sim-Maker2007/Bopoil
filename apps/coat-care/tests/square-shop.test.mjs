import assert from "node:assert/strict";
import test from "node:test";

// squareRequest reads these at call time; set before importing the module.
process.env.SQUARE_ACCESS_TOKEN = "test-token";
process.env.SQUARE_LOCATION_ID = "LOC123";
process.env.SQUARE_API_VERSION = "2026-07-15";

const {
  brandFromName,
  normalizeCatalog,
  normalizeCategories,
  fetchShop,
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
    imageUrls: ["https://squarecdn.test/img1.jpg"],
    category: "Soins",
    categories: ["Soins"],
    brands: [],
  });
});

test("normalizeCatalog files a product under every Square category, reporting category first", () => {
  const products = normalizeCatalog(
    [
      {
        id: "ITEM_TREAT",
        type: "ITEM",
        item_data: {
          name: "Gâterie au saumon",
          reporting_category: { id: "CAT_BRAND" },
          categories: [{ id: "CAT_TREATS" }, { id: "CAT_BRAND" }, { id: "CAT_DOGS" }, { id: "CAT_GONE" }],
          variations: [{ id: "VAR_T", item_variation_data: { price_money: { amount: 899, currency: "CAD" } } }],
        },
      },
      {
        id: "ITEM_UNREPORTED",
        type: "ITEM",
        item_data: {
          name: "Brosse",
          categories: [{ id: "CAT_DOGS" }],
          variations: [{ id: "VAR_B", item_variation_data: { price_money: { amount: 1999, currency: "CAD" } } }],
        },
      },
      // Categories listed by the search itself, not only the related objects.
      { id: "CAT_TREATS", type: "CATEGORY", category_data: { name: "Gâteries" } },
      { id: "CAT_DOGS", type: "CATEGORY", category_data: { name: "Chiens" } },
    ],
    [{ id: "CAT_BRAND", type: "CATEGORY", category_data: { name: "Lucky Bones" } }],
  );
  assert.equal(products.length, 2, "category objects are not products");
  assert.equal(products[0].category, "Lucky Bones");
  assert.deepEqual(products[0].categories, ["Lucky Bones", "Gâteries", "Chiens"]);
  assert.equal(products[1].category, "Chiens", "an item without a reporting category keeps its own categories");
  assert.deepEqual(products[1].categories, ["Chiens"]);
});

test("normalizeCatalog falls back gracefully when image/category are missing", () => {
  const products = normalizeCatalog(
    [{ id: "I", type: "ITEM", item_data: { name: "X", variations: [{ id: "V", item_variation_data: { price_money: { amount: 500, currency: "USD" } } }] } }],
    [],
  );
  assert.equal(products[0].imageUrl, "");
  assert.deepEqual(products[0].imageUrls, []);
  assert.equal(products[0].category, "Boutique");
  assert.deepEqual(products[0].categories, ["Boutique"]);
  assert.equal(products[0].currency, "USD");
});

test("brandFromName reads the brand written in capitals at the start of an item name", () => {
  assert.equal(brandFromName("SMACK Chiens Poulet"), "SMACK");
  assert.equal(brandFromName("DOGMÄ Lotion Yeux 120ml"), "DOGMÄ");
  assert.equal(brandFromName("BACI+ 3 en 1 Chiens 150g"), "BACI+");
  assert.equal(brandFromName("*SAFARI SW416"), "SAFARI", "a leading mark and a model number are not part of the brand");
  assert.equal(brandFromName("CATIT 2.0 Balle Fireball"), "CATIT");
  assert.equal(brandFromName("WILD & WOOFY Serviette en microfibre"), "WILD & WOOFY");
  assert.equal(brandFromName("K9 PRAVENTA 360 (XL) 1 tube"), "K9 PRAVENTA");
  assert.equal(brandFromName("LB Yak Bleuet"), "Lucky Bones");
  assert.equal(brandFromName("LB-C Fémur de boeuf"), "Lucky Bones");
  assert.equal(brandFromName("LB - Tresse De Chameau et Buffle"), "Lucky Bones");
  assert.equal(brandFromName("GF Pet Manteau Uni"), "GF PET");
  assert.equal(brandFromName("Zippy Paws Jouet Oiseau"), "", "a name that does not open in capitals has no brand");
  assert.equal(brandFromName("Chamois"), "");
  assert.equal(brandFromName("KONG"), "", "a name with no product part has no brand");
});

test("normalizeCatalog groups brand spellings and adds products of a category named after a brand", () => {
  const item = (id, name, categories = []) => ({
    id,
    type: "ITEM",
    item_data: { name, categories: categories.map((cat) => ({ id: cat })), variations: [{ id: `V_${id}`, item_variation_data: { price_money: { amount: 500, currency: "CAD" } } }] },
  });
  const products = normalizeCatalog(
    [
      item("ZEUS", "ZEUS Laisse — M Bleu"),
      item("NOSH", "ZEUS NOSH Os Robuste, Bacon (G)"),
      item("BACI1", "BACI+ Probio Chats 28g"),
      item("BACI2", "BACI+ Probio Chiens 42g"),
      item("BACI3", "BACI Chien Trousse Gut Boost"),
      item("LB", "LB Yak Menthe", ["CAT_LB"]),
      item("LITTER", "Litière World's Best 8 lbs", ["CAT_HOME", "CAT_LB"]),
      item("PLAIN", "Brosse douce", ["CAT_HOME"]),
    ],
    [
      { id: "CAT_LB", type: "CATEGORY", category_data: { name: "Lucky Bones" } },
      { id: "CAT_HOME", type: "CATEGORY", category_data: { name: "Maison et entretien" } },
    ],
  );
  assert.deepEqual(products.map((p) => p.brands), [
    ["ZEUS"],
    ["ZEUS"],
    ["BACI+"],
    ["BACI+"],
    ["BACI+"],
    ["Lucky Bones"],
    ["Lucky Bones"],
    [],
  ]);
  assert.deepEqual(products[6].categories, ["Maison et entretien", "Lucky Bones"], "categories are left as Square has them");
});

test("normalizeCategories returns the Square photo of each category a listed product uses", () => {
  const objects = [
    { id: "ITEM_A", type: "ITEM", item_data: { name: "A", categories: [{ id: "CAT_TREATS" }, { id: "CAT_DOGS" }], variations: [{ id: "VAR_A", item_variation_data: { price_money: { amount: 500, currency: "CAD" } } }] } },
    { id: "ITEM_B", type: "ITEM", item_data: { name: "B", variations: [{ id: "VAR_B", item_variation_data: { price_money: { amount: 700, currency: "CAD" } } }] } },
    { id: "CAT_TREATS", type: "CATEGORY", category_data: { name: "Gâteries", image_ids: ["IMG_MISSING", "IMG_TREATS"] } },
    { id: "CAT_DOGS", type: "CATEGORY", category_data: { name: "Chiens" } },
    { id: "CAT_EMPTY", type: "CATEGORY", category_data: { name: "Vide", image_ids: ["IMG_EMPTY"] } },
  ];
  const related = [
    { id: "IMG_TREATS", type: "IMAGE", image_data: { url: "https://squarecdn.test/treats.jpg" } },
    { id: "IMG_EMPTY", type: "IMAGE", image_data: { url: "https://squarecdn.test/empty.jpg" } },
  ];
  const products = normalizeCatalog(objects, related);
  assert.deepEqual(normalizeCategories(objects, related, products), [
    { name: "Gâteries", imageUrl: "https://squarecdn.test/treats.jpg" },
    { name: "Chiens", imageUrl: "" },
    { name: "Boutique", imageUrl: "" },
  ]);
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
  assert.match(calls[0].url, /catalog\/search$/);
  assert.equal(calls[0].init.method, "POST");
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.object_types, ["ITEM", "CATEGORY"]);
  assert.equal(sent.include_related_objects, true);
  assert.equal(products.length, 1);
  assert.equal(products[0].id, "VAR_1");
});

test("createShopCheckout validates the cart against Square and returns a payment link", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("catalog/search")) return jsonResponse(sampleCatalog);
    if (href.endsWith("online-checkout/payment-links")) {
      const sent = JSON.parse(init.body);
      assert.equal(sent.order.location_id, "LOC123");
      assert.deepEqual(sent.order.line_items, [{ quantity: "2", catalog_object_id: "VAR_1" }]);
      return jsonResponse({ payment_link: { id: "PL_1", url: "https://square.link/u/pay123" } });
    }
    throw new Error(`unexpected request: ${href}`);
  };

  const result = await createShopCheckout(
    [{ id: "VAR_1", quantity: 2 }],
    { fetcher, redirectUrl: "https://bopoil.ca/boutique.html?commande=reussie" },
  );
  assert.equal(result.url, "https://square.link/u/pay123");
  assert.deepEqual(result.items, [{ id: "VAR_1", quantity: 2 }]);
  assert.ok(calls.some((c) => c.endsWith("catalog/search")));
  assert.ok(calls.some((c) => c.endsWith("online-checkout/payment-links")));
});

test("createShopCheckout rejects a cart with no valid Square items", async () => {
  const fetcher = async (url) => {
    if (String(url).endsWith("catalog/search")) return jsonResponse(sampleCatalog);
    throw new Error("should not create a payment link for an empty cart");
  };
  await assert.rejects(
    () => createShopCheckout([{ id: "GHOST", quantity: 1 }], { fetcher }),
    /Aucun article valide/,
  );
});


test("normalizeCatalog omits Square's default variation label from product titles", () => {
  const products = normalizeCatalog(
    [
      {
        id: "ITEM_BASE",
        type: "ITEM",
        item_data: {
          name: "BUCO+ Gel dentaire",
          variations: [{ id: "VAR_BASE", item_variation_data: { name: "Article de base", price_money: { amount: 2099, currency: "CAD" } } }],
        },
      },
      {
        id: "ITEM_BAKED",
        type: "ITEM",
        item_data: {
          name: "BUCO+ Trousse 15kg + — Article de base",
          variations: [{ id: "VAR_BAKED", item_variation_data: { name: "Article de base", price_money: { amount: 8500, currency: "CAD" } } }],
        },
      },
      {
        id: "ITEM_SIZE",
        type: "ITEM",
        item_data: {
          name: "LOONA Concentré",
          variations: [{ id: "VAR_SIZE", item_variation_data: { name: "1 L", price_money: { amount: 3809, currency: "CAD" } } }],
        },
      },
    ],
    [],
  );
  assert.equal(products[0].name, "BUCO+ Gel dentaire");
  assert.equal(products[1].name, "BUCO+ Trousse 15kg +");
  assert.equal(products[2].name, "LOONA Concentré — 1 L");
});

test("retail catalog includes all sizes and excludes services, archived and unavailable products", () => {
  const retail = structuredClone(sampleCatalog.objects[0]);
  retail.item_data.variations.push({ id: "VAR_LARGE", item_variation_data: { name: "500 ml", price_money: { amount: 3200, currency: "CAD" } } });
  const service = structuredClone(retail);
  service.item_data.product_type = "APPOINTMENTS_SERVICE";
  const archived = structuredClone(retail);
  archived.item_data.is_archived = true;
  const elsewhere = structuredClone(retail);
  elsewhere.present_at_all_locations = false;
  elsewhere.present_at_location_ids = ["OTHER"];
  const products = normalizeCatalog([retail, service, archived, elsewhere], [], "LOC123");
  assert.deepEqual(products.map(p => p.id), ["VAR_1", "VAR_LARGE"]);
  assert.equal(products[1].name, "Shampooing doux — 500 ml");
});

test("normalizeCatalog keeps every Square product photo, not only the first", () => {
  const products = normalizeCatalog(
    [{
      id: "ITEM_GALLERY",
      type: "ITEM",
      item_data: {
        name: "BACI+ Chien Tonus",
        image_ids: ["IMG_1", "IMG_2", "IMG_3"],
        variations: [
          { id: "VAR_G", item_variation_data: { image_ids: ["IMG_2"], price_money: { amount: 5799, currency: "CAD" } } },
        ],
      },
    }],
    [
      { id: "IMG_1", type: "IMAGE", image_data: { url: "https://squarecdn.test/one.jpg" } },
      { id: "IMG_2", type: "IMAGE", image_data: { url: "https://squarecdn.test/two.jpg" } },
      { id: "IMG_3", type: "IMAGE", image_data: { url: "https://squarecdn.test/three.jpg" } },
    ],
  );
  assert.deepEqual(products[0].imageUrls, [
    "https://squarecdn.test/two.jpg",
    "https://squarecdn.test/one.jpg",
    "https://squarecdn.test/three.jpg",
  ]);
  assert.equal(products[0].imageUrl, "https://squarecdn.test/two.jpg");
});

test("location prices and sold-out variations are respected", () => {
  const item = structuredClone(sampleCatalog.objects[0]);
  item.item_data.variations[0].item_variation_data.location_overrides = [{ location_id: "LOC123", price_money: { amount: 2600, currency: "CAD" } }];
  assert.equal(normalizeCatalog([item], [], "LOC123")[0].priceCents, 2600);
  item.item_data.variations[0].item_variation_data.location_overrides[0].sold_out = true;
  assert.equal(normalizeCatalog([item], [], "LOC123").length, 0);
});

test("fetchShopCatalog retrieves Square photos missing from the search related objects", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("catalog/search")) {
      return jsonResponse({
        objects: [{
          id: "ITEM_GALLERY",
          type: "ITEM",
          item_data: {
            name: "BACI+ Tonus",
            image_ids: ["IMG_1", "IMG_2", "IMG_3"],
            variations: [{ id: "VAR_G", item_variation_data: { price_money: { amount: 5799, currency: "CAD" } } }],
          },
        }],
        related_objects: [
          { id: "IMG_1", type: "IMAGE", image_data: { url: "https://squarecdn.test/one.jpg" } },
        ],
      });
    }
    if (href.endsWith("catalog/batch-retrieve")) {
      const sent = JSON.parse(init.body);
      assert.deepEqual(sent.object_ids, ["IMG_2", "IMG_3"]);
      return jsonResponse({
        objects: [
          { id: "IMG_2", type: "IMAGE", image_data: { url: "https://squarecdn.test/two.jpg" } },
          { id: "IMG_3", type: "IMAGE", image_data: { url: "https://squarecdn.test/three.jpg" } },
        ],
      });
    }
    throw new Error(`unexpected request: ${href}`);
  };
  const products = await fetchShopCatalog(fetcher);
  assert.ok(calls.some((href) => href.endsWith("catalog/batch-retrieve")));
  assert.deepEqual(products[0].imageUrls, [
    "https://squarecdn.test/one.jpg",
    "https://squarecdn.test/two.jpg",
    "https://squarecdn.test/three.jpg",
  ]);
});

test("fetchShop retrieves category photos Square leaves out of the search results", async () => {
  const retrieved = [];
  const { products, categories } = await fetchShop(async (url, init) => {
    const href = String(url);
    if (href.endsWith("catalog/search")) {
      return jsonResponse({
        objects: [
          { id: "ITEM_T", type: "ITEM", item_data: { name: "Gâterie", categories: [{ id: "CAT_T" }], variations: [{ id: "VAR_T", item_variation_data: { price_money: { amount: 899, currency: "CAD" } } }] } },
          { id: "CAT_T", type: "CATEGORY", category_data: { name: "Gâteries", image_ids: ["IMG_CAT"] } },
        ],
      });
    }
    if (href.endsWith("catalog/batch-retrieve")) {
      retrieved.push(...JSON.parse(init.body).object_ids);
      return jsonResponse({ objects: [{ id: "IMG_CAT", type: "IMAGE", image_data: { url: "https://squarecdn.test/cat.jpg" } }] });
    }
    throw new Error(`unexpected request: ${href}`);
  });
  assert.deepEqual(retrieved, ["IMG_CAT"]);
  assert.equal(products.length, 1);
  assert.deepEqual(categories, [{ name: "Gâteries", imageUrl: "https://squarecdn.test/cat.jpg" }]);
});

test("fetchShopCatalog still returns the catalog if extra Square photos cannot be retrieved", async () => {
  const products = await fetchShopCatalog(async (url) => {
    if (String(url).endsWith("catalog/search")) {
      return jsonResponse({
        objects: [{
          id: "ITEM_GALLERY",
          type: "ITEM",
          item_data: {
            name: "BACI+ Tonus",
            image_ids: ["IMG_1", "IMG_2"],
            variations: [{ id: "VAR_G", item_variation_data: { price_money: { amount: 5799, currency: "CAD" } } }],
          },
        }],
        related_objects: [
          { id: "IMG_1", type: "IMAGE", image_data: { url: "https://squarecdn.test/one.jpg" } },
        ],
      });
    }
    throw new Error("batch retrieve failed");
  });
  assert.equal(products[0].imageUrl, "https://squarecdn.test/one.jpg");
  assert.deepEqual(products[0].imageUrls, ["https://squarecdn.test/one.jpg"]);
});

test("catalog reads every Square page and resolves related objects across pages", async () => {
  const cursors = [];
  const fetcher = async (url, init) => {
    assert.match(String(url), /\/v2\/catalog\/search$/);
    const body = JSON.parse(init.body);
    cursors.push(body.cursor);
    return jsonResponse(body.cursor ? { related_objects: sampleCatalog.related_objects } : { objects: sampleCatalog.objects, cursor: "NEXT" });
  };
  const products = await fetchShopCatalog(fetcher);
  assert.deepEqual(cursors, [undefined, "NEXT"]);
  assert.equal(products[0].category, "Soins");
});

test("a broken pagination cursor fails instead of returning an incomplete catalog", async () => {
  await assert.rejects(() => fetchShopCatalog(async () => jsonResponse({ cursor: "LOOP" })), /entièrement/);
});

test("checkout refuses a partially unavailable cart instead of silently removing products", async () => {
  await assert.rejects(() => createShopCheckout([{ id: "VAR_1", quantity: 1 }, { id: "GHOST", quantity: 1 }], {
    fetcher: async (url) => {
      assert.match(String(url), /catalog\/search$/);
      return jsonResponse(sampleCatalog);
    },
  }), /plus disponible/);
});

test("checkout retry preserves its idempotency key and applies configured catalog taxes", async () => {
  await createShopCheckout([{ id: "VAR_1", quantity: 1 }], {
    idempotencyKey: "retry-key",
    fetcher: async (url, init) => {
      if (String(url).endsWith("catalog/search")) return jsonResponse(sampleCatalog);
      const body = JSON.parse(init.body);
      assert.equal(body.idempotency_key, "retry-key");
      assert.equal(body.order.pricing_options.auto_apply_taxes, true);
      return jsonResponse({ payment_link: { url: "https://square.link/u/test" } });
    },
  });
});

test("cart normalization rejects non-finite quantities and malformed input", () => {
  assert.deepEqual(sanitizeCartItems(null), []);
  assert.deepEqual(sanitizeCartItems([{ id: "VAR_1", quantity: Infinity }, null, { quantity: 4 }]), []);
});

test("shared Square transport preserves implicit POST bodies when retrying", async () => {
  const { squareRequest } = await import("../lib/square.ts");
  const calls = [];
  const payload = { idempotency_key: "same-attempt", customer_id: "CUSTOMER" };
  const result = await squareRequest("bookings", {
    body: payload,
    fetcher: async (_url, init) => {
      calls.push({ method: init.method, body: init.body });
      return calls.length === 1
        ? { ...jsonResponse({}), ok: false, status: 503 }
        : jsonResponse({ booking: { id: "BOOKING" } });
    },
  });
  assert.equal(result.booking.id, "BOOKING");
  assert.deepEqual(calls, [
    { method: "POST", body: JSON.stringify(payload) },
    { method: "POST", body: JSON.stringify(payload) },
  ]);
});
