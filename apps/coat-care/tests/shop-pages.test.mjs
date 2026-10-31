import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { normalizeCatalog } = await import("../lib/square-shop.ts");
const {
  groupShopItems,
  findShopItem,
  relatedItems,
  categoryTrail,
  productPageHtml,
  productNotFoundHtml,
  productSitemapXml,
  productJsonLd,
  pageTitle,
  metaDescription,
  salonNode,
} = await import("../lib/shop-pages.ts");

const shell = await readFile(new URL("../../web/boutique.html", import.meta.url), "utf8");
const PHOTO = "https://items-images-production.s3.us-west-2.amazonaws.com/files/abc/original.jpeg";
const PHOTO_2 = "https://items-images-production.s3.us-west-2.amazonaws.com/files/def/original.jpeg";

const item = (id, name, variations, extra = {}) => ({
  id,
  type: "ITEM",
  updated_at: "2026-10-12T14:03:00Z",
  item_data: { name, variations, ...extra },
});
const variation = (id, name, amount) => ({ id, item_variation_data: { name, price_money: { amount, currency: "CAD" } } });

const objects = [
  item("ITEMSHAMPOO01", "DOGMÄ Shampooing doux", [variation("VAR_SHAMPOO", "Régulier", 2400)], {
    description_html: "<p>Formule sans savon au pH équilibré, pensée pour les peaux sensibles des chiens et des chats. Rince facilement et laisse un poil doux.</p><p>Prix 24 $&amp; plus</p>",
    image_ids: ["IMG_A", "IMG_B"],
    categories: [{ id: "CAT_SHAMPOO" }, { id: "CAT_SHOP" }],
  }),
  item("ITEMLEASH0002", "HUNTER Laisse", [
    variation("LEASH_M_VERT", "M Vert", 2500),
    variation("LEASH_L_VERT", "L Vert", 2800),
    variation("LEASH_M_NOIR", "M Noir", 2500),
  ], { categories: [{ id: "CAT_COLLARS" }], image_ids: ["IMG_A"] }),
  item("ITEMCONDITION3", "DOGMÄ Après-shampooing", [variation("VAR_COND", "Régulier", 2200)], { categories: [{ id: "CAT_SHAMPOO" }] }),
  item("ITEMTOY000004", "Jouet </script><script>alert(1)</script>", [variation("VAR_TOY", "Régulier", 1400)], { categories: [{ id: "CAT_SHOP" }] }),
  { id: "CAT_SHAMPOO", type: "CATEGORY", category_data: { name: "Shampooings", parent_category: { id: "CAT_CARE" } } },
  { id: "CAT_CARE", type: "CATEGORY", category_data: { name: "Soins" } },
  { id: "CAT_COLLARS", type: "CATEGORY", category_data: { name: "Colliers & laisses" } },
  { id: "CAT_SHOP", type: "CATEGORY", category_data: { name: "Boutique" } },
  { id: "IMG_A", type: "IMAGE", image_data: { url: PHOTO } },
  { id: "IMG_B", type: "IMAGE", image_data: { url: PHOTO_2 } },
  {
    id: "RULE",
    type: "PRICING_RULE",
    pricing_rule_data: { name: "Soldes", discount_id: "DISC", match_products_id: "SET" },
  },
  { id: "DISC", type: "DISCOUNT", discount_data: { name: "Soldes", discount_type: "FIXED_PERCENTAGE", percentage: "20" } },
  { id: "SET", type: "PRODUCT_SET", product_set_data: { product_ids_any: ["ITEMCONDITION3"] } },
];
const products = normalizeCatalog(objects, [], "", "2026-10-31");
const items = groupShopItems(products);
const categories = [
  { name: "Shampooings", imageUrl: "", parent: "Soins" },
  { name: "Soins", imageUrl: "", parent: "" },
  { name: "Colliers & laisses", imageUrl: "", parent: "" },
  { name: "Boutique", imageUrl: "", parent: "" },
];
const [shampoo, leash, conditioner, toy] = items;

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, "one block of structured data");
  return JSON.parse(blocks[0][1]);
}
const node = (data, type) => data["@graph"].find((entry) => entry["@type"] === type);

test("one product page per Square item, its variations together", () => {
  assert.equal(items.length, 4);
  assert.equal(shampoo.path, "/boutique/produit/dogma-shampooing-doux-mpoo01");
  assert.equal(shampoo.name, "DOGMÄ Shampooing doux");
  assert.equal(shampoo.brand, "DOGMÄ");
  assert.equal(shampoo.category, "Shampooings", "the catch-all category is never named");
  assert.deepEqual(shampoo.images, [PHOTO, PHOTO_2]);
  assert.equal(leash.variants.length, 3);
  assert.equal(leash.name, "HUNTER Laisse");
  assert.equal(leash.lowCents, 2500);
  assert.equal(leash.highCents, 2800);
  assert.equal(conditioner.lowCents, 1760, "the promotion's price");
  assert.equal(toy.category, "");
});

test("an address finds its product, and an old name redirects to the current address", () => {
  assert.deepEqual(findShopItem(items, "dogma-shampooing-doux-mpoo01"), { item: shampoo, redirect: false });
  assert.deepEqual(findShopItem(items, "shampooing-hypoallergenique-mpoo01"), { item: shampoo, redirect: true });
  assert.deepEqual(findShopItem(items, "DOGMA-SHAMPOOING-DOUX-MPOO01"), { item: shampoo, redirect: true });
  assert.equal(findShopItem(items, "dogma-shampooing-doux"), null);
  assert.equal(findShopItem(items, "inconnu-zzzzzz"), null);
  assert.equal(findShopItem(items, "x-oo01"), null, "a few characters of an id are not enough");
});

test("the product's page is boutique.html with the product's own title, description, address and content", () => {
  const html = productPageHtml(shell, shampoo, { related: relatedItems(items, shampoo), categories });
  assert.equal(html.match(/<title>/g).length, 1);
  assert.match(html, /<title>DOGMÄ Shampooing doux – Shampooings \| Boutique BOPOIL Gatineau<\/title>/);
  assert.equal(html.match(/<meta name="description"/g).length, 1);
  assert.match(html, /<meta name="description" content="Formule sans savon au pH équilibré, pensée pour les peaux sensibles des chiens et des chats\. Rince facilement et laisse un poil doux\./);
  assert.equal(html.match(/<link rel="canonical"/g).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.bopoil\.ca\/boutique\/produit\/dogma-shampooing-doux-mpoo01">/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
  assert.match(html, /<meta property="og:type" content="product">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/items-images-production/);
  assert.match(html, /<meta property="product:price:amount" content="24\.00">/);
  assert.doesNotMatch(html, /Boutique en ligne — produits de toilettage/, "nothing of the boutique's own head is left");

  // The boutique's relative addresses resolve from the site root, declared before any of them.
  const base = html.indexOf('<base href="/">');
  assert.ok(base > 0 && base < html.indexOf('href="css/'), "the base comes before the stylesheets");
  assert.match(html, /<link rel="stylesheet" href="css\/boutique\.css">\s*<link rel="stylesheet" href="css\/produit\.css">/);
  assert.match(html, /<a class="skip-link" href="\/boutique\/produit\/dogma-shampooing-doux-mpoo01#contenu">/);

  // One heading 1: the product's name. Its description and details are text on the page.
  assert.equal(html.match(/<h1\b/g).length, 1);
  assert.match(html, /<h1 class="product-page__title" id="produit-titre">DOGMÄ Shampooing doux<\/h1>/);
  assert.match(html, /<div class="product-sheet__desc">Formule sans savon[^<]*\n\nPrix 24 \$&amp; plus<\/div>/, "« $& » stays text");
  assert.match(html, /<dt>Marque<\/dt><dd>DOGMÄ<\/dd>/);
  assert.match(html, /<dt>Catégories<\/dt><dd><a href="\/boutique\.html\?categorie=soins">Soins<\/a>, <a href="\/boutique\.html\?categorie=shampooings">Shampooings<\/a><\/dd>/);
  assert.match(html, /<nav class="product-crumbs" aria-label="Fil d’Ariane"><ol><li><a href="\/">Accueil<\/a><\/li><li><a href="\/boutique\.html">Boutique<\/a><\/li><li><a href="\/boutique\.html\?categorie=soins">Soins<\/a><\/li><li><a href="\/boutique\.html\?categorie=shampooings">Shampooings<\/a><\/li>/);
  assert.match(html, /src="\/_next\/image\?url=https%3A%2F%2Fitems-images-production[^"]*&amp;w=640&amp;q=75"[^>]* alt="DOGMÄ Shampooing doux"/);
  assert.match(html, /data-gallery-image="1"/);

  // Products of the same category are linked, so search engines find them too.
  assert.match(html, /<h2 class="product-related__title" id="produits-similaires">Vous aimerez aussi<\/h2>/);
  assert.match(html, /<a class="product-card__hit" href="\/boutique\/produit\/dogma-apres-shampooing-ition3">/);
  assert.doesNotMatch(html, /href="\/boutique\/produit\/dogma-shampooing-doux-mpoo01">/, "a product does not list itself");

  // The site's header, cart and footer stay; the boutique's catalog and product dialog go.
  assert.match(html, /<header class="site-header/);
  assert.match(html, /<aside class="cart-drawer" id="cart-drawer" data-cart-drawer/);
  assert.match(html, /<footer class="site-footer/);
  assert.match(html, /class="shop-assurances"/);
  assert.doesNotMatch(html, /data-product-sheet|data-shop-grid|js\/boutique\.js|js\/shop-search\.js|Shampooing doux hypoallergénique/);
  assert.match(html, /<script src="js\/cart\.js" defer><\/script>\s*<script src="js\/produit\.js" defer><\/script>/);
});

test("structured data describes the product, its price and its seller for rich results", () => {
  const data = jsonLd(productPageHtml(shell, shampoo, { categories }));
  const product = node(data, "Product");
  assert.equal(product.name, "DOGMÄ Shampooing doux");
  assert.equal(product.url, "https://www.bopoil.ca/boutique/produit/dogma-shampooing-doux-mpoo01");
  assert.deepEqual(product.image, [PHOTO, PHOTO_2]);
  assert.deepEqual(product.brand, { "@type": "Brand", name: "DOGMÄ" });
  assert.equal(product.category, "Soins > Shampooings");
  assert.match(product.description, /^Formule sans savon/);
  assert.equal(product.offers.price, "24.00");
  assert.equal(product.offers.priceCurrency, "CAD");
  assert.equal(product.offers.availability, "https://schema.org/InStock");
  assert.deepEqual(product.offers.seller, { "@id": "https://www.bopoil.ca/#salon" });
  assert.equal(product.offers.priceSpecification, undefined);
  const salon = node(data, "PetGroomer");
  assert.equal(salon["@id"], "https://www.bopoil.ca/#salon", "the seller is the salon of boutique.html");
  assert.equal(salon.address.addressLocality, "Gatineau");
  assert.deepEqual(node(data, "BreadcrumbList").itemListElement.map((crumb) => crumb.name), ["Accueil", "Boutique en ligne", "Soins", "Shampooings", "DOGMÄ Shampooing doux"]);

  const promo = node(jsonLd(productPageHtml(shell, conditioner, { categories })), "Product");
  assert.equal(promo.offers.price, "17.60");
  assert.deepEqual(promo.offers.priceSpecification, { "@type": "UnitPriceSpecification", priceType: "https://schema.org/StrikethroughPrice", price: "22.00", priceCurrency: "CAD" });
});

test("a product sold in several sizes and colours is a ProductGroup, each variation its own offer", () => {
  const html = productPageHtml(shell, leash, { categories });
  const group = node(jsonLd(html), "ProductGroup");
  assert.equal(group.productGroupID, "ITEMLEASH0002");
  assert.deepEqual(group.variesBy, ["https://schema.org/color", "https://schema.org/size"]);
  assert.equal(group.hasVariant.length, 3);
  assert.deepEqual(group.hasVariant[1], {
    "@type": "Product",
    name: "HUNTER Laisse — L Vert",
    url: "https://www.bopoil.ca/boutique/produit/hunter-laisse-sh0002?variante=LEASH_L_VERT",
    image: PHOTO,
    size: "L",
    color: "Vert",
    offers: group.hasVariant[1].offers,
  });
  assert.equal(group.hasVariant[1].offers.price, "28.00");
  assert.match(html, /<dt>Taille<\/dt><dd>M, L<\/dd>/, "every choice is written out for searches");
  assert.match(html, /<dt>Couleur<\/dt><dd>Vert, Noir<\/dd>/);
  assert.match(html, /<meta property="product:price:amount" content="25\.00">/, "the lowest price");

  // ?variante= opens the page on that variation: its price and its choices pressed.
  const large = productPageHtml(shell, leash, { variant: leash.variants[1], categories });
  assert.match(large, /<p class="product-sheet__price" data-product-price>28,00\s\$<\/p>/);
  assert.match(large, /data-variant="LEASH_L_VERT" data-option-name="Taille" data-option-value="L" aria-pressed="true"/);
  assert.match(large, /data-product-add data-variant="LEASH_L_VERT"/);
  assert.match(large, /<link rel="canonical" href="https:\/\/www\.bopoil\.ca\/boutique\/produit\/hunter-laisse-sh0002">/, "every variation shares the page's address");
  // L comes only in green: from M Noir, « L » switches the colour too.
  const black = productPageHtml(shell, leash, { variant: leash.variants[2], categories });
  assert.match(black, /data-variant="LEASH_L_VERT" data-option-name="Taille" data-option-value="L" aria-pressed="false" data-unavailable="true"/);

  // js/produit.js switches variations with the server's own rendering of each.
  const data = JSON.parse(html.match(/<script type="application\/json" data-product-json>([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.current, "LEASH_M_VERT");
  assert.deepEqual(Object.keys(data.variants), ["LEASH_M_VERT", "LEASH_L_VERT", "LEASH_M_NOIR"]);
  assert.match(data.variants.LEASH_L_VERT.optionsHtml, /data-option-value="L" aria-pressed="true"/);
  assert.equal(data.variants.LEASH_L_VERT.price, 2800);
});

test("names and descriptions from Square cannot break out of the page", () => {
  const html = productPageHtml(shell, toy, { categories });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<h1 class="product-page__title" id="produit-titre">Jouet &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.equal(node(jsonLd(html), "Product").name, "Jouet </script><script>alert(1)</script>");
  assert.doesNotMatch(html, /<span class="product-card__badge">Boutique</, "no category is named for the catch-all");
});

test("titles and descriptions stay within what search results show", () => {
  assert.equal(pageTitle(shampoo), "DOGMÄ Shampooing doux – Shampooings | Boutique BOPOIL Gatineau");
  assert.equal(pageTitle({ ...shampoo, name: "Collier réfléchissant ajustable en nylon tressé pour grands chiens" }), "Collier réfléchissant ajustable en nylon tressé pour grands chiens | Boutique BOPOIL Gatineau");
  assert.equal(pageTitle(toy), `${toy.name} | Boutique BOPOIL Gatineau`);
  const long = metaDescription({ ...shampoo, description: "Mot ".repeat(80) });
  assert.ok(long.length <= 158 && long.endsWith("…"), long);
  assert.equal(metaDescription(leash), "HUNTER Laisse. À partir de 25,00\u00a0$ à la boutique BOPOIL, 38 av. Gatineau à Gatineau : commandez en ligne, cueillette au salon.");
  assert.ok(metaDescription(leash).length <= 158);
});

test("related products share the category, then a category or the brand", () => {
  assert.deepEqual(relatedItems(items, shampoo).map((entry) => entry.name), ["DOGMÄ Après-shampooing"]);
  assert.deepEqual(relatedItems(items, toy), [], "the catch-all relates nothing");
  assert.deepEqual(categoryTrail(shampoo, categories), ["Soins", "Shampooings"]);
  assert.deepEqual(categoryTrail(leash, categories), ["Colliers & laisses"]);
});

test("a product gone from the boutique is a page that is not indexed and offers a search", () => {
  const html = productNotFoundHtml(shell, "shampooing-bio-xyz123");
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json/);
  assert.match(html, /href="\/boutique\.html\?recherche=shampooing%20bio">Chercher « shampooing bio »/);
  assert.match(productNotFoundHtml(shell, "x", "unavailable"), /La boutique est momentanément indisponible/);
});

test("the product sitemap lists every product page with its last change and photos", () => {
  const xml = productSitemapXml(items);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1">/);
  assert.equal(xml.match(/<url>/g).length, 4);
  assert.match(xml, /<url><loc>https:\/\/www\.bopoil\.ca\/boutique\/produit\/dogma-shampooing-doux-mpoo01<\/loc><lastmod>2026-10-12<\/lastmod><image:image><image:loc>https:\/\/items-images-production[^<]*<\/image:loc><\/image:image><image:image>/);
  assert.match(productSitemapXml([{ ...shampoo, images: ["https://x.test/a.jpg?a=1&b=2"], updatedAt: "" }]), /<url><loc>[^<]*<\/loc><image:image><image:loc>https:\/\/x\.test\/a\.jpg\?a=1&amp;b=2<\/image:loc>/);
  assert.match(productSitemapXml([]), /<urlset [^>]*>\n<\/urlset>\n$/);
});

test("the salon falls back to a minimal seller when boutique.html has no structured data", () => {
  assert.equal(salonNode(shell).name, "BOPOIL Toilettage & Boutique");
  assert.deepEqual(salonNode("<html></html>")["@id"], "https://www.bopoil.ca/#salon");
  const data = productJsonLd(shampoo, [], salonNode("<html></html>"));
  assert.equal(data["@graph"][1].offers.seller["@id"], "https://www.bopoil.ca/#salon");
});
