// Build-time half of the boutique gate (the request-time half lives in
// apps/coat-care/proxy.ts). While the store is hidden, the synchronized copy of
// the public website carries no "Boutique" navigation link and no sitemap entry,
// so nothing on the live site points to the page.

export const BOUTIQUE_ENABLED_VARIABLE = "BOUTIQUE_ENABLED";

const navigationItem = /\s*<li class="nav-item"><a class="nav-link" href="boutique\.html"[^>]*>Boutique<\/a><\/li>/g;
const sitemapEntry = /\s*<url><loc>[^<]*\/boutique\.html<\/loc>(?:(?!<\/url>).)*<\/url>/gs;

export function boutiqueEnabled(env = process.env) {
  return (env[BOUTIQUE_ENABLED_VARIABLE] || "").trim().toLowerCase() === "true";
}

export function hideBoutiqueInHtml(html) {
  return html.replace(navigationItem, "");
}

export function hideBoutiqueInSitemap(xml) {
  return xml.replace(sitemapEntry, "");
}

// Returns the transformed file content, or null when the file is copied verbatim.
export function transformPublicFile(name, content, env = process.env) {
  if (boutiqueEnabled(env)) return null;
  if (name.endsWith(".html")) return hideBoutiqueInHtml(content);
  if (name === "sitemap.xml") return hideBoutiqueInSitemap(content);
  return null;
}
