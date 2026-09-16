// Build-time half of the boutique gate (the request-time half lives in
// apps/coat-care/proxy.ts). While the store is hidden, the synchronized copy of
// the public website carries no "Boutique" navigation link and no sitemap entry,
// so nothing on the live site points to the page.

export const BOUTIQUE_ENABLED_VARIABLE = "BOUTIQUE_ENABLED";
// Build-time half of the reservation gate (request-time half in
// apps/coat-care/lib/booking-gate.ts): while online booking is paused, the
// « Réserver en ligne » button on rendez-vous.html becomes a short notice.
export const ONLINE_BOOKING_ENABLED_VARIABLE = "ONLINE_BOOKING_ENABLED";

const navigationItem = /\s*<li class="nav-item"><a class="nav-link" href="boutique\.html"[^>]*>Boutique<\/a><\/li>/g;
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

export function hideBoutiqueInSitemap(xml) {
  return xml.replace(sitemapEntry, "");
}

// Returns the transformed file content, or null when the file is copied verbatim.
export function transformPublicFile(name, content, env = process.env) {
  let output = content;
  if (!boutiqueEnabled(env)) {
    if (name.endsWith(".html")) output = hideBoutiqueInHtml(output);
    if (name === "sitemap.xml") output = hideBoutiqueInSitemap(output);
  }
  if (!onlineBookingEnabled(env) && name === "rendez-vous.html") output = pauseBookingInHtml(output);
  return output === content ? null : output;
}
