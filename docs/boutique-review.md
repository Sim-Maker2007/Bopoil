# Boutique review

Work based on the latest boutique update fetched from GitHub: `8e534f9`, branch `cursor/online-store-boutique-d28e` (September 6, 2026). Changes live in the separate `codex/boutique-ux` worktree, so the unfinished CRM changes in `bopoil-website` remain intact.

## Store experience

- Shorter photo introduction with a direct link to the products, preserving BOPOIL's typography and colors.
- Accent-insensitive search, category filtering, price/name sorting, and a reset action for searches with no results.
- Clear addition feedback and a link to open the cart; product-specific accessible labels.
- Cart quantities, subtotals, removal, refresh persistence, and cross-tab updates. Separate storage for preview and Square products.
- Phone-size cart, larger touch controls, reduced-motion support, background made inert while shopping in the cart, focus trapping, Escape dismissal, and focus restoration.
- Loading, empty-catalog, catalog outage/retry, and payment-failure states. Catalog failures no longer silently display sample products as purchasable merchandise.
- Unconnected store clearly labels the example catalog and disables checkout. No sample order emails are sent.

## Square corrections

- Corrected the catalog URL to `/v2/catalog/search` and followed pagination; the previous implementation used an invalid endpoint. [Square SearchCatalogObjects reference](https://developer.squareup.com/reference/square/catalog-api/search-catalog-objects).
- Included priced variations with their size/name, excluded archived/non-retail/deleted/unavailable items, and respected location price overrides and sold-out flags.
- Kept price resolution on Square, rejected partially unavailable carts rather than silently dropping lines, and reused the checkout idempotency key on retries.
- Enabled automatic application of the taxes configured in Square's catalog. The merchant still needs to validate its tax configuration. [Square order pricing options](https://developer.squareup.com/reference/square/objects/OrderPricingOptions).
- Removed the unverified “payment received” claim and cart deletion triggered by a query parameter. The return page points customers to their Square receipt and preserves their cart.

## Validation

- Production Next.js build, including TypeScript: passed.
- ESLint: passed.
- Automated suite: 139 tests passed, including 15 Square store tests.
- Browser: desktop plus 390px and 320px phone viewports; product search (including French accents), no-results/reset, categories, price sorting, add/increment/remove, subtotal, persistence, cart focus, and empty cart.
- Local fixture browser checks: live catalog with sizes, empty live catalog, unavailable catalog and retry, failed checkout preserving the cart, and a forged success-return parameter preserving the cart without claiming payment.
- No real payment was attempted. Temporary browser fixture removed after testing.

## Next integration stage

The UI and provider request logic are ready for integration testing; the store is not yet validated for live sales. Keep the existing Next.js/Vercel deployment architecture.

1. Configure the merchant's Square credentials/location and curate the real catalog, photos, variations, prices, taxes and availability.
2. Validate a real end-to-end checkout, final taxes, receipt, and the salon's pickup notification/fulfillment process. Inventory quantity enforcement needs validation with the merchant's Square settings; this change handles catalog/location availability flags.
3. Add server-verified order/payment status before displaying a paid confirmation or automatically clearing a purchased cart. No payment is inferred from a redirect URL.
4. Validate any other provider-dependent services (newsletter, transactional messages) when their keys are connected.

Changes are local for review; no production deployment or GitHub push was performed.
