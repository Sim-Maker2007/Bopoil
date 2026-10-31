import { PRODUCT_PAGE_PATH, productIdKey, type ShopCategory, type ShopProduct } from "./square-shop.ts";

// The boutique's product pages, as search engines read them. boutique.html
// lists the products in the browser; each product also has a page of its own
// rendered here, with its name as the title, its description, photos, price
// and structured data (schema.org Product), so a search for the product's name
// or for words of its description can lead to it. The page is boutique.html
// itself, with its <head> and <main> replaced: the header, the cart and the
// footer stay the website's own.

export const SITE_ORIGIN = "https://www.bopoil.ca";
const SITE_NAME = "BOPOIL Toilettage & Boutique";
// Square's catch-all category, never shown (HIDDEN_CATEGORIES in js/boutique.js).
const CATCH_ALL = "boutique";
const SQUARE_PHOTOS = /^https:\/\/items-images-production\.s3\.us-west-2\.amazonaws\.com\/files\//i;
const GALLERY_SIZES = "(max-width: 860px) 92vw, 560px";
const CARD_SIZES = "(max-width: 720px) 45vw, (max-width: 1100px) 30vw, 300px";
const PAW = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="19" cy="10" r="2"/><path d="M8 16c1-2 2-3 4-3s3 1 4 3c2 4-2 4-4 3-2 1-6 1-4-3Z"/></svg>';

// One product page: a Square item and the variations the boutique lists.
export type ShopItem = {
  itemId: string;
  path: string;
  name: string;
  description: string;
  brand: string;
  category: string; // the category named on the boutique card, "" for the catch-all alone
  categories: string[];
  variants: ShopProduct[];
  images: string[]; // the photos of the item and its variations, main photo first
  lowCents: number;
  highCents: number;
  currency: string;
  updatedAt: string;
};

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// JSON inside a <script> element: « </script> » in a product name cannot end it.
function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function money(cents: number, currency = "CAD") {
  try {
    return new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// The slug js/boutique.js gives a category (« boutique.html?categorie=soins »).
export function categoryKey(name = "") {
  return name.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-") || CATCH_ALL;
}

function categoryUrl(name: string) {
  return `/boutique.html?categorie=${encodeURIComponent(categoryKey(name))}`;
}

function shownCategory(categories: string[]) {
  return categories.find((name) => categoryKey(name) !== CATCH_ALL) || "";
}

// Square's photos are shown resized by Next.js, as in js/cart.js.
function imageSrc(url: string, width: number) {
  return SQUARE_PHOTOS.test(url) ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75` : url;
}

function imageAttrs(url: string, widths: number[], sizes = "") {
  const src = imageSrc(url, widths[0]);
  if (src === url) return ` src="${escapeHtml(url)}"`;
  const srcset = widths.length > 1
    ? ` srcset="${widths.map((width) => `${escapeHtml(imageSrc(url, width))} ${width}w`).join(", ")}" sizes="${escapeHtml(sizes)}"`
    : "";
  return ` src="${escapeHtml(src)}"${srcset} data-original="${escapeHtml(url)}"`;
}

function plainText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

// The boutique's cards group the variations of an item, in the catalog's order.
export function groupShopItems(products: ShopProduct[]): ShopItem[] {
  const byItem = new Map<string, ShopProduct[]>();
  for (const product of products) {
    const key = product.itemId || product.id;
    byItem.set(key, [...(byItem.get(key) || []), product]);
  }
  return [...byItem.entries()].map(([itemId, variants]) => {
    const first = variants[0];
    const prices = variants.map((variant) => variant.priceCents);
    return {
      itemId,
      path: first.path,
      name: variants.length > 1 ? first.itemName || first.name : first.name,
      description: first.description,
      brand: first.brands[0] || "",
      category: shownCategory(first.categories),
      categories: first.categories,
      variants,
      images: [...new Set(variants.flatMap((variant) => variant.imageUrls))],
      lowCents: Math.min(...prices),
      highCents: Math.max(...prices),
      currency: first.currency,
      updatedAt: first.updatedAt,
    };
  });
}

// The item of an address. An address with the item's current name is the
// page; one whose name is old or misspelled, but ends with the item's id,
// redirects to the current address.
export function findShopItem(items: ShopItem[], slug: string): { item: ShopItem; redirect: boolean } | null {
  const exact = items.find((item) => item.path === PRODUCT_PAGE_PATH + slug);
  if (exact) return { item: exact, redirect: false };
  const key = slug.toLowerCase().split("-").pop() || "";
  if (key.length < 6) return null;
  const matches = items.filter((item) => productIdKey(item.itemId) === key);
  return matches.length === 1 ? { item: matches[0], redirect: true } : null;
}

// Products of the same category first, then of a shared category or brand.
export function relatedItems(items: ShopItem[], item: ShopItem, limit = 8) {
  const mine = new Set(item.categories.map(categoryKey).filter((key) => key !== CATCH_ALL));
  const shown = item.category ? categoryKey(item.category) : "";
  return items
    .map((other, index) => {
      if (other === item) return { other, index, score: 0 };
      let score = shown && categoryKey(other.category) === shown ? 3 : 0;
      for (const name of other.categories) if (mine.has(categoryKey(name))) score += 1;
      if (item.brand && other.brand === item.brand) score += 1;
      return { other, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.other);
}

// « Accessoires › Colliers »: the card's category and the categories above it.
export function categoryTrail(item: ShopItem, categories: ShopCategory[]) {
  const parents = new Map(categories.map((category) => [category.name, category.parent]));
  const trail: string[] = [];
  for (let name = item.category, depth = 0; name && depth < 5 && !trail.includes(name); name = parents.get(name) || "", depth++) {
    trail.unshift(name);
  }
  return trail.filter((name) => categoryKey(name) !== CATCH_ALL);
}

function priceHtml(cents: number, regularCents: number, currency: string) {
  if (!(regularCents > cents)) return money(cents, currency);
  return `<span class="visually-hidden">Prix réduit : </span><span class="shop-sale">${money(cents, currency)}</span> <s class="shop-was"><span class="visually-hidden">au lieu de </span>${money(regularCents, currency)}</s>`;
}

function percentLabel(percentage: number) {
  return `−${String(percentage).replace(".", ",")} %`;
}

export function variantPriceHtml(variant: ShopProduct) {
  return priceHtml(variant.priceCents, variant.regularPriceCents, variant.currency)
    + (variant.promotion ? ` <span class="shop-promo-tag">${escapeHtml(`${percentLabel(variant.promotion.percentage)} · ${variant.promotion.name}`)}</span>` : "");
}

function optionValue(variant: ShopProduct, name: string) {
  return variant.options.find((option) => option.name === name)?.value ?? "";
}

// The variation with this choice that keeps as many of the current other
// choices as possible (pickVariant in js/boutique.js).
function pickVariant(variants: ShopProduct[], current: ShopProduct, name: string, value: string) {
  let best: ShopProduct | null = null;
  let bestScore = -1;
  for (const candidate of variants) {
    if (optionValue(candidate, name) !== value) continue;
    const score = candidate.options.filter((option) => option.name !== name && optionValue(current, option.name) === option.value).length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function swatchAttr(swatch: string) {
  if (swatch === "camo") return ' data-swatch="camo"';
  return /^#[0-9a-f]{6}$/i.test(swatch) ? ` style="--swatch:${swatch}"` : "";
}

function optionNames(variants: ShopProduct[]) {
  const names: string[] = [];
  for (const variant of variants) for (const option of variant.options) if (!names.includes(option.name)) names.push(option.name);
  return names;
}

function optionValues(variants: ShopProduct[], name: string) {
  const values: ShopProduct["options"] = [];
  for (const variant of variants) {
    const option = variant.options.find((entry) => entry.name === name);
    if (option && !values.some((value) => value.value === option.value)) values.push(option);
  }
  return values;
}

// The picker of the product sheet (optionsHTML in js/boutique.js): one row per
// choice, colours as swatches. Each button names the variation it selects.
export function optionsHtml(variants: ShopProduct[], current: ShopProduct) {
  if (variants.length < 2) return "";
  return optionNames(variants).map((name) => {
    const values = optionValues(variants, name);
    const swatches = values.map((value) => value.swatch);
    const asSwatches = swatches.every(Boolean) && swatches.every((swatch, index) => swatches.indexOf(swatch) === index);
    const currentValue = optionValue(current, name);
    const buttons = values.map((value) => {
      const target = pickVariant(variants, current, name, value.value) || current;
      const exact = target.options.every((option) => option.name === name || optionValue(current, option.name) === option.value);
      const label = escapeHtml(value.value) + (exact ? "" : ", offert avec un autre choix");
      const attrs = ` type="button" data-variant="${escapeHtml(target.id)}" data-option-name="${escapeHtml(name)}" data-option-value="${escapeHtml(value.value)}" aria-pressed="${value.value === currentValue}"${exact ? "" : ' data-unavailable="true"'}`;
      return asSwatches
        ? `<button class="product-option__swatch"${attrs}${swatchAttr(value.swatch)} aria-label="${label}" title="${escapeHtml(value.value)}"></button>`
        : `<button class="product-option__pill"${attrs}${exact ? "" : ` aria-label="${label}"`}>${value.swatch ? `<span class="product-option__dot"${swatchAttr(value.swatch)}></span>` : ""}${escapeHtml(value.value)}</button>`;
    }).join("");
    return `<fieldset class="product-option"><legend>${escapeHtml(name)} : <strong>${escapeHtml(currentValue)}</strong></legend><div class="product-option__values">${buttons}</div></fieldset>`;
  }).join("");
}

export function galleryHtml(images: string[], name: string) {
  if (!images.length) return PAW;
  const main = `<img${imageAttrs(images[0], [640, 1080], GALLERY_SIZES)} alt="${escapeHtml(name)}" width="1080" height="1080" fetchpriority="high" data-gallery-main>`;
  if (images.length < 2) return main;
  const thumbs = images.map((url, index) =>
    `<button class="product-sheet__thumb" type="button" role="tab" data-gallery-image="${index}" aria-selected="${index === 0}" aria-label="Photo ${index + 1} sur ${images.length}"><img${imageAttrs(url, [256])} alt="" loading="lazy"></button>`,
  ).join("");
  return `${main}<div class="product-sheet__thumbs" role="tablist" aria-label="Photos du produit">${thumbs}</div>`;
}

// What sets the product apart, in words a shopper searches for: its brand,
// its categories and each choice it comes in (« Couleur : Bleu, Vert »).
function factsHtml(item: ShopItem, trail: string[]) {
  const rows: Array<[string, string]> = [];
  if (item.brand) rows.push(["Marque", escapeHtml(item.brand)]);
  const listed = [...new Set([...trail, ...item.categories.filter((name) => categoryKey(name) !== CATCH_ALL)])];
  if (listed.length) rows.push([listed.length > 1 ? "Catégories" : "Catégorie", listed.map((name) => `<a href="${categoryUrl(name)}">${escapeHtml(name)}</a>`).join(", ")]);
  if (item.variants.length > 1) {
    for (const name of optionNames(item.variants)) {
      rows.push([name, optionValues(item.variants, name).map((value) => escapeHtml(value.value)).join(", ")]);
    }
  }
  return rows.map(([term, detail]) => `<div><dt>${term}</dt><dd>${detail}</dd></div>`).join("");
}

function cardHtml(item: ShopItem, index: number) {
  const cheapest = item.variants.reduce((best, variant) => (variant.priceCents < best.priceCents ? variant : best));
  const promo = Math.max(...item.variants.map((variant) => variant.promotion?.percentage || 0));
  const image = item.images[0]
    ? `<img${imageAttrs(item.images[0], [384, 640], CARD_SIZES)} alt="" loading="lazy" decoding="async">`
    : PAW;
  return `<article class="product-card" style="--i:${index}"><a class="product-card__hit" href="${escapeHtml(item.path)}"><span class="product-card__media">`
    + (item.category ? `<span class="product-card__badge">${escapeHtml(item.category)}</span>` : "")
    + (promo ? `<span class="product-card__promo">${escapeHtml(percentLabel(promo))}</span>` : "")
    + `${image}<span class="product-card__view">Voir le produit</span></span><span class="product-card__body"><span class="product-card__title">${escapeHtml(item.name)}</span><span class="product-card__price">`
    + (item.lowCents !== item.highCents ? '<span class="product-card__from">À partir de</span> ' : "")
    + `${priceHtml(cheapest.priceCents, cheapest.regularPriceCents, cheapest.currency)}</span></span></a></article>`;
}

// « Shampooing doux – Soins | Boutique BOPOIL Gatineau », the category dropped from a long name.
export function pageTitle(item: ShopItem) {
  const suffix = " | Boutique BOPOIL Gatineau";
  const withCategory = item.category && categoryKey(item.category) !== categoryKey(item.name) ? `${item.name} – ${item.category}` : item.name;
  return (withCategory.length + suffix.length <= 75 ? withCategory : item.name) + suffix;
}

export function metaDescription(item: ShopItem) {
  const description = plainText(item.description);
  if (description.length >= 90) return truncate(description, 158);
  const price = item.lowCents !== item.highCents ? `À partir de ${money(item.lowCents, item.currency)}` : money(item.lowCents, item.currency);
  const lead = description || `${item.name}${item.brand && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? ` de ${item.brand}` : ""}.`;
  return truncate(`${lead} ${price} à la boutique BOPOIL, 38 av. Gatineau à Gatineau : commandez en ligne, cueillette au salon.`, 158);
}

const SCHEMA_PROPERTY: Record<string, string> = { Couleur: "color", Taille: "size", Format: "size" };

function offerJson(variant: ShopProduct, url: string, seller: object) {
  return {
    "@type": "Offer",
    url,
    price: (variant.priceCents / 100).toFixed(2),
    priceCurrency: variant.currency,
    availability: "https://schema.org/InStock",
    itemCondition: "https://schema.org/NewCondition",
    availableDeliveryMethod: "https://schema.org/OnSitePickup",
    seller,
    ...(variant.regularPriceCents > variant.priceCents
      ? { priceSpecification: { "@type": "UnitPriceSpecification", priceType: "https://schema.org/StrikethroughPrice", price: (variant.regularPriceCents / 100).toFixed(2), priceCurrency: variant.currency } }
      : {}),
  };
}

// The salon as described in boutique.html's structured data, the seller of every product.
export function salonNode(shell: string): Record<string, unknown> {
  for (const [, json] of shell.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(json);
      const nodes: Array<Record<string, unknown>> = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
      const salon = nodes.find((node) => node?.["@type"] === "PetGroomer");
      if (salon) return salon;
    } catch {
      // A malformed block is skipped.
    }
  }
  return { "@type": "PetGroomer", "@id": `${SITE_ORIGIN}/#salon`, name: SITE_NAME, url: `${SITE_ORIGIN}/` };
}

// schema.org Product (one way to buy it) or ProductGroup (several variations),
// with the breadcrumb Google shows instead of the address.
export function productJsonLd(item: ShopItem, trail: string[], salon: Record<string, unknown>) {
  const url = SITE_ORIGIN + item.path;
  const seller = salon["@id"] ? { "@id": salon["@id"] } : { "@type": "Organization", name: SITE_NAME };
  const description = plainText(item.description);
  const common = {
    "@id": `${url}#produit`,
    name: item.name,
    url,
    ...(description ? { description: truncate(description, 5000) } : {}),
    ...(item.images.length ? { image: item.images.slice(0, 10) } : {}),
    ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
    ...(trail.length ? { category: trail.join(" > ") } : {}),
  };
  let product: Record<string, unknown>;
  if (item.variants.length < 2) {
    product = { "@type": "Product", ...common, offers: offerJson(item.variants[0], url, seller) };
  } else {
    const varies = [...new Set(optionNames(item.variants).map((name) => SCHEMA_PROPERTY[name]).filter(Boolean))];
    product = {
      "@type": "ProductGroup",
      ...common,
      productGroupID: item.itemId,
      ...(varies.length ? { variesBy: varies.map((property) => `https://schema.org/${property}`) } : {}),
      hasVariant: item.variants.map((variant) => {
        const variantUrl = `${url}?variante=${encodeURIComponent(variant.id)}`;
        const properties: Record<string, string> = {};
        for (const option of variant.options) {
          const property = SCHEMA_PROPERTY[option.name];
          if (property && !properties[property]) properties[property] = option.value;
        }
        return {
          "@type": "Product",
          name: variant.name,
          url: variantUrl,
          ...(variant.imageUrls[0] ? { image: variant.imageUrls[0] } : {}),
          ...properties,
          offers: offerJson(variant, variantUrl, seller),
        };
      }),
    };
  }
  const crumbs = [
    { name: "Accueil", item: `${SITE_ORIGIN}/` },
    { name: "Boutique en ligne", item: `${SITE_ORIGIN}/boutique.html` },
    ...trail.map((name) => ({ name, item: SITE_ORIGIN + categoryUrl(name) })),
    { name: item.name, item: url },
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      salon,
      product,
      { "@type": "BreadcrumbList", itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })) },
    ],
  };
}

type PageHead = {
  title: string;
  description: string;
  canonical?: string;
  robots: string;
  image?: string;
  ogType?: string;
  extra?: string;
  jsonLd?: unknown;
};

// boutique.html with this page's <head> and <main>. Its relative addresses
// (css/…, images/…, index.html) are read from the site root, and its links
// within the page (« Passer au contenu principal ») stay on this page.
export function renderStorePage(shell: string, path: string, head: PageHead, main: string) {
  const meta = [
    `<title>${escapeHtml(head.title)}</title>`,
    `<meta name="description" content="${escapeHtml(head.description)}">`,
    `<meta name="robots" content="${escapeHtml(head.robots)}">`,
    head.canonical ? `<link rel="canonical" href="${escapeHtml(head.canonical)}">` : "",
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:type" content="${escapeHtml(head.ogType || "website")}">`,
    '<meta property="og:locale" content="fr_CA">',
    `<meta property="og:title" content="${escapeHtml(head.title)}">`,
    `<meta property="og:description" content="${escapeHtml(head.description)}">`,
    head.canonical ? `<meta property="og:url" content="${escapeHtml(head.canonical)}">` : "",
    head.image ? `<meta property="og:image" content="${escapeHtml(head.image)}">` : "",
    head.extra || "",
    '<meta name="twitter:card" content="summary_large_image">',
  ].filter(Boolean).join("\n  ");
  let html = shell
    .replace(/href="#/g, `href="${path}#`)
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/\s*<meta name="(description|robots|twitter:[^"]*)"[^>]*>/gi, "")
    .replace(/\s*<meta property="og:[^"]*"[^>]*>/gi, "")
    .replace(/\s*<link rel="canonical"[^>]*>/gi, "")
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
  const charset = /<meta charset="[^"]*">/i.exec(html) || /<head[^>]*>/i.exec(html);
  if (charset) {
    const at = charset.index + charset[0].length;
    html = `${html.slice(0, at)}\n  <base href="/">\n  ${meta}${html.slice(at)}`;
  }
  // A function replacement: « $& » in a product description is text, not a pattern.
  if (head.jsonLd) html = html.replace(/<\/head>/i, () => `  <script type="application/ld+json">${scriptJson(head.jsonLd)}</script>\n</head>`);
  return html
    .replace(/(<link rel="stylesheet" href="css\/boutique\.css">)/, '$1\n  <link rel="stylesheet" href="css/produit.css">')
    .replace(/<main id="contenu">[\s\S]*<\/main>/, () => main)
    // The product dialog of the boutique: this page is the product.
    .replace(/\s*<div class="product-overlay"[\s\S]*?(?=\s*<div class="cart-overlay")/, "")
    .replace(/\s*<script src="js\/shop-search\.js"[^>]*><\/script>/, "")
    .replace(/<script src="js\/boutique\.js"[^>]*><\/script>/, '<script src="js/produit.js" defer></script>');
}

// The reassurance band of boutique.html (pickup, selection, advice).
function assurancesHtml(shell: string) {
  return /<section class="section section--sm profile-primary-bold">[\s\S]*?<\/section>/.exec(shell)?.[0] || "";
}

export function productPageHtml(
  shell: string,
  item: ShopItem,
  options: { variant?: ShopProduct; related?: ShopItem[]; categories?: ShopCategory[] } = {},
) {
  const variant = options.variant && item.variants.includes(options.variant) ? options.variant : item.variants[0];
  const trail = categoryTrail(item, options.categories || []);
  const related = options.related || [];
  const url = SITE_ORIGIN + item.path;
  const crumbs = [
    '<li><a href="/">Accueil</a></li>',
    '<li><a href="/boutique.html">Boutique</a></li>',
    ...trail.map((name) => `<li><a href="${categoryUrl(name)}">${escapeHtml(name)}</a></li>`),
    `<li><span aria-current="page">${escapeHtml(item.name)}</span></li>`,
  ].join("");
  const picker = optionsHtml(item.variants, variant);
  const facts = factsHtml(item, trail);
  // What js/produit.js needs to switch variations without reloading the page.
  const data = {
    name: item.name,
    current: variant.id,
    variants: Object.fromEntries(item.variants.map((entry) => [entry.id, {
      name: entry.name,
      price: entry.priceCents,
      currency: entry.currency,
      images: entry.imageUrls,
      priceHtml: variantPriceHtml(entry),
      optionsHtml: optionsHtml(item.variants, entry),
    }])),
  };
  const main = `<main id="contenu">
    <section class="section profile-primary-light-neutral product-page" aria-labelledby="produit-titre">
      <div class="container">
        <nav class="product-crumbs" aria-label="Fil d’Ariane"><ol>${crumbs}</ol></nav>
        <div class="product-page__panel" data-product-page>
          <div class="product-page__media" data-product-gallery>${galleryHtml(variant.imageUrls, item.name)}</div>
          <div class="product-page__body">
            ${item.category ? `<p class="product-sheet__cat">${escapeHtml(item.category)}</p>` : ""}
            <h1 class="product-page__title" id="produit-titre">${escapeHtml(item.name)}</h1>
            <p class="product-sheet__price" data-product-price>${variantPriceHtml(variant)}</p>
            ${picker ? `<div class="product-sheet__options" data-product-options>${picker}</div>` : ""}
            <div class="product-sheet__actions">
              <div class="qty-stepper" role="group" aria-label="Quantité">
                <button type="button" data-product-dec aria-label="Diminuer la quantité" disabled>−</button>
                <span class="qty-stepper__val" data-product-qty>1</span>
                <button type="button" data-product-inc aria-label="Augmenter la quantité" disabled>+</button>
              </div>
              <button class="btn btn--filled product-sheet__add" type="button" data-product-add data-variant="${escapeHtml(variant.id)}" disabled><span class="product-card__add-label">Ajouter au panier</span></button>
            </div>
            <p class="product-sheet__note">Paiement sécurisé avec Square. Cueillette au 38 avenue Gatineau, à Gatineau, après confirmation du salon; livraison disponible sur demande.</p>
            ${item.description ? `<h2 class="product-page__heading">Description</h2><div class="product-sheet__desc">${escapeHtml(item.description)}</div>` : ""}
            ${facts ? `<h2 class="product-page__heading">Détails</h2><dl class="product-page__facts">${facts}</dl>` : ""}
          </div>
        </div>
      </div>
    </section>
    ${related.length ? `<section class="section profile-primary-light-neutral product-related" aria-labelledby="produits-similaires">
      <div class="container">
        <h2 class="product-related__title" id="produits-similaires">Vous aimerez aussi</h2>
        <div class="shop-grid">${related.map(cardHtml).join("")}</div>
        <p class="product-related__more"><a class="btn btn--outline" href="${item.category ? categoryUrl(item.category) : "/boutique.html"}">${item.category ? `Tous les produits : ${escapeHtml(item.category)}` : "Toute la boutique"}</a></p>
      </div>
    </section>` : ""}
    ${assurancesHtml(shell)}
    <script type="application/json" data-product-json>${scriptJson(data)}</script>
  </main>`;
  return renderStorePage(shell, item.path, {
    title: pageTitle(item),
    description: metaDescription(item),
    canonical: url,
    robots: "index, follow, max-image-preview:large",
    image: item.images[0] || `${SITE_ORIGIN}/images/boutique-interieur-1600.jpg`,
    ogType: "product",
    extra: `<meta property="product:price:amount" content="${(item.lowCents / 100).toFixed(2)}">\n  <meta property="product:price:currency" content="${escapeHtml(item.currency)}">`,
    jsonLd: productJsonLd(item, trail, salonNode(shell)),
  }, main);
}

// A product gone from the boutique (a real 404 that offers a search for its
// words), or a catalog Square cannot send right now (503).
export function productNotFoundHtml(shell: string, slug: string, reason: "missing" | "unavailable" = "missing") {
  const words = slug.replace(/-[a-z0-9]{6}$/i, "").replace(/[^a-z0-9]+/gi, " ").trim().slice(0, 80);
  const search = words ? `/boutique.html?recherche=${encodeURIComponent(words)}` : "/boutique.html";
  const [title, text] = reason === "unavailable"
    ? ["La boutique est momentanément indisponible", "Nous ne pouvons pas afficher ce produit pour l’instant. Réessayez dans quelques minutes, ou écrivez-nous : nous vous répondrons avec plaisir."]
    : ["Ce produit n’est plus offert en ligne", "Il a peut-être été renommé ou retiré de la boutique. Cherchez-le parmi nos produits, ou écrivez-nous : nous pouvons souvent le commander pour vous."];
  const main = `<main id="contenu">
    <section class="section profile-primary-light-neutral product-page product-page--missing" aria-labelledby="produit-titre">
      <div class="container">
        <h1 class="product-page__title" id="produit-titre">${title}</h1>
        <p>${text}</p>
        <p class="product-page__links"><a class="btn btn--filled" href="${escapeHtml(search)}">${words ? `Chercher « ${escapeHtml(words)} »` : "Voir la boutique"}</a> <a class="btn btn--outline" href="/contactez-nous.html">Nous écrire</a></p>
      </div>
    </section>
  </main>`;
  return renderStorePage(shell, PRODUCT_PAGE_PATH + encodeURIComponent(slug), {
    title: `${reason === "unavailable" ? "Boutique indisponible" : "Produit introuvable"} | Boutique BOPOIL Gatineau`,
    description: title,
    robots: "noindex, follow",
  }, main);
}

function sitemapDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] || "";
  return date ? `<lastmod>${date}</lastmod>` : "";
}

// Every product page, with its photos, for search engines (listed in robots.txt).
export function productSitemapXml(items: ShopItem[]) {
  const urls = items.map((item) => {
    const images = item.images.slice(0, 10).map((image) => `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>`).join("");
    return `  <url><loc>${escapeXml(SITE_ORIGIN + item.path)}</loc>${sitemapDate(item.updatedAt)}${images}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>
`;
}
