# BOPOIL + Coat & Care

This repository contains both products deployed together on Vercel:

- `apps/web` — the existing BOPOIL public website, preserved as static HTML/CSS/JavaScript.
- `apps/coat-care` — the Coat & Care CRM and APIs, available under `/salon` and related protected routes.

The root build synchronizes the public website into the Next.js `public` directory without transforming its design. `/` serves the original BOPOIL `index.html`; Coat & Care lives at `/salon`. Square remains the appointment source of truth.

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

If a deployment stops at **Provisioning Integrations**, inspect the connected Supabase resource. A paused database must be resumed in the Supabase dashboard before retrying the deployment. A **No Next.js version detected** error means the Vercel Root Directory should be checked against `apps/coat-care/package.json`.

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
| `BOUTIQUE_ENABLED=true` | Publishes the boutique: the **Boutique** navigation link appears on every page, `boutique.html` is listed in the sitemap, and the page, its assets and the shop API respond normally. Any other value, or no value, hides all of it. |
| `BOUTIQUE_PREVIEW_KEY` | Optional secret of at least 8 characters. While the boutique is hidden, opening `https://www.bopoil.ca/boutique.html?apercu=<key>` once sets a private cookie on that browser for 30 days and unlocks the store there only. The key is removed from the address bar immediately. |

Recommended setup for working on the store without exposing it:

- **Production**: leave `BOUTIQUE_ENABLED` unset. Visitors get the site's ordinary 404 page on `/boutique.html`, the shop API answers 404, and nothing on the site links to the store. Set `BOUTIQUE_PREVIEW_KEY` so the team can still test the real Square checkout on the production domain from their own browsers.
- **Preview** and **Development**: set `BOUTIQUE_ENABLED=true` so every pull request deployment and local run shows the full store.

When the store is ready, set `BOUTIQUE_ENABLED=true` on Production and redeploy. The gate is implemented by `apps/coat-care/proxy.ts` (requests) and `scripts/sync-public-site.mjs` (navigation link and sitemap at build time); `apps/web` itself is never edited.

Database migrations are not applied by the Vercel build: after deploying a change that adds one under `apps/coat-care/drizzle/`, run `npm run db:migrate` with the production `DATABASE_URL`. Demo groomers and services are only seeded when `SEED_DEMO_DATA=true`, which belongs in a local `.env.local` and never in Vercel.

The public website's contact form, newsletter sign-up and information form post to `/api/public/contact`, `/api/public/newsletter` and `/api/public/intake`; the contact form needs Resend configured to deliver, and every form falls back to the visitor's mail app when the CRM is unreachable.
