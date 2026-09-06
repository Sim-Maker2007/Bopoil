import { fetchShopCatalog, shopConfig } from "../../../../lib/square-shop";

// Public storefront catalog. Products, prices and images are served straight
// from the salon's Square catalog. Until Square is configured the endpoint
// reports `configured: false` and the boutique keeps its built-in fallback
// catalog with in-salon pickup ordering.
export async function GET() {
  const shop = shopConfig();
  const cacheable = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };

  if (!shop.configured) {
    return Response.json(
      { configured: false, checkout: "email", currency: "CAD", products: [] },
      { headers: cacheable },
    );
  }

  try {
    const products = await fetchShopCatalog();
    return Response.json(
      { configured: true, checkout: "square", currency: products[0]?.currency || "CAD", products },
      { headers: cacheable },
    );
  } catch (error) {
    console.error("Square catalog is unavailable; serving the fallback catalog.", error);
    return Response.json(
      { configured: false, checkout: "email", currency: "CAD", products: [], error: "catalog_unavailable" },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
