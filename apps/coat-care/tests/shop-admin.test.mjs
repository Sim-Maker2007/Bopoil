import assert from "node:assert/strict";
import test from "node:test";

// squareRequest reads these at call time; set before importing the module.
process.env.SQUARE_ACCESS_TOKEN = "test-token";
process.env.SQUARE_LOCATION_ID = "LOC123";

const {
  applyProductPatch,
  checkCategoryParent,
  deletePromotion,
  loadAdminCatalog,
  savePromotion,
  textToHtml,
  updateProduct,
  uploadCatalogImage,
} = await import("../lib/shop-admin.ts");
const { htmlToText } = await import("../lib/square-shop.ts");

function jsonResponse(payload, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => payload };
}

// A fake Square: answers by path, records every request with its JSON body.
function fakeSquare(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    const path = new URL(href).pathname.replace(/^\/v2\//, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ path, method: init.method, body, headers: init.headers });
    const route = routes[`${init.method} ${path}`] || routes[path];
    if (!route) throw new Error(`unexpected request: ${init.method} ${path}`);
    const answer = await route(body, calls.length);
    return answer && typeof answer.json === "function" ? answer : jsonResponse(answer);
  };
  return { fetcher, calls };
}

function shampoo() {
  return {
    id: "ITEM_1",
    type: "ITEM",
    version: 7,
    updated_at: "2026-10-20T15:00:00Z",
    item_data: {
      name: "Shampooing doux",
      description: "Ancienne description",
      description_plaintext: "Ancienne description",
      image_ids: ["IMG_A", "IMG_B"],
      categories: [{ id: "CAT_SOINS", ordinal: 5 }],
      reporting_category: { id: "CAT_SOINS" },
      tax_ids: ["TAX_QC"],
      variations: [
        { id: "VAR_S", type: "ITEM_VARIATION", version: 7, item_variation_data: { name: "250 ml", sku: "SH-250", price_money: { amount: 2400, currency: "CAD" } } },
        { id: "VAR_L", type: "ITEM_VARIATION", version: 7, item_variation_data: { name: "1 L", price_money: { amount: 5000, currency: "CAD" }, location_overrides: [{ location_id: "LOC123", price_money: { amount: 5200, currency: "CAD" }, track_inventory: true }, { location_id: "OTHER", price_money: { amount: 4800, currency: "CAD" } }] } },
      ],
    },
  };
}

test("descriptions are written as Square's simple HTML and read back unchanged", () => {
  const text = "Doux pour la peau.\nSans parfum.\n\nPour chiens & chats <3";
  const html = textToHtml(text);
  assert.equal(html, "<p>Doux pour la peau.<br>Sans parfum.</p><p>Pour chiens &amp; chats &lt;3</p>");
  assert.equal(htmlToText(html), text);
  assert.equal(textToHtml("  \n\n "), "");
});

test("a product patch changes only the edited fields of the Square item", () => {
  const object = applyProductPatch(shampoo(), {
    name: "Shampooing très doux",
    description: "Nouveau texte",
    categoryIds: ["CAT_CHIENS", "CAT_SOINS"],
    mainCategoryId: "CAT_CHIENS",
    prices: { VAR_L: 4500 },
    imageIds: ["IMG_B", "IMG_A"],
  }, "LOC123");
  const item = object.item_data;
  assert.equal(object.version, 7, "the version read from Square guards the write");
  assert.equal(item.name, "Shampooing très doux");
  assert.equal(item.description_html, "<p>Nouveau texte</p>");
  assert.equal(item.description, undefined, "the deprecated description cannot override the new one");
  assert.deepEqual(item.categories, [{ id: "CAT_CHIENS" }, { id: "CAT_SOINS", ordinal: 5 }], "a kept category keeps its place");
  assert.deepEqual(item.reporting_category, { id: "CAT_CHIENS" });
  assert.deepEqual(item.image_ids, ["IMG_B", "IMG_A"]);
  assert.deepEqual(item.tax_ids, ["TAX_QC"], "taxes are left as they are");
  const [small, large] = item.variations;
  assert.deepEqual(small.item_variation_data.price_money, { amount: 2400, currency: "CAD" });
  assert.equal(small.item_variation_data.sku, "SH-250");
  assert.deepEqual(large.item_variation_data.price_money, { amount: 4500, currency: "CAD" });
  assert.equal(large.item_variation_data.pricing_type, "FIXED_PRICING");
  assert.deepEqual(large.item_variation_data.location_overrides, [
    { location_id: "LOC123", price_money: { amount: 4500, currency: "CAD" }, track_inventory: true },
    { location_id: "OTHER", price_money: { amount: 4800, currency: "CAD" } },
  ], "the salon's own location price follows; other locations keep theirs");
});

test("a product patch refuses photos and sizes the item does not have", () => {
  assert.throws(() => applyProductPatch(shampoo(), { imageIds: ["IMG_A", "IMG_ELSEWHERE"] }, "LOC123"), /photos changed/);
  assert.throws(() => applyProductPatch(shampoo(), { prices: { VAR_GONE: 100 } }, "LOC123"), /sizes was removed/);
  const uncategorized = applyProductPatch(shampoo(), { categoryIds: [] }, "LOC123");
  assert.deepEqual(uncategorized.item_data.categories, []);
  assert.equal(uncategorized.item_data.reporting_category, undefined);
});

test("the admin catalog lists retail products, categories with their parents, and promotions", async () => {
  const { fetcher, calls } = fakeSquare({
    "catalog/search": () => ({
      objects: [
        shampoo(),
        { id: "ITEM_NOPRICE", type: "ITEM", item_data: { name: "Accessoire sans prix", categories: [{ id: "CAT_COLLIERS" }], variations: [{ id: "VAR_N", item_variation_data: { pricing_type: "VARIABLE_PRICING" } }] } },
        { id: "ITEM_SERVICE", type: "ITEM", item_data: { name: "Bain", product_type: "APPOINTMENTS_SERVICE", variations: [] } },
        { id: "ITEM_OLD", type: "ITEM", item_data: { name: "Archivé", is_archived: true, variations: [] } },
        { id: "CAT_SOINS", type: "CATEGORY", category_data: { name: "Soins", image_ids: ["IMG_CAT"] } },
        { id: "CAT_ACC", type: "CATEGORY", category_data: { name: "Accessoires" } },
        { id: "CAT_COLLIERS", type: "CATEGORY", category_data: { name: "Colliers", parent_category: { id: "CAT_ACC" } } },
        { id: "P1_D", type: "DISCOUNT", discount_data: { name: "Automne", discount_type: "FIXED_PERCENTAGE", percentage: "15" } },
        { id: "P1_S", type: "PRODUCT_SET", product_set_data: { product_ids_any: ["CAT_SOINS", "ITEM_NOPRICE", "ITEM_DELETED"] } },
        { id: "P1_R", type: "PRICING_RULE", pricing_rule_data: { name: "Soldes d’automne", discount_id: "P1_D", match_products_id: "P1_S", valid_from_date: "2026-10-01", valid_until_date: "2026-10-31" } },
        { id: "P2_D", type: "DISCOUNT", discount_data: { name: "5 $", discount_type: "FIXED_AMOUNT", amount_money: { amount: 500, currency: "CAD" } } },
        { id: "P2_S", type: "PRODUCT_SET", product_set_data: { product_ids_any: ["VAR_S"] } },
        { id: "P2_R", type: "PRICING_RULE", pricing_rule_data: { name: "Cinq dollars", discount_id: "P2_D", match_products_id: "P2_S", valid_from_date: "2026-12-01" } },
      ],
      related_objects: [
        { id: "IMG_A", type: "IMAGE", image_data: { url: "https://squarecdn.test/a.jpg" } },
        { id: "IMG_B", type: "IMAGE", image_data: { url: "https://squarecdn.test/b.jpg" } },
        { id: "IMG_CAT", type: "IMAGE", image_data: { url: "https://squarecdn.test/cat.jpg" } },
      ],
    }),
  });
  const catalog = await loadAdminCatalog(fetcher, "2026-10-22");
  assert.deepEqual(calls[0].body.object_types, ["ITEM", "CATEGORY", "PRICING_RULE", "PRODUCT_SET", "DISCOUNT"]);
  assert.deepEqual(catalog.products.map((product) => product.name), ["Accessoire sans prix", "Shampooing doux"]);
  const [unpriced, product] = catalog.products;
  assert.equal(unpriced.onSite, false, "a product with no fixed price is not in the boutique");
  assert.equal(unpriced.variations[0].priceCents, null);
  assert.deepEqual(product, {
    id: "ITEM_1",
    name: "Shampooing doux",
    description: "Ancienne description",
    images: [{ id: "IMG_A", url: "https://squarecdn.test/a.jpg" }, { id: "IMG_B", url: "https://squarecdn.test/b.jpg" }],
    categoryIds: ["CAT_SOINS"],
    mainCategoryId: "CAT_SOINS",
    variations: [
      { id: "VAR_S", name: "250 ml", sku: "SH-250", priceCents: 2400, currency: "CAD" },
      { id: "VAR_L", name: "1 L", sku: "", priceCents: 5200, currency: "CAD" },
    ],
    onSite: true,
    updatedAt: "2026-10-20T15:00:00Z",
  });
  assert.deepEqual(catalog.categories, [
    { id: "CAT_ACC", name: "Accessoires", parentId: "", imageUrl: "", productCount: 0 },
    { id: "CAT_COLLIERS", name: "Colliers", parentId: "CAT_ACC", imageUrl: "", productCount: 1 },
    { id: "CAT_SOINS", name: "Soins", parentId: "", imageUrl: "https://squarecdn.test/cat.jpg", productCount: 1 },
  ]);
  assert.deepEqual(catalog.promotions, [
    { id: "P1_R", name: "Soldes d’automne", percentage: 15, startsOn: "2026-10-01", endsOn: "2026-10-31", allProducts: false, productIds: ["ITEM_NOPRICE"], categoryIds: ["CAT_SOINS"], status: "active", editable: true },
    { id: "P2_R", name: "Cinq dollars", percentage: 0, startsOn: "2026-12-01", endsOn: "", allProducts: false, productIds: [], categoryIds: [], status: "scheduled", editable: false },
  ]);
});

test("saving a product reads the latest version, writes it back, and retries once over a newer one", async () => {
  let versionMismatch = true;
  const { fetcher, calls } = fakeSquare({
    "GET catalog/object/ITEM_1": () => ({ object: shampoo(), related_objects: [{ id: "IMG_A", type: "IMAGE", image_data: { url: "https://squarecdn.test/a.jpg" } }] }),
    "POST catalog/object": (body) => {
      if (versionMismatch) {
        versionMismatch = false;
        return jsonResponse({ errors: [{ code: "VERSION_MISMATCH", detail: "Object version does not match latest database version." }] }, 400);
      }
      return { catalog_object: body.object };
    },
    "POST catalog/batch-retrieve": (body) => ({ objects: body.object_ids.map((id) => ({ id, type: "IMAGE", image_data: { url: `https://squarecdn.test/${id}.jpg` } })) }),
  });
  const product = await updateProduct("ITEM_1", { prices: { VAR_S: 2600 }, description: "Doux." }, fetcher);
  const writes = calls.filter((call) => call.path === "catalog/object" && call.method === "POST");
  assert.equal(writes.length, 2, "a version mismatch is retried once on the newer version");
  assert.notEqual(writes[0].body.idempotency_key, writes[1].body.idempotency_key);
  assert.equal(writes[1].body.object.version, 7);
  assert.equal(writes[1].body.object.item_data.variations[0].item_variation_data.price_money.amount, 2600);
  assert.equal(writes[1].body.object.item_data.description_html, "<p>Doux.</p>");
  assert.equal(product.id, "ITEM_1");
  assert.deepEqual(product.images.map((image) => image.url), ["https://squarecdn.test/a.jpg", "https://squarecdn.test/IMG_B.jpg"]);
});

test("a second version mismatch is reported instead of retried forever", async () => {
  const { fetcher } = fakeSquare({
    "GET catalog/object/ITEM_1": () => ({ object: shampoo() }),
    "POST catalog/object": () => jsonResponse({ errors: [{ code: "VERSION_MISMATCH", detail: "Object version does not match latest database version." }] }, 400),
  });
  await assert.rejects(updateProduct("ITEM_1", { name: "X" }, fetcher), /version/);
});

test("a photo is uploaded to Square as multipart form data attached to its product", async () => {
  const { fetcher, calls } = fakeSquare({
    "POST catalog/images": () => ({ image: { id: "IMG_NEW", type: "IMAGE", image_data: { url: "https://squarecdn.test/new.jpg" } } }),
  });
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
  const image = await uploadCatalogImage("ITEM_1", file, { filename: "shampooing.jpg", primary: true, fetcher });
  assert.deepEqual(image, { id: "IMG_NEW", url: "https://squarecdn.test/new.jpg" });
  const [call] = calls;
  assert.ok(call.body instanceof FormData);
  assert.equal(call.headers["content-type"], undefined, "fetch sets the multipart boundary itself");
  const request = JSON.parse(call.body.get("request"));
  assert.equal(request.object_id, "ITEM_1");
  assert.equal(request.is_primary, true);
  assert.equal(request.image.type, "IMAGE");
  assert.equal(call.body.get("file").type, "image/jpeg");
});

test("categories have one level of subcategories", () => {
  const categories = [{ id: "ACC", parentId: "" }, { id: "COL", parentId: "ACC" }, { id: "SOINS", parentId: "" }];
  assert.doesNotThrow(() => checkCategoryParent(categories, "SOINS", "ACC"));
  assert.doesNotThrow(() => checkCategoryParent(categories, "", "ACC"));
  assert.doesNotThrow(() => checkCategoryParent(categories, "COL", ""));
  assert.throws(() => checkCategoryParent(categories, "SOINS", "COL"), /subcategories have no subcategories/);
  assert.throws(() => checkCategoryParent(categories, "ACC", "SOINS"), /has subcategories/);
  assert.throws(() => checkCategoryParent(categories, "SOINS", "SOINS"), /its own parent/);
  assert.throws(() => checkCategoryParent(categories, "SOINS", "GONE"), /no longer exists/);
});

test("a new promotion is one Square discount, product set and pricing rule", async () => {
  const { fetcher, calls } = fakeSquare({
    "POST catalog/batch-upsert": () => ({ id_mappings: [{ client_object_id: "#discount", object_id: "D1" }, { client_object_id: "#products", object_id: "S1" }, { client_object_id: "#rule", object_id: "R1" }] }),
  });
  const id = await savePromotion("", { name: "Soldes", percentage: 12.5, startsOn: "2026-11-01", endsOn: "2026-11-30", allProducts: false, productIds: ["ITEM_1"], categoryIds: ["CAT_SOINS"] }, fetcher);
  assert.equal(id, "R1");
  assert.deepEqual(calls[0].body.batches[0].objects, [
    { id: "#discount", type: "DISCOUNT", discount_data: { name: "Soldes", discount_type: "FIXED_PERCENTAGE", percentage: "12.5", modify_tax_basis: "MODIFY_TAX_BASIS" } },
    { id: "#products", type: "PRODUCT_SET", product_set_data: { name: "Soldes", product_ids_any: ["CAT_SOINS", "ITEM_1"] } },
    { id: "#rule", type: "PRICING_RULE", pricing_rule_data: { name: "Soldes", discount_id: "#discount", match_products_id: "#products", valid_from_date: "2026-11-01", valid_until_date: "2026-11-30" } },
  ]);
});

function existingPromotion(extraRule = {}) {
  return {
    "GET catalog/object/R1": () => ({ object: { id: "R1", type: "PRICING_RULE", version: 3, pricing_rule_data: { name: "Soldes", discount_id: "D1", match_products_id: "S1", valid_from_date: "2026-11-01", valid_until_date: "2026-11-30", ...extraRule } } }),
    "POST catalog/batch-retrieve": (body) => ({ objects: body.object_ids.map((id) => ({
      D1: { id: "D1", type: "DISCOUNT", version: 3, discount_data: { name: "Soldes", discount_type: "FIXED_PERCENTAGE", percentage: "10", label_color: "9da2a6" } },
      S1: { id: "S1", type: "PRODUCT_SET", version: 3, product_set_data: { product_ids_any: ["ITEM_1"] } },
      ITEM_1: { id: "ITEM_1", type: "ITEM" },
    })[id]).filter(Boolean) }),
  };
}

test("editing a promotion rewrites its three Square objects over their current versions", async () => {
  const { fetcher, calls } = fakeSquare({ ...existingPromotion(), "POST catalog/batch-upsert": () => ({}) });
  const id = await savePromotion("R1", { name: "Grandes soldes", percentage: 30, startsOn: "2026-11-01", endsOn: "", allProducts: true, productIds: [], categoryIds: [] }, fetcher);
  assert.equal(id, "R1");
  const [discount, set, rule] = calls.find((call) => call.path === "catalog/batch-upsert").body.batches[0].objects;
  assert.equal(discount.version, 3);
  assert.equal(discount.discount_data.percentage, "30");
  assert.equal(discount.discount_data.label_color, "9da2a6", "Square-only settings are kept");
  assert.deepEqual(set.product_set_data, { name: "Grandes soldes", all_products: true });
  assert.equal(rule.version, 3);
  assert.equal(rule.pricing_rule_data.name, "Grandes soldes");
  assert.equal(rule.pricing_rule_data.valid_until_date, undefined, "an empty end date runs the promotion until it is ended");
});

test("a promotion set up in Square with conditions cannot be changed or deleted here", async () => {
  const { fetcher } = fakeSquare(existingPromotion({ customer_group_ids_any: ["VIP"] }));
  await assert.rejects(savePromotion("R1", { name: "X", percentage: 10, startsOn: "2026-11-01", endsOn: "", allProducts: true, productIds: [], categoryIds: [] }, fetcher), /Square dashboard/);
  await assert.rejects(deletePromotion("R1", fetcher), /Square dashboard/);
});

test("deleting a promotion removes its rule, product set and discount", async () => {
  const { fetcher, calls } = fakeSquare({ ...existingPromotion(), "POST catalog/batch-delete": () => ({}) });
  await deletePromotion("R1", fetcher);
  assert.deepEqual(calls.find((call) => call.path === "catalog/batch-delete").body.object_ids, ["R1", "S1", "D1"]);
});

test("only owners and managers can edit the online store by default", async () => {
  const { defaultPermissions, parsePermissions, PERMISSION_LABELS } = await import("../lib/salon-permissions.ts");
  assert.ok(defaultPermissions("manager").includes("boutique"));
  assert.ok(parsePermissions("owner", "[]").includes("boutique"), "the owner always has every permission");
  for (const role of ["receptionist", "groomer", "bather", "accountant"]) assert.ok(!defaultPermissions(role).includes("boutique"), role);
  assert.equal(PERMISSION_LABELS.boutique.label, "Online store");
});

test("the online store admin reads in French", async () => {
  const { translateCrmText } = await import("../app/crm-language.ts");
  assert.equal(translateCrmText("Online store"), "Boutique en ligne");
  assert.equal(translateCrmText(" Products "), " Produits ");
  assert.equal(translateCrmText("Saved in Square: Shampooing doux"), "Enregistré dans Square : Shampooing doux");
  assert.equal(translateCrmText("Subcategory of Accessoires"), "Sous-catégorie d’Accessoires");
  assert.equal(translateCrmText("Price of 250 ml"), "Prix de 250 ml");
  assert.equal(translateCrmText("Square refused the change: the access token needs the ITEMS_WRITE permission to edit the catalog."), "Square a refusé la modification : le jeton d’accès doit avoir la permission ITEMS_WRITE pour modifier le catalogue.");
});

test("the salon workspace opens the online store for those allowed to edit it", async () => {
  const { readFile } = await import("node:fs/promises");
  const workspace = await readFile(new URL("../app/salon/salon-workspace.tsx", import.meta.url), "utf8");
  const access = await readFile(new URL("../app/api/shop-admin/shop-admin-request.ts", import.meta.url), "utf8");
  assert.match(workspace, /hasAccess\("boutique"\)/);
  assert.match(workspace, /<BoutiqueView notify=\{showNotice\} \/>/);
  assert.match(access, /requireBoutiqueManagement/);
});
