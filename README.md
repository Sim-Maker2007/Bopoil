# BOPOIL + Coat & Care

This repository contains both products deployed together on Vercel:

- `apps/web` — the existing BOPOIL public website, preserved as static HTML/CSS/JavaScript.
- `apps/coat-care` — the Coat & Care CRM and APIs, available under `/salon` and related protected routes.

The root build synchronizes the public website into the Next.js `public` directory without transforming its design. It also dates each page in `sitemap.xml` by the last commit that changed it, when the build's git history reaches that commit (otherwise the committed date stays). `/` serves the original BOPOIL `index.html`; Coat & Care lives at `/salon`. Square remains the appointment source of truth.

The online boutique (`/boutique.html` and `/api/public/shop`) is feature-gated: it is hidden everywhere until `BOUTIQUE_ENABLED=true` is set, so it can be built and reviewed quietly before launch. See **Boutique gate** below.

## Local setup

Copy `apps/coat-care/.env.example` to `apps/coat-care/.env.local`, install dependencies from the repository root, migrate the database, then run the combined app:

```bash
npm install
npm run db:migrate
npm run dev
```

## Vercel deployment

Set the Vercel project's **Root Directory** to `apps/coat-care` and leave **Include files outside the root directory in the Build Step** enabled. The Next.js dependency and `vercel.json` are in that app directory. Its build synchronizes `apps/web` using the shared repository scripts, so both directories must be available. The app's `vercel.json` selects Next.js, runs `npm run build`, and uses `.next` as the output directory.

The Vercel project needs a Supabase Postgres database (`DATABASE_URL`, using the pooled Supavisor connection string) and a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`). Provider credentials such as Square and Resend belong in Vercel environment variables, never in the repository.

The app reads only `DATABASE_URL`, which points at the BOPOIL Supabase project (`fcnfvxhrmvnhvxugxmkx`); it uses none of the variables a Vercel Storage integration adds. Keep no other Supabase database connected to the Vercel project: Vercel provisions every connected database on each deployment, and Supabase pauses idle free databases after a week, so a forgotten one fails every new deployment within seconds at **Provisioning Integrations**. Disconnect such a database from the project instead of resuming it. A **No Next.js version detected** error means the Vercel Root Directory should be checked against `apps/coat-care/package.json`.

Set `SALON_OWNER_EMAIL` to the owner’s sign-in address. On the first secure sign-in, that address receives the BOPOIL owner profile for the Gatineau location. Set the Square tenant slugs to `bopoil` and `gatineau`.

The configured 15-minute operations job and hourly Square reconciliation require a Vercel Pro project; Vercel Hobby projects only permit daily cron jobs.

### Reservation gate

Online booking is switched off the same way. `ONLINE_BOOKING_ENABLED=true` opens the reservation flow; any other value, or no value, pauses it everywhere:

- every `/book…` page shows a short French notice with the salon phone, text and email (`apps/coat-care/app/reservation-pause/page.tsx`);
- the booking APIs (`/api/bookings`, `/api/square-bookings`, `/api/availability`, `/api/catalog`, `/api/booking-context`, `/api/client-auth/*`) answer 503;
- at build time the **Réserver en ligne** button on `rendez-vous.html` becomes the same notice.

The website's information form, the client portal, the salon workspace and Square webhooks keep working. Set the variable on Preview and Development while the flow is being finished, and on Production (then redeploy) to reopen reservations. Implemented by `apps/coat-care/lib/booking-gate.ts`, `apps/coat-care/proxy.ts` and `scripts/public-site-boutique.mjs`.

### Boutique gate

The store ships in every deployment but stays invisible until it is switched on. Two environment variables control it, and both are read at build time and at request time, so set them in Vercel → Settings → Environment Variables and redeploy after changing them:

| Variable | Effect |
|---|---|
| `BOUTIQUE_ENABLED=true` | Publishes the boutique: the **Boutique** navigation link and the header cart appear on every page, the Lucky Bones page links to the store's Lucky Bones category, the home page carousel opens on a boutique slide, `boutique.html` is listed in the sitemap, and the page, its assets, the cart's (`css/cart.css`, `js/cart.js`) and the shop API respond normally. Any other value, or no value, hides all of it; a browser unlocked with the preview key sees the cart on `boutique.html` only. |
| `BOUTIQUE_PREVIEW_KEY` | Optional secret of at least 8 characters. While the boutique is hidden, opening `https://www.bopoil.ca/boutique.html?apercu=<key>` once sets a private cookie on that browser for 30 days and unlocks the store there only. The key is removed from the address bar immediately. |

Recommended setup for working on the store without exposing it:

- **Production**: leave `BOUTIQUE_ENABLED` unset. Visitors get the site's ordinary 404 page on `/boutique.html`, the shop API answers 404, and nothing on the site links to the store. Set `BOUTIQUE_PREVIEW_KEY` so the team can still test the real Square checkout on the production domain from their own browsers.
- **Preview** and **Development**: set `BOUTIQUE_ENABLED=true` so every pull request deployment and local run shows the full store.

When the store is ready, set `BOUTIQUE_ENABLED=true` on Production and redeploy. The gate is implemented by `apps/coat-care/proxy.ts` (requests) and `scripts/sync-public-site.mjs` (navigation link and sitemap at build time); `apps/web` itself is never edited.

Product photos are Square's original uploads (often 2 000 to 3 000 pixels a side; decoded, the whole catalog weighed over 2 GB and iOS Safari kept reloading the page with « Un problème est survenu à répétition »). The boutique shows them through Next.js image optimization instead: `apps/web/js/cart.js` rewrites the Square bucket's addresses to `/_next/image` at 256 to 1 080 pixels, `apps/coat-care/next.config.ts` allows that bucket and caches each resized photo for a year (the addresses are content-hashed), and a photo the optimizer cannot serve falls back to its original address. Resized photos count toward the Vercel project's image transformations, roughly two or three per catalog photo, once.

The boutique search (`apps/web/js/shop-search.js`) looks through each product's name, variations, brand, categories and Square description, whatever the accents, capitals or plurals. It also understands common synonyms and English words (« gamelle » and « bowl » find the bols) and corrects small typing mistakes (« colier » shows « 11 produits pour « collier » »). The synonym list is at the top of that file: add a word to its line when shoppers search for it in vain. A search can be linked to, for a post or a newsletter: `https://www.bopoil.ca/boutique.html?recherche=shampooing`. A product whose Square name is only a model number (« SAFARI SW404 ») is found through its description alone and ranks after products named for what they are, so a descriptive Square name helps both the search and the product card.

### Online store admin

Owners and managers edit the boutique from the salon workspace (`/salon` → **Online store**) instead of the Square dashboard. Square stays the only catalog: every change is written to the Square catalog, so the shop's point of sale, Square's reports and the website always agree. The website shows a change within a couple of minutes (the shop API is cached for 60 seconds).

- **Products**: name, description, photos, the price of each size, categories, and the main category named on the boutique card. Photos are added, reordered and removed right away; the first one is the main photo. The browser resizes a photo to at most 2 000 pixels before sending it. A product the boutique does not list (no fixed price, sold out, or not offered at the salon's location) is flagged « Not on the website ».
- **Categories and subcategories**: one level of subcategories. Main categories are the photo cards of the boutique. Choosing one shows its subcategories as choices under the cards, and a product in a subcategory is listed in its main category too. Each category can be renamed, moved, and given its card photo. Categories are not deleted here, and new products are still created in Square.
- **Promotions**: a percentage off chosen products or categories, or the whole store, from a start date to a last day (read in the salon's time zone). Each one is saved as a Square automatic discount, which is a discount, a product set and a pricing rule. Square applies it at the till and at the boutique's checkout (`auto_apply_discounts`). The boutique shows the reduced price, the regular price struck through, and a « −20 % » badge; when several promotions cover a product, the largest is shown. A promotion set up in the Square dashboard with conditions this admin does not offer (a schedule, a customer group, a minimum order, a quantity, a fixed amount) is listed read-only. Square still applies it at checkout, but the boutique keeps showing the regular price for it.

The Square access token needs the `ITEMS_WRITE` permission to save changes; a personal access token from the Square Developer dashboard has it. The workspace permission is **Online store**: owners always have it, and it is ticked by default when a manager is added. A manager added before this feature does not have it, since their permissions were saved when they were added. Every change is recorded in `audit_events` (actions `boutique.*`). Make one test purchase with a promotion running to confirm that Square's checkout total matches the price the boutique shows. Implemented by `apps/coat-care/lib/shop-admin.ts`, `apps/coat-care/app/api/shop-admin/` and `apps/coat-care/app/salon/boutique-view.tsx`; the storefront side is in `apps/coat-care/lib/square-shop.ts` and `apps/web/js/boutique.js`.

Database migrations are not applied by the Vercel build: after deploying a change that adds one under `apps/coat-care/drizzle/`, run `npm run db:migrate` with the production `DATABASE_URL`. Demo groomers and services are only seeded when `SEED_DEMO_DATA=true`, which belongs in a local `.env.local` and never in Vercel.

The public website's contact form, newsletter sign-up and information form post to `/api/public/contact`, `/api/public/newsletter` and `/api/public/intake`. Contact messages and information forms are emailed to the salon inbox (the organization's contact address, `info@bopoil.ca`) through Resend, with the visitor as reply-to; an information form whose email or phone already belongs to a client is forwarded for review without changing that profile. Resend refusals appear in the Vercel function logs. The contact and newsletter forms fall back to the visitor's mail app when the CRM is unreachable.

The « Contactez-nous par texto » button and every `sms:` link on the website open Square's own "Text us" form (loaded on demand from Square's CDN with the location ID), so texts land in Square Messages and the salon replies by SMS from Square; the salon's phone line itself does not receive texts. The Square setting "Text us" must stay enabled for online booking (Messages → Settings). Configured under `square.textUs` in `apps/web/js/config.js`.
