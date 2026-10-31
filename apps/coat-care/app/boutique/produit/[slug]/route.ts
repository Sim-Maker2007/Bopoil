import type { NextRequest } from "next/server";
import { shopConfig } from "../../../../lib/square-shop";
import { findShopItem, productNotFoundHtml, productPageHtml, relatedItems } from "../../../../lib/shop-pages";
import { loadStorefront, readBoutiqueShell } from "../../../../lib/storefront";

// The page of one boutique product (lib/shop-pages.ts), for shoppers and search
// engines. Behind the boutique gate (proxy.ts) like boutique.html itself.
const HTML = { "content-type": "text/html; charset=utf-8" };
// Shared caches keep a page two minutes, like the boutique's API: an edit in
// the Online store admin shows within a couple of minutes.
const CACHED = { ...HTML, "cache-control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shell = await readBoutiqueShell();
  const missing = () => new Response(productNotFoundHtml(shell, slug), { status: 404, headers: { ...HTML, "cache-control": "public, max-age=0, s-maxage=60" } });
  if (!shopConfig().configured) return missing();

  let store;
  try {
    store = await loadStorefront();
  } catch (error) {
    console.error("Square catalog is unavailable for a product page.", error);
    // A temporary error, not a missing page: search engines come back later
    // instead of dropping the product.
    return new Response(productNotFoundHtml(shell, slug, "unavailable"), {
      status: 503,
      headers: { ...HTML, "cache-control": "no-store", "retry-after": "600" },
    });
  }

  const found = findShopItem(store.items, slug);
  if (!found) return missing();
  if (found.redirect) {
    // Renamed since the address was shared or indexed: the current address keeps its ranking.
    return new Response(null, {
      status: 301,
      headers: { location: found.item.path + request.nextUrl.search, "cache-control": "public, max-age=0, s-maxage=120" },
    });
  }

  const requested = request.nextUrl.searchParams.get("variante");
  const variant = found.item.variants.find((entry) => entry.id === requested);
  return new Response(productPageHtml(shell, found.item, { variant, related: relatedItems(store.items, found.item), categories: store.categories }), { headers: CACHED });
}
