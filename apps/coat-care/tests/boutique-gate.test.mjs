import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const { decideBoutiqueAccess, isBoutiquePath, boutiquePreviewKey, keysMatch, BOUTIQUE_PREVIEW_COOKIE } = await import("../lib/boutique-gate.ts");
const { transformPublicFile, hideBoutiqueInHtml, hideCartInHtml, hideBoutiqueSlide, hideBoutiqueInSitemap, refreshSitemapDates } = await import("../../../scripts/public-site-boutique.mjs");

const hidden = {};
const published = { BOUTIQUE_ENABLED: "true" };
const withKey = { BOUTIQUE_PREVIEW_KEY: "ninja-secret-key" };

test("the boutique gate covers the page, its assets, the cart and the shop API only", () => {
  for (const path of ["/boutique.html", "/boutique", "/css/boutique.css", "/js/boutique.js", "/css/cart.css", "/js/cart.js", "/api/public/shop", "/api/public/shop/checkout"]) {
    assert.equal(isBoutiquePath(path), true, path);
  }
  for (const path of ["/", "/index.html", "/nos-services.html", "/css/style.css", "/api/public/contact", "/salon"]) {
    assert.equal(isBoutiquePath(path), false, path);
  }
});

test("the boutique is hidden unless BOUTIQUE_ENABLED is exactly true", () => {
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/boutique.html" }, hidden), { action: "hide" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/api/public/shop" }, { BOUTIQUE_ENABLED: "1" }), { action: "hide" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/boutique.html" }, { BOUTIQUE_ENABLED: " TRUE " }), { action: "pass" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/boutique.html" }, published), { action: "pass" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/index.html" }, hidden), { action: "pass" });
});

test("a preview key unlocks a hidden boutique for one browser and leaves the address bar clean", () => {
  const unlocked = decideBoutiqueAccess({ pathname: "/boutique.html", search: "?apercu=ninja-secret-key&cat=chiens" }, withKey);
  assert.deepEqual(unlocked, { action: "unlock", cookie: "ninja-secret-key", redirectTo: "/boutique.html?cat=chiens" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/boutique.html", search: "?apercu=wrong" }, withKey), { action: "hide" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/api/public/shop", previewCookie: "ninja-secret-key" }, withKey), { action: "pass" });
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/api/public/shop", previewCookie: "ninja-secret-ke" }, withKey), { action: "hide" });
  // No key configured: the query parameter is ignored and nothing can unlock the store.
  assert.deepEqual(decideBoutiqueAccess({ pathname: "/boutique.html", search: "?apercu=" }, hidden), { action: "hide" });
  assert.equal(boutiquePreviewKey({ BOUTIQUE_PREVIEW_KEY: "short" }), "");
  assert.equal(keysMatch("", ""), false);
  assert.equal(keysMatch("abc", "abc"), true);
  assert.equal(keysMatch("abcd", "abc"), false);
});

test("the build strips the boutique navigation link, the cart and the sitemap entry while the store is hidden", async () => {
  const [index, boutique, sitemap] = await Promise.all([
    readFile(new URL("../../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/boutique.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/sitemap.xml", import.meta.url), "utf8"),
  ]);
  assert.match(index, /href="boutique\.html">Boutique</);
  assert.match(sitemap, /boutique\.html/);

  const hiddenIndex = transformPublicFile("index.html", index, hidden);
  assert.doesNotMatch(hiddenIndex, /boutique\.html/);
  assert.doesNotMatch(hiddenIndex, /cart-|cart\.(css|js)|data-cart/);
  assert.match(hiddenIndex, /href="contactez-nous\.html">Contactez-nous</);
  // Only the link, the cart and the boutique slide go: the menu toggle and the page itself stay.
  assert.match(hiddenIndex, /<div class="header-actions">\s*<button class="nav-toggle"[^>]*>\s*<span><\/span><span><\/span><span><\/span>\s*<\/button>\s*<\/div>/);
  assert.equal(hiddenIndex.length, hideBoutiqueSlide(hideCartInHtml(index)).length - '<li class="nav-item"><a class="nav-link" href="boutique.html">Boutique</a></li>'.length);
  assert.equal(hideCartInHtml(index).split("data-carousel").length, index.split("data-carousel").length);
  assert.doesNotMatch(hideBoutiqueInHtml(boutique), /href="boutique\.html"[^>]*>Boutique</);
  // The boutique page keeps its cart for browsers unlocked with the preview key.
  const hiddenBoutique = transformPublicFile("boutique.html", boutique, hidden);
  assert.match(hiddenBoutique, /data-cart-drawer/);
  assert.match(hiddenBoutique, /<script src="js\/cart\.js" defer><\/script>/);
  const hiddenSitemap = hideBoutiqueInSitemap(sitemap);
  assert.doesNotMatch(hiddenSitemap, /boutique\.html/);
  assert.match(hiddenSitemap, /politique\.html/);
  assert.equal(hiddenSitemap.split("<url>").length, sitemap.split("<url>").length - 1);

  assert.equal(transformPublicFile("index.html", index, published), null);
  assert.equal(transformPublicFile("sitemap.xml", sitemap, published), null);
  assert.equal(transformPublicFile("robots.txt", "User-agent: *", hidden), null);
});

test("the Lucky Bones page links into the store only while it is published", async () => {
  const page = await readFile(new URL("../../web/lucky-bones.html", import.meta.url), "utf8");
  assert.match(page, /<p class="lb-shop-link" data-boutique-link>[^]*?href="boutique\.html\?categorie=lucky-bones#produits"/);
  assert.match(page, /href="lucky-bones\.html" aria-current="page">Lucky Bones</);
  assert.equal(transformPublicFile("lucky-bones.html", page, published), null);

  const hiddenPage = transformPublicFile("lucky-bones.html", page, hidden);
  assert.doesNotMatch(hiddenPage, /boutique\.html|data-boutique-link/);
  // The page itself, its calculator and its place in the menu stay.
  assert.match(hiddenPage, /href="lucky-bones\.html" aria-current="page">Lucky Bones</);
  assert.match(hiddenPage, /data-lb-calc/);
  assert.match(hiddenPage, /Que vous souhaitiez varier les plaisirs/);
});

test("the build dates each sitemap page by its last change, never earlier than the committed date", async () => {
  const sitemap = await readFile(new URL("../../web/sitemap.xml", import.meta.url), "utf8");
  const dates = { "index.html": "2099-01-02", "boutique.html": "2000-01-01", "guide.html": "" };
  const asked = [];
  const refreshed = refreshSitemapDates(sitemap, (name) => { asked.push(name); return dates[name] ?? "not-a-date"; });
  assert.ok(asked.includes("index.html"), "the home page is dated by index.html");
  assert.match(refreshed, /<loc>https:\/\/www\.bopoil\.ca\/<\/loc><lastmod>2099-01-02<\/lastmod>/);
  const committed = (html, page) => html.match(new RegExp(`/${page}</loc><lastmod>([^<]*)`))[1];
  for (const page of ["boutique\\.html", "guide\\.html", "politique\\.html"]) assert.equal(committed(refreshed, page), committed(sitemap, page), page);
  assert.equal(refreshed.split("<url>").length, sitemap.split("<url>").length);
  assert.equal(transformPublicFile("sitemap.xml", sitemap, published, () => "2099-01-02").match(/2099-01-02/g).length, sitemap.split("<url>").length - 1);
  assert.equal(transformPublicFile("sitemap.xml", sitemap, published, () => ""), null);
});

test("the Next.js proxy enforces the gate on every boutique address", async () => {
  const [proxy, sync] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/sync-public-site.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /export function proxy\(/);
  for (const path of ["/boutique.html", "/css/boutique.css", "/js/boutique.js", "/css/cart.css", "/js/cart.js", "/api/public/shop/:path*"]) {
    assert.ok(proxy.includes(`"${path}"`), path);
  }
  assert.match(proxy, /decideBoutiqueAccess/);
  assert.match(proxy, /httpOnly: true/);
  assert.match(proxy, /secure: true/);
  assert.match(sync, /transformPublicFile/);
  assert.equal(BOUTIQUE_PREVIEW_COOKIE, "__Host-bopoil_boutique");
});

test("product cards keep descriptions off the grid and show them in the product sheet", async () => {
  const [boutique, script] = await Promise.all([
    readFile(new URL("../../web/boutique.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/js/boutique.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(boutique, /class="product-card__desc"/);
  assert.match(boutique, /data-product-sheet/);
  assert.match(boutique, /data-product-desc/);
  assert.match(boutique, /data-desc="/);
  assert.match(boutique, /class="shop-cats"/);
  assert.match(script, /function openProduct\(/);
  assert.match(script, /sheetDesc\.textContent/);
  assert.doesNotMatch(script, /product-card__desc/);
});

test("product photos are resized and the cards stay flat, so phones do not run out of memory", async () => {
  const web = new URL("../../web/", import.meta.url);
  const [cart, script, style, config] = await Promise.all([
    readFile(new URL("js/cart.js", web), "utf8"),
    readFile(new URL("js/boutique.js", web), "utf8"),
    readFile(new URL("css/boutique.css", web), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  // Square keeps the original uploads: the optimizer serves them at 256 to 1 080 pixels.
  assert.match(cart, /'\/_next\/image\?url=' \+ encodeURIComponent\(url\) \+ '&w=' \+ width \+ '&q=75'/);
  assert.ok(cart.includes("items-images-production\\.s3\\.us-west-2\\.amazonaws\\.com\\/files\\/"));
  assert.match(config, /hostname: "items-images-production\.s3\.us-west-2\.amazonaws\.com", pathname: "\/files\/\*\*"/);
  assert.match(config, /qualities: \[75\]/);
  assert.match(script, /imageAttrs\(cardUrls\[0\], \[384, 640\], CARD_SIZES\)/);
  assert.match(script, /imageAttrs\(url, \[640, 1080\], SHEET_SIZES\)/);
  assert.match(script, /imageAttrs\(urls\[0\], \[256\]\)/);
  // A photo the optimizer cannot serve falls back to its original address.
  assert.match(cart, /document\.addEventListener\('error', [^]*?img\.dataset\.original[^]*?\}, true\);/);
  // Each card used to hold a 3D transform and two blurred backdrops: 300 GPU layers.
  const card = style.slice(style.indexOf(".product-card {"), style.indexOf("@keyframes shop-rise"));
  assert.doesNotMatch(card, /backdrop-filter/);
  assert.doesNotMatch(card, /preserve-3d/);
  assert.match(card, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.product-card:hover \{ transform: perspective/);
  assert.match(style, /\.product-card:nth-child\(n\+13\) \{ animation: none; \}/);
  assert.match(style, /@keyframes shop-rise \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}\s*to \{ opacity: 1; transform: none; \}/);
});

test("every page of the public site carries the cart, loaded before the boutique", async () => {
  const web = new URL("../../web/", import.meta.url);
  const pages = (await readdir(web)).filter((name) => name.endsWith(".html") && name !== "liens.html");
  assert.ok(pages.length >= 12, pages.join(", "));
  for (const name of pages) {
    const html = await readFile(new URL(name, web), "utf8");
    assert.match(html, /<link rel="stylesheet" href="css\/cart\.css">/, name);
    assert.match(html, /<button class="cart-btn" type="button" data-cart-open/, name);
    assert.match(html, /<aside class="cart-drawer" id="cart-drawer" data-cart-drawer/, name);
    assert.match(html, /<script src="js\/main\.js" defer><\/script>\s*<script src="js\/cart\.js" defer><\/script>/, name);
    // Away from the boutique, « Continuer mes achats » leads to it.
    if (name !== "boutique.html") assert.match(html, /<a class="cart-drawer__continue" href="boutique\.html">/, name);
  }
  const boutique = await readFile(new URL("boutique.html", web), "utf8");
  assert.match(boutique, /<script src="js\/cart\.js" defer><\/script>\s*<script src="js\/boutique\.js" defer><\/script>/);
  const [cart, script] = await Promise.all([
    readFile(new URL("js/cart.js", web), "utf8"),
    readFile(new URL("js/boutique.js", web), "utf8"),
  ]);
  assert.match(cart, /window\.BopoilCart = \{/);
  assert.match(cart, /\/api\/public\/shop\/checkout/);
  assert.doesNotMatch(script, /localStorage|\/api\/public\/shop\/checkout/);
  assert.match(script, /Cart\.load\(mode, products\)/);
});

test("the home page carousel opens on the boutique for 10 seconds, and drops it while the store is hidden", async () => {
  const web = new URL("../../web/", import.meta.url);
  const [index, main] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    readFile(new URL("js/main.js", web), "utf8"),
  ]);
  const slides = (html) => html.match(/<div class="hero-slide"[^>]*>\s*<\/?[^]*?(?=\s*<div class="hero-slide"|\s*<button class="hero-arrow)/g);
  const dots = (html) => html.match(/<button class="hero-dot"/g).length;

  const published = slides(index);
  assert.equal(published.length, 5);
  assert.match(published[0], /data-active="true" aria-hidden="false" data-delay="10000" data-boutique-slide/);
  assert.match(published[0], /aria-label="1 de 5"/);
  assert.match(published[0], /images\/hero-boutique-1600\.jpg/);
  assert.match(published[0], /loading="eager" fetchpriority="high"/);
  assert.match(published[0], /href="boutique\.html">Découvrir la boutique</);
  assert.match(published[1], /data-active="false"[^]*aria-label="2 de 5"[^]*<h1 class="hero-title">/);
  assert.equal((index.match(/fetchpriority="high" decoding/g) || []).length, 1);
  assert.equal(dots(index), 5);
  for (const file of ["hero-boutique-800.jpg", "hero-boutique-1600.jpg", "hero-boutique-800.webp", "hero-boutique-1600.webp"]) {
    await readFile(new URL(`images/${file}`, web));
  }
  assert.match(main, /getAttribute\('data-delay'\)/);

  const hidden = slides(transformPublicFile("index.html", index, {}));
  assert.equal(hidden.length, 4);
  assert.doesNotMatch(hidden.join(""), /boutique\.html|hero-boutique|data-boutique/);
  assert.match(hidden[0], /data-active="true" aria-hidden="false"\s+role="group"[^>]*aria-label="1 de 4"/);
  assert.match(hidden[0], /hero-printemps-1600\.jpg[^>]*loading="eager" fetchpriority="high"/);
  assert.match(hidden[0], /<h1 class="hero-title">/);
  hidden.slice(1).forEach((slide, i) => assert.match(slide, new RegExp(`data-active="false"[^]*aria-label="${i + 2} de 4"`)));
  assert.equal(dots(transformPublicFile("index.html", index, {})), 4);
  assert.equal(transformPublicFile("index.html", index, { BOUTIQUE_ENABLED: "true" }), null);
});
