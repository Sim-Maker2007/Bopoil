import { and, desc, eq, sql } from "drizzle-orm";
import { issuePortalEmailSession, sha256 } from "../../../../db/client-portal";
import { queuePortalAccessMessage } from "../../../../db/communications";
import { appointments, auditEvents, clients, pets, portalAccessRequests } from "../../../../db/schema";
import { resolveStorefront } from "../../../../db/public-storefront";
import { deliveryConfig } from "../../../../lib/message-delivery";
import { portalAccessUrl, safePortalReturnTo } from "../../../../lib/portal-links";

function privateResponse(contact?: { phone: string; email: string }) {
  const automaticEmail = deliveryConfig().email.configured;
  return {
    message: automaticEmail
      ? "If that email matches a client account, a fresh private link is on its way."
      : "If that email matches a client account, the request is ready for salon staff. Automatic email is not configured, so contact the salon if you need access right away.",
    deliveryMode: automaticEmail ? "automatic_email" : "staff_assisted",
    ...(contact ? { contact } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; petName?: string; salonSlug?: string; locationSlug?: string; returnTo?: string }; const email = String(body.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    const storefront = await resolveStorefront({ organizationSlug: body.salonSlug, locationSlug: body.locationSlug }); const { db, organization, location } = storefront;
    const response = privateResponse({ phone: organization.contactPhone, email: organization.contactEmail });
    const emailHash = await sha256(`${organization.id}:${email}`); const source = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"; const sourceHash = await sha256(`${organization.id}:${source}`);
    const requestedAt = new Date().toISOString();
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const recentEnough = sql<boolean>`datetime(${portalAccessRequests.requestedAt}) >= datetime(${cutoff})`;
    const [recentEmail, recentSource] = await Promise.all([db.select({ id: portalAccessRequests.id }).from(portalAccessRequests).where(and(eq(portalAccessRequests.organizationId, organization.id), eq(portalAccessRequests.emailHash, emailHash), recentEnough)).limit(3), db.select({ id: portalAccessRequests.id }).from(portalAccessRequests).where(and(eq(portalAccessRequests.organizationId, organization.id), eq(portalAccessRequests.sourceHash, sourceHash), recentEnough)).limit(10)]);
    if (recentEmail.length >= 3 || recentSource.length >= 10) return Response.json(response);
    await db.insert(portalAccessRequests).values({ id: crypto.randomUUID(), organizationId: organization.id, emailHash, sourceHash, requestedAt });
    const [client] = await db.select().from(clients).where(and(eq(clients.organizationId, organization.id), eq(sql<string>`lower(${clients.email})`, email))).limit(1);
    if (client) {
      const [latest] = await db.select({ locationId: appointments.locationId }).from(appointments).where(and(eq(appointments.organizationId, organization.id), eq(appointments.clientId, client.id))).orderBy(desc(appointments.createdAt)).limit(1);
      let returnTo = safePortalReturnTo(body.returnTo);
      const petName = String(body.petName || "").trim().toLowerCase();
      if (returnTo.startsWith("/book/") && petName) {
        const [matchingPet] = await db.select({ id: pets.id }).from(pets).where(and(
          eq(pets.organizationId, organization.id),
          eq(pets.clientId, client.id),
          eq(sql<string>`lower(${pets.name})`, petName),
        )).limit(1);
        if (matchingPet) {
          const destination = new URL(returnTo, "https://portal.invalid");
          destination.searchParams.set("pet", matchingPet.id);
          returnTo = `${destination.pathname}${destination.search}${destination.hash}`;
        }
      }
      const session = await issuePortalEmailSession(db, client.id); const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, session.token, returnTo);
      await queuePortalAccessMessage(db, { clientId: client.id, locationId: latest?.locationId || location.id, portalUrl, dedupeKey: `portal_access:${session.id}` });
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: organization.id, actorType: "system", action: "client.portal_link_requested", entityType: "client", entityId: client.id, detailsJson: JSON.stringify({ sessionId: session.id, storefront: organization.slug }) });
    }
    return Response.json(response);
  } catch {
    return Response.json(privateResponse());
  }
}
