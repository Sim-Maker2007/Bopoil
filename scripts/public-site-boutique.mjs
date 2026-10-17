// Build-time half of the boutique gate (the request-time half lives in
// apps/coat-care/proxy.ts). While the store is hidden, the synchronized copy of
// the public website carries no "Boutique" navigation link, no cart, no
// boutique slide on the home page and no sitemap entry, so nothing on the live
// site points to the page.

export const BOUTIQUE_ENABLED_VARIABLE = "BOUTIQUE_ENABLED";
// Build-time half of the reservation gate (request-time half in
// apps/coat-care/lib/booking-gate.ts): while online booking is paused, the
// « Réserver en ligne » button on rendez-vous.html becomes a short notice.
export const ONLINE_BOOKING_ENABLED_VARIABLE = "ONLINE_BOOKING_ENABLED";

const navigationItem = /\s*<li class="nav-item"><a class="nav-link" href="boutique\.html"[^>]*>Boutique<\/a><\/li>/g;
// The cart every page carries: header button, drawer, stylesheet and script.
// boutique.html keeps its own, for browsers unlocked with the preview key.
const cartPieces = [
  /\s*<link rel="stylesheet" href="css\/cart\.css">/g,
  /\s*<button class="cart-btn"[^>]*>[\s\S]*?<\/button>/g,
  /\s*<div class="cart-overlay"[^>]*><\/div>\s*<aside class="cart-drawer"[^>]*>[\s\S]*?<\/aside>/g,
  /\s*<script src="js\/cart\.js" defer><\/script>/g,
];
// The boutique slide opens the home page carousel, followed by the welcome slide.
const boutiqueSlide = /\s*<div class="hero-slide"[^>]*\bdata-boutique-slide\b[^>]*>[\s\S]*?(?=\s*<div class="hero-slide")/;
const lastHeroDot = /<button class="hero-dot"[^>]*><\/button>(?=\s*<\/div>\s*<\/section>)/;
const slideNumber = /(aria-roledescription="diapositive" aria-label=")(\d+) de (\d+)"/g;
const sitemapEntry = /\s*<url><loc>[^<]*\/boutique\.html<\/loc>(?:(?!<\/url>).)*<\/url>/gs;

export function boutiqueEnabled(env = process.env) {
  return (env[BOUTIQUE_ENABLED_VARIABLE] || "").trim().toLowerCase() === "true";
}

export function onlineBookingEnabled(env = process.env) {
  return (env[ONLINE_BOOKING_ENABLED_VARIABLE] || "").trim().toLowerCase() === "true";
}

const bookingButton = /<a class="btn btn--filled btn--large" data-booking-link=""\s+href="[^"]*">Réserver en ligne<\/a>/;
// Inline styles so apps/web itself stays untouched, as with the boutique gate.
const bookingPauseNotice = '<p class="booking-cta__pause" style="margin:0;padding:14px 18px;border-radius:12px;background:#F2EDE3;max-width:40ch"><strong>La réservation en ligne fait une petite pause.</strong> Appelez-nous au <a href="tel:+18199682827" style="white-space:nowrap">(819) 968-2827</a> ou envoyez un texto : nous prenons vos rendez-vous avec plaisir.</p>';

export function pauseBookingInHtml(html) {
  return html.replace(bookingButton, bookingPauseNotice);
}

export function hideBoutiqueInHtml(html) {
  return html.replace(navigationItem, "");
}

export function hideCartInHtml(html) {
  return cartPieces.reduce((output, piece) => output.replace(piece, ""), html);
}

// Without its boutique slide, the carousel is the one the home page had before:
// the welcome slide is first, shown, numbered 1 and its photo loaded first.
export function hideBoutiqueSlide(html) {
  if (!boutiqueSlide.test(html)) return html;
  return html
    .replace(boutiqueSlide, "")
    .replace(lastHeroDot, "")
    .replace(slideNumber, (_, start, number, total) => `${start}${number - 1} de ${total - 1}"`)
    .replace('<div class="hero-slide" data-active="false" aria-hidden="true"', '<div class="hero-slide" data-active="true" aria-hidden="false"')
    .replace('loading="eager" decoding="async"', 'loading="eager" fetchpriority="high" decoding="async"');
}

export function hideBoutiqueInSitemap(xml) {
  return xml.replace(sitemapEntry, "");
}

// Brings each page's <lastmod> up to the date of its last change, as given by
// dateOf(file name) — "" when unknown, which keeps the committed date.
export function refreshSitemapDates(xml, dateOf) {
  return xml.replace(/(<loc>https:\/\/[^/<]+\/([^<]*)<\/loc><lastmod>)([^<]*)/g, (_, start, path, current) => {
    const date = dateOf(path || "index.html");
    return start + (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > current ? date : current);
  });
}

// Returns the transformed file content, or null when the file is copied verbatim.
// dateOf, when given, dates the sitemap's pages (see refreshSitemapDates).
export function transformPublicFile(name, content, env = process.env, dateOf = null) {
  let output = content;
  if (name === "sitemap.xml" && dateOf) output = refreshSitemapDates(output, dateOf);
  if (!boutiqueEnabled(env)) {
    if (name.endsWith(".html")) output = hideBoutiqueInHtml(output);
    if (name.endsWith(".html") && name !== "boutique.html") output = hideCartInHtml(output);
    if (name === "index.html") output = hideBoutiqueSlide(output);
    if (name === "sitemap.xml") output = hideBoutiqueInSitemap(output);
  }
  if (!onlineBookingEnabled(env) && name === "rendez-vous.html") output = pauseBookingInHtml(output);
  return output === content ? null : output;
}
