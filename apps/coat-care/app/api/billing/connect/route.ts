import { eq } from "drizzle-orm";
import { organizations, paymentProviderAccounts } from "../../../../db/schema";
import { stripeConfig, stripeRequest } from "../../../../lib/stripe";
import { requireSalonAccess, requireSalonOwner, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../../salon-access";

type StripeAccount = { id: string; details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean; country?: string; default_currency?: string };

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); requireSalonOwner(membership);
    if (!stripeConfig().configured) throw new SalonAccessError("Add Stripe credentials before connecting payouts.", 409);
    const body = await request.json() as { action?: string }; const action = body.action || "onboard"; const origin = new URL(request.url).origin;
    const [[organization], [stored]] = await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1),
      db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1),
    ]);
    if (!organization) throw new SalonAccessError("Salon not found.", 404);
    let account: StripeAccount;
    if (stored) account = await stripeRequest<StripeAccount>(`accounts/${stored.connectedAccountId}`, {}, { method: "GET" });
    else {
      account = await stripeRequest<StripeAccount>("accounts", { type: "express", country: organization.country, email: organization.contactEmail || undefined, "business_profile[name]": organization.name, "metadata[organization_id]": organization.id }, { idempotencyKey: `connect:${organization.id}` });
    }
    const status = account.charges_enabled && account.payouts_enabled ? "active" : account.details_submitted ? "restricted" : "pending";
    await db.insert(paymentProviderAccounts).values({ id: stored?.id || crypto.randomUUID(), organizationId: organization.id, connectedAccountId: account.id, country: account.country || organization.country, defaultCurrency: (account.default_currency || organization.currency).toUpperCase(), detailsSubmitted: Boolean(account.details_submitted), chargesEnabled: Boolean(account.charges_enabled), payoutsEnabled: Boolean(account.payouts_enabled), onboardingStatus: status, lastSyncedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: paymentProviderAccounts.organizationId, set: { detailsSubmitted: Boolean(account.details_submitted), chargesEnabled: Boolean(account.charges_enabled), payoutsEnabled: Boolean(account.payouts_enabled), onboardingStatus: status, lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    if (action === "dashboard") {
      if (!account.details_submitted) throw new SalonAccessError("Finish payout onboarding before opening the Stripe dashboard.", 409);
      const link = await stripeRequest<{ id: string; url?: string }>(`accounts/${account.id}/login_links`); if (!link.url) throw new Error("Stripe did not return a dashboard URL."); return Response.json({ url: link.url });
    }
    const link = await stripeRequest<{ id: string; url?: string }>("account_links", { account: account.id, refresh_url: `${origin}/salon?connect=refresh`, return_url: `${origin}/salon?connect=return`, type: "account_onboarding" });
    if (!link.url) throw new Error("Stripe did not return an onboarding URL."); return Response.json({ url: link.url });
  } catch (error) { return salonApiError(error, "Payout setup failed"); }
}
