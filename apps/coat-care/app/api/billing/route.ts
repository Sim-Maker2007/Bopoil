import { and, eq } from "drizzle-orm";
import { organizationSubscriptions, organizations, paymentProviderAccounts } from "../../../db/schema";
import { publicStripeConfig, stripeConfig, stripeRequest } from "../../../lib/stripe";
import { requireSalonAccess, requireSalonOwner, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

const plans = {
  starter: { name: "Starter", description: "One location with booking, care, clients, and finance." },
  growth: { name: "Growth", description: "Automation, online payments, reporting, and a larger team." },
  multi: { name: "Multi-location", description: "One organization across every salon location." },
} as const;

async function payload(db: ReturnType<typeof import("../../../db").getDb>, organizationId: string, owner: boolean) {
  const [[account], [subscription]] = await Promise.all([
    db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, organizationId)).limit(1),
    db.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1),
  ]);
  const config = publicStripeConfig();
  return { provider: "Stripe", config, account: account || null, subscription: subscription || null, plans: Object.entries(plans).map(([key, plan]) => ({ key, ...plan, configured: config.plansConfigured[key] })), canManage: owner };
}

export async function GET() {
  try { const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); return Response.json(await payload(db, membership.organizationId, membership.role === "owner")); }
  catch (error) { return salonApiError(error, "Billing unavailable"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); requireSalonOwner(membership);
    const body = await request.json() as Record<string, unknown>; const action = String(body.action || ""); const origin = new URL(request.url).origin;
    const config = stripeConfig(); if (!config.configured) throw new SalonAccessError("Add Stripe credentials before enabling live billing.", 409);
    const [[organization], subscriptionRows] = await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1),
      db.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, membership.organizationId)).limit(1),
    ]);
    let subscription = subscriptionRows[0];
    if (!organization) throw new SalonAccessError("Salon not found.", 404);
    if (action === "subscribe") {
      const plan = String(body.plan || "") as keyof typeof plans; if (!(plan in plans)) throw new SalonAccessError("Choose a valid plan.", 400);
      const price = config.prices[plan]; if (!price) throw new SalonAccessError(`${plans[plan].name} billing is not configured yet.`, 409);
      const staleIncomplete = Boolean(subscription && subscription.status === "incomplete" && !subscription.providerSubscriptionId && new Date(subscription.updatedAt).getTime() < Date.now() - 24 * 60 * 60 * 1000);
      if (subscription?.providerSubscriptionId && subscription.status !== "cancelled") {
        if (subscription.plan === plan && ["trialing", "active"].includes(subscription.status)) throw new SalonAccessError(`${plans[plan].name} is already active. Use the billing portal to manage it.`, 409);
        throw new SalonAccessError("A subscription already exists. Use the billing portal to change plans, update payment details, or resolve its status.", 409);
      }
      if (subscription && subscription.status !== "cancelled" && !staleIncomplete && (subscription.status !== "incomplete" || subscription.plan !== plan)) {
        if (subscription.plan === plan && ["trialing", "active"].includes(subscription.status)) throw new SalonAccessError(`${plans[plan].name} is already active. Use the billing portal to manage it.`, 409);
        throw new SalonAccessError("A subscription or checkout is already in progress. Use the billing portal or finish the existing checkout before choosing another plan.", 409);
      }
      const claimTime = new Date().toISOString();
      if (!subscription) {
        const [claimed] = await db.insert(organizationSubscriptions).values({ id: crypto.randomUUID(), organizationId: organization.id, plan, status: "incomplete", updatedAt: claimTime }).onConflictDoNothing().returning();
        if (claimed) subscription = claimed;
        else [subscription] = await db.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organization.id)).limit(1);
      } else if (subscription.status === "cancelled" || staleIncomplete) {
        const expectedStatus = subscription.status;
        const [claimed] = await db.update(organizationSubscriptions).set({ plan, status: "incomplete", providerSubscriptionId: "", providerPriceId: "", cancelAtPeriodEnd: false, updatedAt: claimTime }).where(and(eq(organizationSubscriptions.id, subscription.id), eq(organizationSubscriptions.status, expectedStatus), eq(organizationSubscriptions.updatedAt, subscription.updatedAt))).returning();
        if (claimed) subscription = claimed;
        else [subscription] = await db.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organization.id)).limit(1);
      }
      if (!subscription || subscription.status !== "incomplete" || subscription.plan !== plan || subscription.providerSubscriptionId) {
        throw new SalonAccessError("Another subscription checkout is already in progress. Refresh billing before trying again.", 409);
      }
      const session = await stripeRequest<{ id: string; url?: string }>("checkout/sessions", {
        mode: "subscription", "line_items[0][price]": price, "line_items[0][quantity]": 1,
        success_url: `${origin}/salon?billing=success`, cancel_url: `${origin}/salon?billing=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        client_reference_id: organization.id, "metadata[organization_id]": organization.id, "metadata[plan]": plan,
        "subscription_data[metadata][organization_id]": organization.id, "subscription_data[metadata][plan]": plan,
        ...(subscription?.providerCustomerId ? { customer: subscription.providerCustomerId } : { customer_email: organization.contactEmail || undefined }),
        allow_promotion_codes: true,
      }, { idempotencyKey: `subscription-checkout:${organization.id}:${plan}:${subscription.updatedAt}` });
      if (!session.url) throw new Error("Stripe did not return a checkout URL."); return Response.json({ url: session.url });
    }
    if (action === "portal") {
      if (!subscription?.providerCustomerId) throw new SalonAccessError("A billing customer does not exist yet.", 409);
      const session = await stripeRequest<{ id: string; url?: string }>("billing_portal/sessions", { customer: subscription.providerCustomerId, return_url: `${origin}/salon` });
      if (!session.url) throw new Error("Stripe did not return a billing portal URL."); return Response.json({ url: session.url });
    }
    throw new SalonAccessError("Unknown billing action.", 400);
  } catch (error) { return salonApiError(error, "Billing action failed"); }
}
