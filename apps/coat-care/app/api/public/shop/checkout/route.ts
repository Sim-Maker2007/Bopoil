import { createShopCheckout, sanitizeCartItems, shopConfig } from "../../../../../lib/square-shop";

// Turns the visitor's cart into a Square-hosted Online Checkout payment link.
// The browser is redirected to Square to pay; nothing sensitive is handled here.
export async function POST(request: Request) {
  const noStore = { "cache-control": "no-store" };
  try {
    if (!shopConfig().configured) {
      return Response.json({ error: "La boutique Square n'est pas encore configurée." }, { status: 503, headers: noStore });
    }

    const payload = (await request.json().catch(() => null)) as { items?: unknown; idempotencyKey?: unknown } | null;
    if (!payload || !Array.isArray(payload.items) || payload.items.length > 100) {
      return Response.json({ error: "Le panier est invalide." }, { status: 400, headers: noStore });
    }
    const idempotencyKey = typeof payload.idempotencyKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.idempotencyKey) ? payload.idempotencyKey : undefined;
    const items = sanitizeCartItems(payload.items);
    if (!items.length) {
      return Response.json({ error: "Votre panier est vide." }, { status: 400, headers: noStore });
    }

    const origin = new URL(request.url).origin;
    const redirectUrl = `${origin}/boutique.html?commande=retour`;
    const { url } = await createShopCheckout(items, { redirectUrl, idempotencyKey });
    return Response.json({ url }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Le paiement n'a pas pu être démarré.";
    console.error("Square checkout could not be created.", error);
    return Response.json({ error: message }, { status: 502, headers: noStore });
  }
}
