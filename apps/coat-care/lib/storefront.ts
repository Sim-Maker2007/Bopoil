import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchShop, type ShopCategory } from "./square-shop.ts";
import { groupShopItems, type ShopItem } from "./shop-pages.ts";

// Server side of the product pages (app/boutique/): the Square catalog grouped
// into items, and boutique.html as synchronized into public/ by the build
// (scripts/sync-public-site.mjs), whose header, cart and footer every product
// page wears. next.config.ts traces that file into the functions.

type Storefront = { items: ShopItem[]; categories: ShopCategory[] };

// A crawler reads many product pages in a row: each instance loads the catalog
// once a minute, as often as the boutique's own API is cached.
const CATALOG_TTL_MS = 60_000;
let catalog: { at: number; promise: Promise<Storefront> } | null = null;

export function loadStorefront(now = Date.now()): Promise<Storefront> {
  if (catalog && now - catalog.at < CATALOG_TTL_MS) return catalog.promise;
  const promise = fetchShop().then(({ products, categories }) => ({ items: groupShopItems(products), categories }));
  const entry = { at: now, promise };
  catalog = entry;
  // A failed load is not kept: the next page asks Square again.
  promise.catch(() => {
    if (catalog === entry) catalog = null;
  });
  return promise;
}

let shell: Promise<string> | null = null;

export function readBoutiqueShell(): Promise<string> {
  // In development the build's copy changes as apps/web is edited.
  if (shell && process.env.NODE_ENV === "production") return shell;
  shell = readFile(path.join(process.cwd(), "public", "boutique.html"), "utf8");
  shell.catch(() => {
    shell = null;
  });
  return shell;
}
