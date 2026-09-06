import { createShopCheckout, sanitizeCartItems, shopConfig } from "../../../../../lib/square-shop";

// Turns the visitor's cart into a Square-hosted Online Checkout payment link.
// The browser is redirected to Square to pay; nothing sensitive is handled here.
export async function POST(request: Request) {
  const noStore = { "cache-control": "no-store" };
  try {
    if (!shopConfig().configured) {
      return Response.json({ error: "La boutique Square n'est pas encore configurée." }, { status: 503, headers: noStore });
    }

    const payload = (await request.json().catch(() => ({}))) as { items?: unknown };
    const items = sanitizeCartItems(payload.items);
    if (!items.length) {
      return Response.json({ error: "Votre panier est vide." }, { status: 400, headers: noStore });
    }

    const origin = new URL(request.url).origin;
    const redirectUrl = `${origin}/boutique.html?commande=reussie`;
    const { url } = await createShopCheckout(items, { redirectUrl });
    return Response.json({ url }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Le paiement n'a pas pu être démarré.";
    console.error("Square checkout could not be created.", error);
    return Response.json({ error: message }, { status: 502, headers: noStore });
  }
}
