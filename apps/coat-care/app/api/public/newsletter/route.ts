import { and, eq, sql } from "drizzle-orm";
import type { DbBatchItem } from "../../../../db";
import { auditEvents, clients, consentRecords, publicIntakeSubmissions } from "../../../../db/schema";
import { resolveStorefront, storefrontError } from "../../../../db/public-storefront";
import { cleanText, emailPattern, publicFormPreflight, publicFormResponse, publicSubmissionGate } from "../../../../lib/public-forms";
import { intakeOriginAllowed, squareConfig } from "../../../../lib/square";

type NewsletterPayload = {
  salonSlug?: string;
  locationSlug?: string;
  submissionId?: string;
  website?: string;
  email?: string;
};

// Consent proof for Canada's anti-spam law: the version of the sign-up wording
// the visitor saw. Bump it whenever the footer copy changes.
const NEWSLETTER_POLICY_VERSION = "bopoil-website-newsletter-2026-09";

export const OPTIONS = publicFormPreflight;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!intakeOriginAllowed(origin)) return publicFormResponse(origin, { error: "Ce formulaire n'est pas autorisé depuis cette adresse." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 4_000) return publicFormResponse(origin, { error: "La demande est trop volumineuse." }, 413);
  try {
    const payload = await request.json() as NewsletterPayload;
    if (cleanText(payload.website, 100)) return publicFormResponse(origin, { received: true });
    const email = cleanText(payload.email, 180).toLowerCase();
    if (!email || !emailPattern.test(email)) return publicFormResponse(origin, { error: "Veuillez vérifier l'adresse courriel." }, 400);
    const config = squareConfig();
    const { db, organization, location } = await resolveStorefront({
      organizationSlug: config.organizationSlug || payload.salonSlug,
      locationSlug: config.locationSlug || payload.locationSlug,
    });
    const submissionKey = `newsletter:${cleanText(payload.submissionId, 100) || crypto.randomUUID()}`;
    const gate = await publicSubmissionGate(db, { organizationId: organization.id, request, submissionKey, contact: email, kind: "newsletter" });
    if (gate.duplicate) return publicFormResponse(origin, { received: true });
    if (gate.limited) return publicFormResponse(origin, { error: "Veuillez patienter avant de réessayer." }, 429);
    const [existing] = await db.select({ id: clients.id, marketingConsent: clients.marketingConsent }).from(clients).where(and(
      eq(clients.organizationId, organization.id),
      eq(sql<string>`lower(${clients.email})`, email),
    )).limit(1);
    const clientId = existing?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const statements: DbBatchItem[] = [];
    if (existing) statements.push(db.update(clients).set({ marketingConsent: true, updatedAt: now }).where(and(eq(clients.id, clientId), eq(clients.organizationId, organization.id))));
    else statements.push(db.insert(clients).values({ id: clientId, organizationId: organization.id, fullName: "Abonné infolettre", email, phone: "", marketingConsent: true }));
    statements.push(
      db.insert(consentRecords).values({ id: crypto.randomUUID(), organizationId: organization.id, clientId, type: "marketing", policyVersion: NEWSLETTER_POLICY_VERSION, accepted: true, source: "bopoil_website_newsletter" }),
      db.insert(publicIntakeSubmissions).values({
        id: crypto.randomUUID(), organizationId: organization.id, locationId: location.id, clientId,
        submissionKey, sourceHash: gate.sourceHash, contactHash: gate.contactHash, status: "processed",
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(), organizationId: organization.id, actorType: "client", actorId: clientId,
        action: existing ? "newsletter.consent_confirmed" : "newsletter.subscribed",
        entityType: "client", entityId: clientId,
        detailsJson: JSON.stringify({ source: "bopoil.ca", locationId: location.id, policyVersion: NEWSLETTER_POLICY_VERSION }),
      }),
    );
    await db.batch(statements as [DbBatchItem, ...DbBatchItem[]]);
    return publicFormResponse(origin, { received: true });
  } catch (error) {
    if (error instanceof SyntaxError) return publicFormResponse(origin, { error: "La demande n'a pas pu être lue." }, 400);
    const handled = storefrontError(error, "L'inscription n'a pas pu être enregistrée.");
    const body = await handled.json() as Record<string, unknown>;
    return publicFormResponse(origin, body, handled.status);
  }
}
