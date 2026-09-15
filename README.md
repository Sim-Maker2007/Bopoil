# BOPOIL + Coat & Care

This repository contains both products deployed together on Vercel:

- `apps/web` — the existing BOPOIL public website, preserved as static HTML/CSS/JavaScript.
- `apps/coat-care` — the Coat & Care CRM and APIs, available under `/salon` and related protected routes.

The root build synchronizes the public website into the Next.js `public` directory without transforming its design. `/` serves the original BOPOIL `index.html`; Coat & Care lives at `/salon`. Square remains the appointment source of truth.

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

Database migrations are not applied by the Vercel build: after deploying a change that adds one under `apps/coat-care/drizzle/`, run `npm run db:migrate` with the production `DATABASE_URL`. Demo groomers and services are only seeded when `SEED_DEMO_DATA=true`, which belongs in a local `.env.local` and never in Vercel.

The public website's contact form, newsletter sign-up and information form post to `/api/public/contact`, `/api/public/newsletter` and `/api/public/intake`; the contact form needs Resend configured to deliver, and every form falls back to the visitor's mail app when the CRM is unreachable.
