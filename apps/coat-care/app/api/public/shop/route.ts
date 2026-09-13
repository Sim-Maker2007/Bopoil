import { fetchShopCatalog, shopConfig } from "../../../../lib/square-shop";

// Public storefront catalog. Products, prices and images are served straight
// from the salon's Square catalog. Until Square is configured the endpoint
// reports `configured: false` and the boutique displays an explicit preview
// without accepting sample-product orders.
export async function GET() {
  const shop = shopConfig();
  const cacheable = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };

  if (!shop.configured) {
    return Response.json(
      { configured: false, checkout: "unavailable", currency: "CAD", products: [] },
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
    console.error("Square catalog is unavailable.", error);
    return Response.json(
      { configured: true, checkout: "unavailable", currency: "CAD", products: [], error: "catalog_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
