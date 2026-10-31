import { connection } from "next/server";
import { shopConfig } from "../../../lib/square-shop";
import { productSitemapXml } from "../../../lib/shop-pages";
import { loadStorefront } from "../../../lib/storefront";

// Every product page of the boutique, for search engines. robots.txt names it
// next to the website's own sitemap.xml; behind the boutique gate (proxy.ts).
const XML = { "content-type": "application/xml; charset=utf-8" };

export async function GET() {
  // Read at each request (then cached by the CDN), never frozen at build time.
  await connection();
  if (!shopConfig().configured) {
    return new Response(productSitemapXml([]), { headers: { ...XML, "cache-control": "public, max-age=0, s-maxage=600" } });
  }
  try {
    const { items } = await loadStorefront();
    return new Response(productSitemapXml(items), { headers: { ...XML, "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (error) {
    console.error("Square catalog is unavailable for the product sitemap.", error);
    return new Response("Catalogue momentanément indisponible.", { status: 503, headers: { "cache-control": "no-store", "retry-after": "600" } });
  }
}
