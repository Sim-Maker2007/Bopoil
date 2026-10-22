"use client";
/* eslint-disable @next/next/no-img-element -- photo() resizes Square's photos through /_next/image itself, and a photo from any other host loads as it is */

import { useEffect, useMemo, useState } from "react";
import type { AdminCatalog, AdminCategory, AdminProduct, AdminPromotion } from "../../lib/shop-admin";
import { translateCrmText } from "../crm-language";

// Online store admin: the boutique's products, categories and promotions,
// read from and saved to the Square catalog (lib/shop-admin.ts).

type Catalog = AdminCatalog & { configured: true; locationConfigured: boolean };
type Loaded = Catalog | { configured: false };
type Tab = "products" | "promotions" | "categories";
type PromotionDraft = { promotion: AdminPromotion | null; productIds: string[] };

const SQUARE_PHOTOS = /^https:\/\/items-images-production\.s3\.us-west-2\.amazonaws\.com\/files\//i;

// Square keeps the full-size originals; the admin shows them resized, like the boutique.
function photo(url: string, width: 128 | 256) {
  return SQUARE_PHOTOS.test(url) ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75` : url;
}
function money(cents: number, currency = "CAD") { return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100); }
// « Bœuf » is found as « boeuf »: accents and ligatures do not count in a search.
function plain(value: string) { return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae"); }
function priceText(cents: number | null) { return cents === null ? "" : (cents / 100).toFixed(2); }
function parsePrice(value: string) {
  const number = Number(value.replace(/[\s$]/g, "").replace(",", "."));
  return value.trim() && Number.isFinite(number) && number >= 0 && number <= 100_000 ? Math.round(number * 100) : null;
}
function sameIds(a: string[], b: string[]) { return a.length === b.length && a.every((id, index) => id === b[index]); }
async function json<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}
function post<T>(body: Record<string, unknown>) {
  return fetch("/api/shop-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => json<T>(response));
}
function failure(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }
// The page's text is translated where it is shown (CrmLanguageBoundary); a
// browser dialog is not part of the page, so its question is translated here.
function ask(question: string) {
  const french = document.querySelector(".crm-language-boundary")?.getAttribute("lang")?.startsWith("fr");
  return window.confirm(french ? translateCrmText(question) : question);
}

// Phone photos are often 4 000 pixels wide and several megabytes. Each photo is
// redrawn as a JPEG of at most 2 000 pixels a side before it is sent: sharp
// enough for any screen, and well under what the upload accepts.
async function preparePhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("This photo cannot be read. Choose a JPEG or PNG photo.");
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This photo cannot be read. Choose a JPEG or PNG photo.");
  // A transparent PNG gets the white background of the boutique's cards.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This photo cannot be read. Choose a JPEG or PNG photo.")), "image/jpeg", 0.88));
}

async function uploadPhoto(file: File, kind: "product" | "category", objectId: string) {
  const blob = await preparePhoto(file);
  const form = new FormData();
  form.append("file", blob, `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`);
  form.append("kind", kind);
  form.append("objectId", objectId);
  return json<{ product?: AdminProduct }>(await fetch("/api/shop-admin/images", { method: "POST", body: form }));
}

// The categories as main categories, each followed by its subcategories.
function categoryTree(categories: AdminCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const rootOf = (category: AdminCategory) => {
    let current = category;
    for (let depth = 0; current.parentId && byId.has(current.parentId) && depth < 5; depth += 1) current = byId.get(current.parentId)!;
    return current;
  };
  return categories.filter((category) => !category.parentId).map((parent) => ({
    parent,
    children: categories.filter((category) => category.id !== parent.id && rootOf(category).id === parent.id),
  }));
}

function categoryLabel(categories: AdminCategory[], id: string) {
  const category = categories.find((entry) => entry.id === id);
  if (!category) return "";
  const parent = categories.find((entry) => entry.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

function coveringPromotions(product: AdminProduct, promotions: AdminPromotion[]) {
  return promotions.filter((promotion) => promotion.status !== "ended" && (promotion.allProducts || promotion.productIds.includes(product.id) || promotion.categoryIds.some((id) => product.categoryIds.includes(id))));
}

function priceRange(product: AdminProduct) {
  const prices = product.variations.map((variation) => variation.priceCents).filter((cents): cents is number => cents !== null);
  if (!prices.length) return "No price";
  const low = Math.min(...prices), high = Math.max(...prices), currency = product.variations[0]?.currency;
  return low === high ? money(low, currency) : `${money(low, currency)} – ${money(high, currency)}`;
}

function promotionDates(promotion: AdminPromotion) {
  if (promotion.startsOn && promotion.endsOn) return `${promotion.startsOn} → ${promotion.endsOn}`;
  return promotion.startsOn ? `${promotion.startsOn} →` : promotion.endsOn ? `→ ${promotion.endsOn}` : "";
}

const STATUS_LABELS: Record<AdminPromotion["status"], string> = { active: "Running", scheduled: "Upcoming", ended: "Ended" };

export function BoutiqueView({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [tab, setTab] = useState<Tab>("products");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<PromotionDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<AdminCategory | "new" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/shop-admin", { signal: controller.signal })
      .then((response) => json<Loaded>(response))
      .then((loaded) => { setData(loaded); setError(""); })
      .catch((reason) => { if (reason.name !== "AbortError") setError(failure(reason, "The Square catalog could not be loaded.")); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [revision]);

  function refresh() { setRefreshing(true); setRevision((value) => value + 1); }

  const catalog = data?.configured ? data : null;

  // Saved products are swapped in place; the full catalog is not read again.
  function replaceProduct(product: AdminProduct) {
    setData((current) => current?.configured ? { ...current, products: current.products.map((entry) => entry.id === product.id ? product : entry) } : current);
  }

  const shown = useMemo(() => {
    if (!catalog) return [];
    const words = plain(query).split(/\s+/).filter(Boolean);
    const inFilter = (product: AdminProduct) => {
      if (!filter) return true;
      if (filter === "offsite") return !product.onSite;
      if (filter === "uncategorized") return !product.categoryIds.length;
      if (filter === "promotion") return coveringPromotions(product, catalog.promotions).length > 0;
      const family = new Set([filter, ...catalog.categories.filter((category) => category.parentId === filter).map((category) => category.id)]);
      return product.categoryIds.some((id) => family.has(id));
    };
    return catalog.products.filter((product) => {
      const text = plain(`${product.name} ${product.variations.map((variation) => `${variation.name} ${variation.sku}`).join(" ")}`);
      return inFilter(product) && words.every((word) => text.includes(word));
    });
  }, [catalog, query, filter]);

  if (error && !data) {
    return <div className="shop-admin-state"><strong>The boutique could not be loaded.</strong><p>{error}</p><button className="secondary-button" onClick={refresh}>Try again</button></div>;
  }
  if (!data) return <div className="dashboard-loading" role="status" aria-label="Loading…"><span /><span /><span /></div>;
  if (!catalog) {
    return <div className="shop-admin-state"><strong>Connect Square to manage the boutique.</strong><p>Products, photos, prices and promotions are kept in Square. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID to the Vercel environment variables, then redeploy.</p></div>;
  }

  const tree = categoryTree(catalog.categories);
  const offsite = catalog.products.filter((product) => !product.onSite).length;
  const runningPromotions = catalog.promotions.filter((promotion) => promotion.status === "active").length;

  return (
    <div className="shop-admin">
      <div className="shop-admin-toolbar">
        <div className="shop-admin-tabs" role="tablist" aria-label="Online store">
          <button role="tab" aria-selected={tab === "products"} className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Products <b>{catalog.products.length}</b></button>
          <button role="tab" aria-selected={tab === "promotions"} className={tab === "promotions" ? "active" : ""} onClick={() => setTab("promotions")}>Promotions {runningPromotions > 0 && <b>{runningPromotions}</b>}</button>
          <button role="tab" aria-selected={tab === "categories"} className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}>Categories <b>{catalog.categories.length}</b></button>
        </div>
        <div className="shop-admin-actions">
          <a className="secondary-button" href="/boutique.html" target="_blank" rel="noreferrer">View the boutique ↗</a>
          <button className="secondary-button" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing…" : "Refresh"}</button>
          {tab === "promotions" && <button className="primary-button" onClick={() => setPromotionDraft({ promotion: null, productIds: [] })}>＋ New promotion</button>}
          {tab === "categories" && <button className="primary-button" onClick={() => setCategoryDraft("new")}>＋ New category</button>}
        </div>
      </div>
      <p className="shop-admin-note">Everything here is saved in Square: a change also applies at the shop’s point of sale. The website shows it within a couple of minutes.</p>
      {!catalog.locationConfigured && <p className="shop-admin-banner">SQUARE_LOCATION_ID is not set, so the boutique cannot take orders yet. Products can still be edited.</p>}
      {error && <p className="inline-error">{error}</p>}

      {tab === "products" && <section className="shop-admin-panel" aria-label="Products">
        <div className="shop-admin-filters">
          <label className="shop-admin-search"><span>Search</span><input type="search" value={query} placeholder="Name, size or SKU" onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>Show</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All products</option>
            <option value="promotion">On promotion</option>
            <option value="offsite">Not on the website</option>
            <option value="uncategorized">Without a category</option>
            {tree.map(({ parent, children }) => [
              <option key={parent.id} value={parent.id}>{parent.name}</option>,
              ...children.map((child) => <option key={child.id} value={child.id}>{`— ${child.name}`}</option>),
            ])}
          </select></label>
          <p className="shop-admin-count"><strong>{shown.length}</strong> <span>{shown.length === 1 ? "product" : "products"}</span>{offsite > 0 && !filter && <> · <button className="shop-admin-link" onClick={() => setFilter("offsite")}><span>{offsite}</span> <span>not on the website</span></button></>}</p>
        </div>
        <div className="shop-admin-list">
          {shown.map((product) => {
            const promotions = coveringPromotions(product, catalog.promotions);
            return <button key={product.id} className="shop-admin-row" onClick={() => setEditing(product)}>
              <span className="shop-admin-thumb">{product.images[0]?.url ? <img src={photo(product.images[0].url, 128)} alt="" loading="lazy" /> : <span aria-hidden="true">▢</span>}</span>
              <span className="shop-admin-row-main">
                <strong>{product.name}</strong>
                <small>{product.categoryIds.length ? product.categoryIds.map((id) => categoryLabel(catalog.categories, id)).filter(Boolean).join(" · ") : "No category"}</small>
              </span>
              <span className="shop-admin-row-price">{priceRange(product)}</span>
              <span className="shop-admin-row-chips">
                {promotions.filter((promotion) => promotion.percentage > 0).slice(0, 1).map((promotion) => <span key={promotion.id} className="shop-chip promo">{`−${promotion.percentage} %`}</span>)}
                {!product.onSite && <span className="shop-chip warn">Not on the website</span>}
                {product.images.length === 0 && <span className="shop-chip muted">No photo</span>}
              </span>
            </button>;
          })}
          {!shown.length && <div className="report-empty">No product matches this search.</div>}
        </div>
      </section>}

      {tab === "promotions" && <section className="shop-admin-panel" aria-label="Promotions">
        <p className="shop-admin-help">A promotion takes a percentage off chosen products or categories between two dates. Square applies it by itself at the shop’s point of sale and at online checkout, and the boutique shows the reduced price.</p>
        <div className="shop-promo-list">
          {catalog.promotions.map((promotion) => {
            const covered = catalog.products.filter((product) => coveringPromotions(product, [{ ...promotion, status: "active" }]).length).length;
            return <article key={promotion.id} className={`shop-promo-card ${promotion.status}`}>
              <div className="shop-promo-amount">{promotion.percentage ? `−${promotion.percentage} %` : "—"}</div>
              <div className="shop-promo-main">
                <strong>{promotion.name}</strong>
                <small>{promotionDates(promotion) || "No dates"}</small>
                <small>{promotion.allProducts ? "Whole store" : <><span>{covered}</span> <span>{covered === 1 ? "product" : "products"}</span></>}</small>
              </div>
              <span className={`shop-chip ${promotion.status === "active" ? "promo" : "muted"}`}>{STATUS_LABELS[promotion.status]}</span>
              {promotion.editable
                ? <button className="secondary-button" onClick={() => setPromotionDraft({ promotion, productIds: promotion.productIds })}>Edit</button>
                : <span className="shop-chip muted" title="This promotion has conditions only the Square dashboard can change.">Set up in Square</span>}
            </article>;
          })}
          {!catalog.promotions.length && <div className="report-empty">No promotion yet. Create one to put products on sale.</div>}
        </div>
      </section>}

      {tab === "categories" && <section className="shop-admin-panel" aria-label="Categories">
        <p className="shop-admin-help">Main categories are the photo cards at the top of the boutique. Their subcategories appear as choices under the card once it is selected. A product in a subcategory is also listed in its main category.</p>
        <div className="shop-category-list">
          {tree.map(({ parent, children }) => <div key={parent.id} className="shop-category-group">
            <CategoryRow category={parent} onEdit={() => setCategoryDraft(parent)} />
            {children.map((child) => <CategoryRow key={child.id} category={child} sub onEdit={() => setCategoryDraft(child)} />)}
          </div>)}
          {!tree.length && <div className="report-empty">No category yet.</div>}
        </div>
      </section>}

      {editing && <ProductEditor
        key={editing.id}
        product={editing}
        catalog={catalog}
        onClose={() => setEditing(null)}
        onUpdated={(product, close) => { replaceProduct(product); if (close) { setEditing(null); notify(`Saved in Square: ${product.name}`); } }}
        onPromote={(product) => { setEditing(null); setTab("promotions"); setPromotionDraft({ promotion: null, productIds: [product.id] }); }}
        onEditPromotion={(promotion) => { setEditing(null); setTab("promotions"); setPromotionDraft({ promotion, productIds: promotion.productIds }); }}
      />}
      {promotionDraft && <PromotionEditor
        draft={promotionDraft}
        catalog={catalog}
        onClose={() => setPromotionDraft(null)}
        onSaved={(message) => { setPromotionDraft(null); notify(message); refresh(); }}
      />}
      {categoryDraft && <CategoryEditor
        category={categoryDraft === "new" ? null : categoryDraft}
        catalog={catalog}
        onClose={() => setCategoryDraft(null)}
        onSaved={(message) => { setCategoryDraft(null); notify(message); refresh(); }}
      />}
    </div>
  );
}

function CategoryRow({ category, sub = false, onEdit }: { category: AdminCategory; sub?: boolean; onEdit: () => void }) {
  return <div className={`shop-category-row${sub ? " sub" : ""}`}>
    <span className="shop-admin-thumb">{category.imageUrl ? <img src={photo(category.imageUrl, 128)} alt="" loading="lazy" /> : <span aria-hidden="true">▢</span>}</span>
    <span className="shop-admin-row-main">
      <strong>{category.name}</strong>
      <small><span>{category.productCount}</span> <span>{category.productCount === 1 ? "product" : "products"}</span>{sub && <> · <span>subcategory</span></>}</small>
    </span>
    <button className="secondary-button" onClick={onEdit}>Edit</button>
  </div>;
}

function ShopModal({ title, eyebrow, onClose, children, footer, wide = false }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop shop-admin-backdrop">
    <section className={`business-modal shop-admin-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button onClick={onClose} aria-label="Close">×</button></header>
      <div className="shop-admin-modal-body">{children}</div>
      <div className="shop-admin-modal-footer">{footer}</div>
    </section>
  </div>;
}

// Main categories with their subcategories, as checkboxes. For a promotion,
// ticking a main category ticks its subcategories too, so Square discounts
// every product filed under them.
function CategoryChecklist({ categories, selected, onChange, cascade = false }: { categories: AdminCategory[]; selected: string[]; onChange: (ids: string[]) => void; cascade?: boolean }) {
  const tree = categoryTree(categories);
  function toggle(id: string, children: AdminCategory[]) {
    const on = !selected.includes(id);
    const ids = cascade && children.length ? [id, ...children.map((child) => child.id)] : [id];
    onChange(on ? [...selected, ...ids.filter((entry) => !selected.includes(entry))] : selected.filter((entry) => !ids.includes(entry)));
  }
  if (!tree.length) return <p className="shop-admin-help">No category yet. Create categories in the Categories tab.</p>;
  return <div className="shop-category-checklist">
    {tree.map(({ parent, children }) => <div key={parent.id}>
      <label><input type="checkbox" checked={selected.includes(parent.id)} onChange={() => toggle(parent.id, children)} /><span>{parent.name}</span></label>
      {children.map((child) => <label key={child.id} className="sub"><input type="checkbox" checked={selected.includes(child.id)} onChange={() => toggle(child.id, [])} /><span>{child.name}</span></label>)}
    </div>)}
  </div>;
}

function ProductEditor({ product: initial, catalog, onClose, onUpdated, onPromote, onEditPromotion }: {
  product: AdminProduct;
  catalog: Catalog;
  onClose: () => void;
  onUpdated: (product: AdminProduct, close: boolean) => void;
  onPromote: (product: AdminProduct) => void;
  onEditPromotion: (promotion: AdminPromotion) => void;
}) {
  const [product, setProduct] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [categoryIds, setCategoryIds] = useState(initial.categoryIds);
  const [mainCategoryId, setMainCategoryId] = useState(initial.mainCategoryId);
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(initial.variations.map((variation) => [variation.id, priceText(variation.priceCents)])));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const mainId = categoryIds.includes(mainCategoryId) ? mainCategoryId : categoryIds[0] || "";
  const changedPrices: Record<string, number> = {};
  const invalidPrices = new Set<string>();
  for (const variation of product.variations) {
    const value = prices[variation.id] || "";
    if (!value.trim() && variation.priceCents === null) continue;
    const cents = parsePrice(value);
    if (cents === null) invalidPrices.add(variation.id);
    else if (cents !== variation.priceCents) changedPrices[variation.id] = cents;
  }
  const changes: Record<string, unknown> = {};
  if (name.trim() !== product.name) changes.name = name;
  if (description.trim() !== product.description) changes.description = description;
  if (!sameIds(categoryIds, product.categoryIds) || (mainId && mainId !== product.mainCategoryId)) { changes.categoryIds = categoryIds; changes.mainCategoryId = mainId; }
  if (Object.keys(changedPrices).length) changes.prices = changedPrices;
  // A price that cannot be read still enables Save, which then says why.
  const dirty = Object.keys(changes).length > 0 || invalidPrices.size > 0;
  const promotions = coveringPromotions({ ...product, categoryIds }, catalog.promotions);

  function close() {
    if (busy) return;
    if (dirty && !ask("Close without saving your changes?")) return;
    onClose();
  }

  async function save() {
    if (!name.trim()) { setError("Enter the product name."); return; }
    if (invalidPrices.size) { setError("Enter each price as a number, for example 24.99."); return; }
    setBusy("save"); setError("");
    try {
      const { product: saved } = await post<{ product: AdminProduct }>({ action: "update_product", itemId: product.id, ...changes });
      onUpdated(saved, true);
    } catch (reason) { setError(failure(reason, "The product could not be saved.")); setBusy(""); }
  }

  async function savePhotos(imageIds: string[]) {
    setBusy("photos"); setError("");
    try {
      const { product: saved } = await post<{ product: AdminProduct }>({ action: "update_product", itemId: product.id, imageIds });
      setProduct(saved); onUpdated(saved, false);
    } catch (reason) { setError(failure(reason, "The photos could not be saved.")); }
    finally { setBusy(""); }
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const list = [...files].slice(0, 10);
    for (const [index, file] of list.entries()) {
      setBusy(`upload ${index + 1}/${list.length}`);
      try {
        const { product: saved } = await uploadPhoto(file, "product", product.id);
        if (saved) { setProduct(saved); onUpdated(saved, false); }
      } catch (reason) { setError(failure(reason, "The photo could not be added.")); break; }
    }
    setBusy("");
  }

  function move(index: number, to: number) {
    const ids = product.images.map((image) => image.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    void savePhotos(ids);
  }

  const uploading = busy.startsWith("upload ") ? busy.slice(7).split("/") : null;
  const firstVariation = product.variations[0]?.id;

  return <ShopModal wide title={product.name || "Product"} eyebrow="Square product" onClose={close} footer={<>
    {product.onSite && firstVariation && <a className="secondary-button" href={`/boutique.html?produit=${encodeURIComponent(firstVariation)}`} target="_blank" rel="noreferrer">View on the website ↗</a>}
    <span className="shop-admin-spacer" />
    <button className="secondary-button" onClick={close} disabled={Boolean(busy)}>Cancel</button>
    <button className="primary-button" onClick={() => void save()} disabled={!dirty || Boolean(busy)}>{busy === "save" ? "Saving…" : "Save changes"}</button>
  </>}>
    {!product.onSite && <p className="shop-admin-banner">Not on the website: Square has no fixed price for it, it is sold out, or it is not offered at the salon’s location.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}

    <section className="shop-admin-section">
      <h3>Photos</h3>
      <p className="shop-admin-help">The first photo is the main one, shown on the product’s card. Photos are added and reordered in Square right away.</p>
      <div className="shop-photo-grid">
        {product.images.map((image, index) => <figure key={image.id} className="shop-photo">
          {image.url ? <img src={photo(image.url, 256)} alt="" /> : <span className="shop-photo-missing">Photo unavailable</span>}
          {index === 0 && <span className="shop-chip promo">Main photo</span>}
          <figcaption>
            <button disabled={Boolean(busy) || index === 0} onClick={() => move(index, index - 1)} aria-label="Move left">←</button>
            <button disabled={Boolean(busy) || index === product.images.length - 1} onClick={() => move(index, index + 1)} aria-label="Move right">→</button>
            <button disabled={Boolean(busy)} onClick={() => { if (ask("Remove this photo from the product?")) void savePhotos(product.images.filter((entry) => entry.id !== image.id).map((entry) => entry.id)); }}>Remove</button>
            {index > 0 && <button className="shop-photo-main" disabled={Boolean(busy)} onClick={() => move(index, 0)}>Make main</button>}
          </figcaption>
        </figure>)}
        <label className={`shop-photo-add${busy ? " disabled" : ""}`}>
          <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" multiple disabled={Boolean(busy)} onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          <span aria-hidden="true">＋</span>
          {uploading ? <span><span>Uploading</span> <span>{uploading[0]}</span> <span>of</span> <span>{uploading[1]}</span></span> : <span>Add photos</span>}
        </label>
      </div>
    </section>

    <section className="shop-admin-section">
      <h3>Details</h3>
      <label>Product name<input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} /></label>
      <label>Description<textarea rows={6} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /><small>A blank line starts a new paragraph.</small></label>
    </section>

    <section className="shop-admin-section">
      <h3>Price</h3>
      <div className="shop-price-table">
        {product.variations.map((variation) => <label key={variation.id}>
          <span><strong>{variation.name || "Standard"}</strong>{variation.sku && <small>{`SKU ${variation.sku}`}</small>}</span>
          <span className="shop-price-input"><input inputMode="decimal" aria-invalid={invalidPrices.has(variation.id)} value={prices[variation.id] || ""} placeholder={variation.priceCents === null ? "Set at the till" : ""} aria-label={`Price of ${variation.name || "Standard"}`} onChange={(event) => setPrices((current) => ({ ...current, [variation.id]: event.target.value }))} /><b>$</b></span>
        </label>)}
      </div>
    </section>

    <section className="shop-admin-section">
      <h3>Promotion</h3>
      {promotions.map((promotion) => <div key={promotion.id} className="shop-promo-inline">
        <span className="shop-chip promo">{promotion.percentage ? `−${promotion.percentage} %` : STATUS_LABELS[promotion.status]}</span>
        <span><strong>{promotion.name}</strong><small>{promotionDates(promotion)}</small></span>
        {promotion.editable && <button className="secondary-button" onClick={() => { if (!dirty || ask("Close without saving your changes?")) onEditPromotion(promotion); }}>Edit</button>}
      </div>)}
      {!promotions.length && <p className="shop-admin-help">No promotion covers this product.</p>}
      <button className="secondary-button" onClick={() => { if (!dirty || ask("Close without saving your changes?")) onPromote(product); }}>Put this product on promotion</button>
    </section>

    <section className="shop-admin-section">
      <h3>Categories</h3>
      <CategoryChecklist categories={catalog.categories} selected={categoryIds} onChange={setCategoryIds} />
      {categoryIds.length > 1 && <label>Main category<select value={mainId} onChange={(event) => setMainCategoryId(event.target.value)}>
        {categoryIds.map((id) => <option key={id} value={id}>{categoryLabel(catalog.categories, id) || id}</option>)}
      </select><small>Its name is shown on the product’s card in the boutique.</small></label>}
    </section>
  </ShopModal>;
}

function PromotionEditor({ draft, catalog, onClose, onSaved }: { draft: PromotionDraft; catalog: Catalog; onClose: () => void; onSaved: (message: string) => void }) {
  const existing = draft.promotion;
  const [name, setName] = useState(existing?.name || "");
  const [percentage, setPercentage] = useState(existing?.percentage ? String(existing.percentage) : "");
  const [startsOn, setStartsOn] = useState(existing?.startsOn || catalog.today);
  const [endsOn, setEndsOn] = useState(existing?.endsOn || "");
  const [allProducts, setAllProducts] = useState(existing?.allProducts || false);
  const [categoryIds, setCategoryIds] = useState(existing?.categoryIds || []);
  const [productIds, setProductIds] = useState(draft.productIds);
  const [productQuery, setProductQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const covered = allProducts ? catalog.products.length : catalog.products.filter((product) => productIds.includes(product.id) || product.categoryIds.some((id) => categoryIds.includes(id))).length;
  const words = plain(productQuery).split(/\s+/).filter(Boolean);
  const choices = catalog.products.filter((product) => productIds.includes(product.id) || (words.length > 0 && words.every((word) => plain(product.name).includes(word)))).slice(0, 60);

  async function save() {
    setBusy(true); setError("");
    try {
      await post({ action: "save_promotion", id: existing?.id || "", name, percentage: Number(percentage.replace(",", ".")), startsOn, endsOn, allProducts, productIds, categoryIds });
      onSaved(`Saved in Square: ${name.trim()}`);
    } catch (reason) { setError(failure(reason, "The promotion could not be saved.")); setBusy(false); }
  }

  async function remove() {
    if (!existing || !ask("Delete this promotion? Square stops applying it right away.")) return;
    setBusy(true); setError("");
    try {
      await post({ action: "delete_promotion", id: existing.id });
      onSaved(`Deleted: ${existing.name}`);
    } catch (reason) { setError(failure(reason, "The promotion could not be deleted.")); setBusy(false); }
  }

  return <ShopModal wide title={existing ? existing.name : "New promotion"} eyebrow="Square automatic discount" onClose={() => { if (!busy) onClose(); }} footer={<>
    {existing && <button className="secondary-button danger" disabled={busy} onClick={() => void remove()}>Delete</button>}
    <span className="shop-admin-spacer" />
    <button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
    <button className="primary-button" disabled={busy || !name.trim() || !percentage || (!allProducts && !covered)} onClick={() => void save()}>{busy ? "Saving…" : "Save promotion"}</button>
  </>}>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <section className="shop-admin-section">
      <div className="field-pair">
        <label>Name<input value={name} maxLength={255} placeholder="Fall sale" onChange={(event) => setName(event.target.value)} /></label>
        <label>Discount (%)<input inputMode="decimal" value={percentage} placeholder="20" onChange={(event) => setPercentage(event.target.value)} /></label>
      </div>
      <div className="field-pair">
        <label>Starts on<input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label>Ends on<input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} /><small>Last day of the promotion. Leave empty to run it until you end it.</small></label>
      </div>
    </section>
    <section className="shop-admin-section">
      <h3>On promotion</h3>
      <div className="shop-admin-choice">
        <label><input type="radio" checked={!allProducts} onChange={() => setAllProducts(false)} /><span>Chosen categories and products</span></label>
        <label><input type="radio" checked={allProducts} onChange={() => setAllProducts(true)} /><span>The whole store</span></label>
      </div>
      {!allProducts && <>
        <h4>Categories</h4>
        <CategoryChecklist cascade categories={catalog.categories} selected={categoryIds} onChange={setCategoryIds} />
        <h4>Products</h4>
        <label className="shop-admin-search"><span>Find a product</span><input type="search" value={productQuery} placeholder="Product name" onChange={(event) => setProductQuery(event.target.value)} /></label>
        <div className="shop-product-picker">
          {choices.map((product) => <label key={product.id}>
            <input type="checkbox" checked={productIds.includes(product.id)} onChange={() => setProductIds((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} />
            <span>{product.name}</span><small>{priceRange(product)}</small>
          </label>)}
          {!choices.length && <p className="shop-admin-help">Type a name to add products one by one.</p>}
        </div>
      </>}
      <p className="shop-admin-summary"><strong>{covered}</strong> <span>{covered === 1 ? "product" : "products"}</span> <span>on promotion</span></p>
    </section>
  </ShopModal>;
}

function CategoryEditor({ category, catalog, onClose, onSaved }: { category: AdminCategory | null; catalog: Catalog; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(category?.name || "");
  const [parentId, setParentId] = useState(category?.parentId || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const hasChildren = Boolean(category && catalog.categories.some((entry) => entry.parentId === category.id));
  const parents = catalog.categories.filter((entry) => !entry.parentId && entry.id !== category?.id);

  async function save() {
    setBusy("save"); setError("");
    try {
      await post({ action: "save_category", id: category?.id || "", name, parentId });
      onSaved(`Saved in Square: ${name.trim()}`);
    } catch (reason) { setError(failure(reason, "The category could not be saved.")); setBusy(""); }
  }

  async function changePhoto(files: FileList | null) {
    if (!category || !files?.[0]) return;
    setBusy("photo"); setError("");
    try {
      await uploadPhoto(files[0], "category", category.id);
      onSaved(`Photo saved in Square: ${category.name}`);
    } catch (reason) { setError(failure(reason, "The photo could not be added.")); setBusy(""); }
  }

  return <ShopModal title={category ? category.name : "New category"} eyebrow="Square category" onClose={() => { if (!busy) onClose(); }} footer={<>
    <span className="shop-admin-spacer" />
    <button className="secondary-button" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>
    <button className="primary-button" disabled={Boolean(busy) || !name.trim()} onClick={() => void save()}>{busy === "save" ? "Saving…" : category ? "Save category" : "Create category"}</button>
  </>}>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <label>Name<input value={name} maxLength={255} placeholder="Collars" onChange={(event) => setName(event.target.value)} /></label>
    <label>Place in the boutique<select value={parentId} disabled={hasChildren} onChange={(event) => setParentId(event.target.value)}>
      <option value="">Main category (photo card)</option>
      {parents.map((parent) => <option key={parent.id} value={parent.id}>{`Subcategory of ${parent.name}`}</option>)}
    </select>{hasChildren && <small>This category has subcategories, so it stays a main category.</small>}</label>
    {category && <div className="shop-category-photo">
      <span className="shop-admin-thumb large">{category.imageUrl ? <img src={photo(category.imageUrl, 256)} alt="" /> : <span aria-hidden="true">▢</span>}</span>
      <div>
        <strong>Card photo</strong>
        <small>Shown on the category’s card at the top of the boutique.</small>
        <label className={`secondary-button shop-file-button${busy ? " disabled" : ""}`}>
          <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" disabled={Boolean(busy)} onChange={(event) => { void changePhoto(event.target.files); event.target.value = ""; }} />
          {busy === "photo" ? "Uploading…" : category.imageUrl ? "Change photo" : "Add a photo"}
        </label>
      </div>
    </div>}
  </ShopModal>;
}
