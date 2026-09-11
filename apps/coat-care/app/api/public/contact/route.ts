import type { DbBatchItem } from "../../../../db";
import { auditEvents, publicIntakeSubmissions } from "../../../../db/schema";
import { resolveStorefront, storefrontError } from "../../../../db/public-storefront";
import { deliveryConfig } from "../../../../lib/message-delivery";
import { emailHtml } from "../../../../lib/message-provider-payloads";
import { cleanText, emailPattern, publicFormPreflight, publicFormResponse, publicSubmissionGate } from "../../../../lib/public-forms";
import { intakeOriginAllowed, squareConfig } from "../../../../lib/square";

type ContactPayload = {
  salonSlug?: string;
  locationSlug?: string;
  submissionId?: string;
  website?: string;
  nom?: string;
  email?: string;
  message?: string;
};

const UNAVAILABLE = "L'envoi direct est temporairement indisponible. Écrivez-nous à info@bopoil.ca.";

export const OPTIONS = publicFormPreflight;

// Delivers the website contact form to the salon inbox through Resend, with
// the visitor as reply-to. The message body is never stored; the ledger only
// keeps the hashed source and contact for rate limiting, plus an audit entry.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!intakeOriginAllowed(origin)) return publicFormResponse(origin, { error: "Ce formulaire n'est pas autorisé depuis cette adresse." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 12_000) return publicFormResponse(origin, { error: "Le message est trop volumineux." }, 413);
  try {
    const payload = await request.json() as ContactPayload;
    if (cleanText(payload.website, 100)) return publicFormResponse(origin, { received: true });
    const name = cleanText(payload.nom, 100);
    const email = cleanText(payload.email, 180).toLowerCase();
    const message = cleanText(payload.message, 5000);
    if (name.length < 2 || !emailPattern.test(email) || message.length < 3) {
      return publicFormResponse(origin, { error: "Veuillez indiquer votre nom, votre courriel et votre message." }, 400);
    }
    const delivery = deliveryConfig();
    if (!delivery.email.configured) return publicFormResponse(origin, { error: UNAVAILABLE }, 503);
    const config = squareConfig();
    const { db, organization, location } = await resolveStorefront({
      organizationSlug: config.organizationSlug || payload.salonSlug,
      locationSlug: config.locationSlug || payload.locationSlug,
    });
    const to = organization.contactEmail || process.env.SALON_OWNER_EMAIL?.trim() || "";
    if (!to) return publicFormResponse(origin, { error: UNAVAILABLE }, 503);
    const submissionKey = `contact:${cleanText(payload.submissionId, 100) || crypto.randomUUID()}`;
    const gate = await publicSubmissionGate(db, { organizationId: organization.id, request, submissionKey, contact: email, kind: "contact", limit: 5 });
    if (gate.duplicate) return publicFormResponse(origin, { received: true });
    if (gate.limited) return publicFormResponse(origin, { error: "Veuillez patienter avant d'envoyer un autre message." }, 429);
    const text = `Nom : ${name}\nCourriel : ${email}\n\nMessage :\n${message}\n\n— Formulaire de contact, bopoil.ca`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${delivery.email.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `bopoil:${submissionKey}`,
      },
      body: JSON.stringify({
        from: delivery.email.from,
        to: [to],
        reply_to: email,
        subject: `Message du site bopoil.ca — ${name}`,
        text,
        html: emailHtml(text),
      }),
    });
    if (!response.ok) return publicFormResponse(origin, { error: "Le message n'a pas pu être transmis. Écrivez-nous à info@bopoil.ca." }, 502);
    const statements: [DbBatchItem, ...DbBatchItem[]] = [
      db.insert(publicIntakeSubmissions).values({
        id: crypto.randomUUID(), organizationId: organization.id, locationId: location.id,
        submissionKey, sourceHash: gate.sourceHash, contactHash: gate.contactHash, status: "processed",
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(), organizationId: organization.id, actorType: "client",
        action: "website.contact_received", entityType: "organization", entityId: organization.id,
        detailsJson: JSON.stringify({ source: "bopoil.ca", locationId: location.id, name, email }),
      }),
    ];
    await db.batch(statements);
    return publicFormResponse(origin, { received: true });
  } catch (error) {
    if (error instanceof SyntaxError) return publicFormResponse(origin, { error: "Le message n'a pas pu être lu." }, 400);
    const handled = storefrontError(error, "Le message n'a pas pu être transmis. Écrivez-nous à info@bopoil.ca.");
    const body = await handled.json() as Record<string, unknown>;
    return publicFormResponse(origin, body, handled.status);
  }
}
