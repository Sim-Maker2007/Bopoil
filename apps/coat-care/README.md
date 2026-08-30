# Coat & Care

Coat & Care is a full-stack pet-grooming salon operating system for Canada and the United States. It combines public booking, day-to-day salon operations, client and pet records, care documentation, communications, finance, reporting, and a private pet-parent portal.

## Product surfaces

- `/` — public service discovery, live availability, booking, and waitlist capture
- `/salon` — authenticated salon workspace for appointments, clients, pets, care, messages, team, finance, reporting, and settings
- `/portal` — passwordless pet-parent portal for pets, vaccinations, appointments, rescheduling, and care reports
- `/approval/:token` — secure client approval for unexpected care and price changes

Returning clients can opt into fast mobile sign-in from an authenticated portal
session. A six-digit, short-lived code restores a trusted browser session and
the booking experience can then reuse owned pets, recent services, and the
client's stored contact details. Entering a phone number alone never reveals or
attaches an existing profile. First-time and unenrolled clients can always use
the email-link or guest paths.

## Platform

- Vinext/React on Cloudflare Workers
- Cloudflare D1 for relational, tenant-scoped records
- Cloudflare R2 for protected grooming and vaccination documents
- Dispatch-owned Sign in with ChatGPT for salon staff
- Rotating, hashed magic-link sessions for pet parents
- Drizzle schema and ordered migrations under `drizzle/`

The application is designed around explicit organization and location ownership, role-based staff authorization, immutable financial events, audit records, and atomic capacity reservations.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

`npm run dev` applies every pending D1 migration to the project-local
Wrangler database before the server starts. Local state is kept under
`.wrangler/`; no production data is read or changed.

Useful checks:

```bash
npm run check
npm start
npm run db:generate
```

`npm start` builds the application, applies local migrations, and previews the
production bundle in Cloudflare's Workers runtime. This is intentionally
different from Vinext's Node-only server because the application uses D1, R2,
and Workers runtime imports.

## Communication providers

Messages remain in a safe manual queue when providers are not configured. Once credentials are present, newly queued messages are automatically handed to the appropriate provider, including provider-native scheduling where supported.

Copy `.env.example` to `.env.local` for local provider testing. Hosted values belong in Sites environment variables, never in source control.

Email uses Resend:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — a verified sender such as `Coat & Care <hello@example.com>`
- `RESEND_REPLY_TO` — optional salon reply address
- `RESEND_WEBHOOK_SECRET` — signing secret for `/api/webhooks/resend`

SMS uses a Twilio Messaging Service:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `DELIVERY_PUBLIC_URL` — the canonical HTTPS site origin used for Twilio's signed status callback

The public mobile sign-in option remains hidden until all three Twilio
credentials are configured. Verification challenges expire after ten minutes,
permit at most five attempts, are rate-limited by destination and source, and
store only a keyed code hash. Successful verification is required before an
existing phone identity is queried. Changing a profile phone number revokes any
verified identity that no longer matches, so the replacement number must be
verified before it can be used for fast sign-in.

The delivery engine normalizes Canada/US phone numbers, rechecks marketing consent, claims messages before sending, uses Resend idempotency keys, propagates scheduled-message cancellations, and preserves a manual fallback. A five-minute worker sweep advances due messages without waiting for a staff member to open the app.

Signed Resend and Twilio callbacks reconcile delivered, bounced, complained, suppressed, failed, and undelivered outcomes into the salon timeline. Provider event IDs are deduplicated, status changes never downgrade an already delivered message, and bad recipient coordinates are blocked until a staff member explicitly confirms them before creating a fresh retry. Configure Resend to send email events to `/api/webhooks/resend`; Twilio receives its callback URL on every message when `DELIVERY_PUBLIC_URL` is present.

## Square Appointments bridge

Square can remain the scheduling source of truth while Coat & Care handles pet records and day-of-care work. Configure `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_LOCATION_ID`, `SQUARE_ORGANIZATION_SLUG`, and `SQUARE_LOCATION_SLUG`, then register `booking.created` and `booking.updated` at `/api/webhooks/square`. The token needs appointment and customer read access; catalog and team-member read access improve service and groomer matching. Set `SQUARE_WEBHOOK_NOTIFICATION_URL` when the registered URL differs from `DELIVERY_PUBLIC_URL + /api/webhooks/square`; webhook signatures depend on an exact URL match. The API version defaults to `2026-07-15` and can be overridden with `SQUARE_API_VERSION`.

Square appointments are imported without Coat & Care confirmations or reminders, and the local public booking/deposit switches are disabled when the first Square booking syncs. Scheduling changes remain in Square; Coat & Care keeps operational stages, care notes, approvals, photos, and report cards. An hourly reconciliation recovers missed webhook deliveries. The BOPOIL information form posts to `/api/public/intake`; restrict it with `PUBLIC_INTAKE_ALLOWED_ORIGINS`.

## Payments and SaaS billing

Online money movement is disabled until Stripe credentials are present. Manual cash, terminal, e-transfer, and external ledger entries continue to work without them.

- Stripe Connect Express accounts onboard each salon and receive direct charges in CAD or USD.
- Stripe-hosted Checkout collects deposits and invoice balances without card data entering this application.
- Salons can require a service deposit during public booking. The opening is held for 30–60 minutes, confirms only from a verified paid event, and returns to live capacity after abandonment.
- A short webhook grace window prevents a valid deadline payment from losing its reservation; an impossibly late payment is returned automatically instead of creating a double booking.
- Managers may explicitly waive a pending deposit only after the live Checkout Session is safely expired.
- Verified, raw-body webhooks are the source of truth for payment and subscription state.
- A unique provider event ledger, deterministic idempotency keys, and one-open-checkout-per-invoice rule make retries safe.
- SaaS subscriptions run on the platform account and remain separate from salon client revenue.

Required hosted secrets and configuration:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` — signing secret for the Connect-enabled webhook endpoint at `/api/stripe/webhook`
- `STRIPE_APPLICATION_FEE_BPS` — optional platform fee, in basis points
- `STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, and `STRIPE_MULTI_PRICE_ID`

Before enabling live payments, configure Canada and United States onboarding in Stripe Connect, set the platform branding, register the webhook events used in `app/api/stripe/webhook/route.ts`, and complete an end-to-end test-mode payment and refund rehearsal.

## Salon books and closeouts

The finance workspace keeps an append-only operational book alongside the payment ledger:

- Owner/manager cash closeouts snapshot expected and counted cash, tender totals, refunds, tax, tips, and transaction count. Later ledger activity is shown as drift and requires an explicit audited reopen before replacement.
- Owners, managers, and accountants can post expenses with vendor, description, category, payment proof, operating/capital/non-deductible treatment, business-use percentage, and explicitly marked recoverable tax.
- Supplier receipts and invoices are signature-checked and stored privately in R2; voided expenses remain visible instead of being deleted.
- Cash-basis management summaries separate net sales, pass-through tips, sales tax, recoverable input tax, operating expenses, capital purchases, and estimated operating profit.
- Journal, expense, and summary CSV exports neutralize spreadsheet formulas and preserve tenant/location/date boundaries.

These figures are management estimates, not tax filings. Tax treatment, input-tax-credit eligibility, depreciation, payroll liabilities, and filing amounts must be confirmed with the salon's accountant. Keep original supporting documents according to the applicable Canadian or United States recordkeeping rules.

## Inventory and purchasing

The inventory workspace uses an immutable movement ledger so stock cannot silently change:

- Grooming supplies and retail products carry a SKU/barcode, stock unit, preferred supplier, reorder point, target level, preferred order quantity, cost, and retail price.
- Staff can record product use, retail sales, waste, and physical counts. Every movement keeps its quantity, weighted-average management cost, date, lot/expiry context, operator, and retry-safe request key.
- Optimistic stock-version claims prevent simultaneous staff actions or purchase-order receipts from consuming the same on-hand balance twice.
- Owners and managers maintain supplier contacts and payment terms, create draft purchase orders, place them, cancel with a reason, and receive the full delivery into stock atomically.
- Reorder alerts suggest quantities that restore target stock. Stock, movement, and purchase-order CSV exports preserve location and reporting-period boundaries and neutralize spreadsheet formulas.
- The workspace separates grooming-supply consumption, retail cost of goods, waste, purchases, and inventory value. These are perpetual management estimates; year-end counts and the accounting/tax valuation method still require accountant review.

## Data changes

Edit `db/schema.ts`, run `npm run db:generate`, inspect the generated SQL, then verify the entire migration chain against a fresh Postgres database (`npm run db:migrate` with DATABASE_URL pointed at it) before publishing.

`.openai/hosting.json` contains only the Sites project identifier and logical D1/R2 bindings. Runtime secrets are managed by Sites.
