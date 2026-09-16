import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { decideBoutiqueAccess, isBoutiquePath, boutiquePreviewKey, keysMatch, BOUTIQUE_PREVIEW_COOKIE } = await import("../lib/boutique-gate.ts");
const { transformPublicFile, hideBoutiqueInHtml, hideBoutiqueInSitemap } = await import("../../../scripts/public-site-boutique.mjs");

const hidden = {};
const published = { BOUTIQUE_ENABLED: "true" };
const withKey = { BOUTIQUE_PREVIEW_KEY: "ninja-secret-key" };

test("the boutique gate covers the page, its assets and the shop API only", () => {
  for (const path of ["/boutique.html", "/boutique", "/css/boutique.css", "/js/boutique.js", "/api/public/shop", "/api/public/shop/checkout"]) {
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

test("the build strips the boutique navigation link and sitemap entry while the store is hidden", async () => {
  const [index, boutique, sitemap] = await Promise.all([
    readFile(new URL("../../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/boutique.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/sitemap.xml", import.meta.url), "utf8"),
  ]);
  assert.match(index, /href="boutique\.html">Boutique</);
  assert.match(sitemap, /boutique\.html/);

  const hiddenIndex = transformPublicFile("index.html", index, hidden);
  assert.doesNotMatch(hiddenIndex, /boutique\.html/);
  assert.match(hiddenIndex, /href="politique\.html">Politique</);
  assert.equal(hiddenIndex.length, index.length - '<li class="nav-item"><a class="nav-link" href="boutique.html">Boutique</a></li>'.length);
  assert.doesNotMatch(hideBoutiqueInHtml(boutique), /href="boutique\.html"[^>]*>Boutique</);
  const hiddenSitemap = hideBoutiqueInSitemap(sitemap);
  assert.doesNotMatch(hiddenSitemap, /boutique\.html/);
  assert.match(hiddenSitemap, /politique\.html/);
  assert.equal(hiddenSitemap.split("<url>").length, sitemap.split("<url>").length - 1);

  assert.equal(transformPublicFile("index.html", index, published), null);
  assert.equal(transformPublicFile("sitemap.xml", sitemap, published), null);
  assert.equal(transformPublicFile("robots.txt", "User-agent: *", hidden), null);
});

test("the Next.js proxy enforces the gate on every boutique address", async () => {
  const [proxy, sync] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/sync-public-site.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /export function proxy\(/);
  for (const path of ["/boutique.html", "/css/boutique.css", "/js/boutique.js", "/api/public/shop/:path*"]) {
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
