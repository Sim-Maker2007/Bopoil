import { and, eq, or, sql } from "drizzle-orm";
import type { DbBatchItem } from "../../../../db";
import {
  auditEvents,
  clients,
  consentRecords,
  petCareProfiles,
  pets,
  publicIntakeSubmissions,
} from "../../../../db/schema";
import { resolveStorefront, storefrontError } from "../../../../db/public-storefront";
import { normalizeClientPhone, requestSource, sha256Hex } from "../../../../lib/client-phone-auth";
import { intakeOriginAllowed, squareConfig } from "../../../../lib/square";
import { attachSolePetToSquareAppointments } from "../../../../lib/square-sync";
import { isValidDateKey } from "../../../../lib/time-zone";

type IntakePayload = {
  salonSlug?: string;
  locationSlug?: string;
  submissionId?: string;
  website?: string;
  proprietaire?: string;
  telephone?: string;
  email?: string;
  nom_animal?: string;
  anniversaire?: string;
  espece?: string;
  race?: string;
  taille?: string;
  sante?: string;
  comportement?: string;
  sterilise?: string;
  gateries?: string;
  photos?: string;
  marketing?: string | boolean;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}
function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "cache-control": "no-store",
    vary: "origin",
  });
  if (origin && intakeOriginAllowed(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type, accept");
    headers.set("access-control-max-age", "86400");
  }
  return headers;
}

function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

function booleanAnswer(value: string, yes: string[]) {
  if (!value) return null;
  return yes.some((candidate) => value.toLowerCase().startsWith(candidate));
}

function species(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("chat")) return "cat";
  if (normalized.startsWith("chien")) return "dog";
  if (normalized.includes("petit")) return "small_animal";
  return "unknown";
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!intakeOriginAllowed(origin)) return new Response(null, { status: 403, headers: corsHeaders(origin) });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!intakeOriginAllowed(origin)) return response(origin, { error: "Ce formulaire n'est pas autorisé depuis cette adresse." }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 24_000) return response(origin, { error: "La fiche est trop volumineuse." }, 413);
  try {
    const payload = await request.json() as IntakePayload;
    if (clean(payload.website, 100)) return response(origin, { received: true });
    const config = squareConfig();
    const storefront = await resolveStorefront({
      organizationSlug: config.organizationSlug || payload.salonSlug,
      locationSlug: config.locationSlug || payload.locationSlug,
    });
    const { db, organization, location } = storefront;
    const ownerName = clean(payload.proprietaire, 100);
    const email = clean(payload.email, 180).toLowerCase();
    const rawPhone = clean(payload.telephone, 40);
    const phone = normalizeClientPhone(rawPhone) || rawPhone;
    const digits = phone.replace(/\D/g, "");
    const petName = clean(payload.nom_animal, 60);
    const birthday = clean(payload.anniversaire, 10);
    const breed = clean(payload.race, 80) || "Not specified";
    const healthNotes = clean(payload.sante, 2500);
    const behaviorNotes = clean(payload.comportement, 2500);
    // Messages are shown verbatim on the French website form.
    if (ownerName.length < 2 || petName.length < 1 || !healthNotes) return response(origin, { error: "Veuillez remplir les renseignements sur le propriétaire, l'animal et sa santé." }, 400);
    if (!email && !digits) return response(origin, { error: "Veuillez indiquer une adresse courriel ou un numéro de téléphone." }, 400);
    if (email && !emailPattern.test(email)) return response(origin, { error: "Veuillez vérifier l'adresse courriel." }, 400);
    if (digits && (digits.length < 10 || digits.length > 15)) return response(origin, { error: "Veuillez vérifier le numéro de téléphone." }, 400);
    if (birthday && !isValidDateKey(birthday)) return response(origin, { error: "Veuillez vérifier la date d'anniversaire de l'animal." }, 400);
    const submissionKey = clean(payload.submissionId, 100) || crypto.randomUUID();
    const [sourceHash, contactHash] = await Promise.all([
      sha256Hex(`public-intake:${organization.id}:source:${requestSource(request)}`),
      sha256Hex(`public-intake:${organization.id}:contact:${email || digits.slice(-10)}`),
    ]);
    const [duplicate] = await db.select({ id: publicIntakeSubmissions.id }).from(publicIntakeSubmissions).where(and(
      eq(publicIntakeSubmissions.organizationId, organization.id),
      eq(publicIntakeSubmissions.submissionKey, submissionKey),
    )).limit(1);
    if (duplicate) return response(origin, { received: true });
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const recent = await db.select({ id: publicIntakeSubmissions.id }).from(publicIntakeSubmissions).where(and(
      eq(publicIntakeSubmissions.organizationId, organization.id),
      eq(publicIntakeSubmissions.sourceHash, sourceHash),
      sql`(${publicIntakeSubmissions.createdAt})::timestamp >= (${cutoff})::timestamp`,
    )).limit(8);
    if (recent.length >= 8) return response(origin, { error: "Veuillez patienter avant d'envoyer une autre fiche." }, 429);
    const phoneSuffix = digits.slice(-10);
    const matches = await db.select().from(clients).where(and(
      eq(clients.organizationId, organization.id),
      or(
        email ? eq(sql<string>`lower(${clients.email})`, email) : undefined,
        phoneSuffix ? eq(sql<string>`right(replace(replace(replace(replace(replace(replace(${clients.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 10)`, phoneSuffix) : undefined,
      ),
    )).limit(3);
    const uniqueMatches = [...new Map(matches.map((client) => [client.id, client])).values()];
    if (uniqueMatches.length > 1) return response(origin, { error: "Ces coordonnées correspondent à plus d'un dossier. Veuillez communiquer avec le salon pour que nous mettions à jour le bon profil." }, 409);
    const existingClient = uniqueMatches[0];
    const clientId = existingClient?.id || crypto.randomUUID();
    const [existingPet] = existingClient ? await db.select().from(pets).where(and(
      eq(pets.organizationId, organization.id),
      eq(pets.clientId, clientId),
      eq(sql<string>`lower(${pets.name})`, petName.toLowerCase()),
    )).limit(1) : [undefined];
    const petId = existingPet?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const marketingConsent = payload.marketing === true || clean(payload.marketing, 20).toLowerCase() === "oui";
    const sterilizedRaw = clean(payload.sterilise, 80).toLowerCase();
    const sterilized = sterilizedRaw.startsWith("oui") ? "yes" as const : sterilizedRaw.startsWith("non") ? "no" as const : "unknown" as const;
    const treatsAllowed = booleanAnswer(clean(payload.gateries, 120), ["oui"]);
    const marketingPhotosAllowed = booleanAnswer(clean(payload.photos, 120), ["oui"]);
    const statements: DbBatchItem[] = [];
    // An unauthenticated form must never rewrite an existing client's identity:
    // a matching profile only gains missing details, and anything that differs
    // is flagged for staff review in the submission ledger and audit trail.
    const contactChanges = existingClient ? {
      ...(ownerName && ownerName !== existingClient.fullName ? { submittedName: ownerName } : {}),
      ...(email && email !== existingClient.email.toLowerCase() ? { submittedEmail: email } : {}),
      ...(phone && phone !== existingClient.phone ? { submittedPhone: phone } : {}),
    } : {};
    const needsReview = Object.keys(contactChanges).length > 0;
    if (existingClient) statements.push(db.update(clients).set({
      ...(existingClient.fullName.trim() ? {} : { fullName: ownerName }),
      ...(email && !existingClient.email ? { email } : {}),
      ...(phone && !existingClient.phone ? { phone } : {}),
      marketingConsent: existingClient.marketingConsent || marketingConsent,
      updatedAt: now,
    }).where(and(eq(clients.id, clientId), eq(clients.organizationId, organization.id))));
    else statements.push(db.insert(clients).values({ id: clientId, organizationId: organization.id, fullName: ownerName, email, phone, marketingConsent }));
    if (existingPet) statements.push(db.update(pets).set({
      species: species(clean(payload.espece, 40)),
      breed,
      dateOfBirth: birthday,
      clientNotes: healthNotes,
      handlingNotes: behaviorNotes,
      updatedAt: now,
    }).where(and(eq(pets.id, petId), eq(pets.organizationId, organization.id), eq(pets.clientId, clientId))));
    else statements.push(db.insert(pets).values({
      id: petId,
      organizationId: organization.id,
      clientId,
      name: petName,
      species: species(clean(payload.espece, 40)),
      breed,
      dateOfBirth: birthday,
      clientNotes: healthNotes,
      handlingNotes: behaviorNotes,
    }));
    statements.push(
      db.insert(petCareProfiles).values({
        id: crypto.randomUUID(), organizationId: organization.id, petId,
        sizeLabel: clean(payload.taille, 80), healthNotes, behaviorNotes, sterilized,
        treatsAllowed, marketingPhotosAllowed, source: "bopoil_website_intake", updatedAt: now,
      }).onConflictDoUpdate({ target: petCareProfiles.petId, set: {
        sizeLabel: clean(payload.taille, 80), healthNotes, behaviorNotes, sterilized,
        treatsAllowed, marketingPhotosAllowed, source: "bopoil_website_intake", updatedAt: now,
      }}),
      db.insert(publicIntakeSubmissions).values({
        id: crypto.randomUUID(), organizationId: organization.id, locationId: location.id,
        clientId, petId, submissionKey, sourceHash, contactHash, status: needsReview ? "review" : "processed",
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(), organizationId: organization.id, actorType: "client", actorId: clientId,
        action: existingPet ? "intake.pet_profile_updated" : "intake.pet_profile_created",
        entityType: "pet", entityId: petId,
        detailsJson: JSON.stringify({ source: "bopoil.ca", locationId: location.id, marketingConsent, treatsAllowed, marketingPhotosAllowed, ...(needsReview ? { contactChanges } : {}) }),
      }),
      db.insert(consentRecords).values({ id: crypto.randomUUID(), organizationId: organization.id, clientId, type: "marketing", policyVersion: "bopoil-website-2026-08", accepted: marketingConsent, source: "bopoil_website_intake" }),
    );
    if (treatsAllowed !== null) statements.push(db.insert(consentRecords).values({ id: crypto.randomUUID(), organizationId: organization.id, clientId, type: "pet_treats", policyVersion: "bopoil-website-2026-08", accepted: treatsAllowed, source: "bopoil_website_intake" }));
    if (marketingPhotosAllowed !== null) statements.push(db.insert(consentRecords).values({ id: crypto.randomUUID(), organizationId: organization.id, clientId, type: "pet_marketing_photos", policyVersion: "bopoil-website-2026-08", accepted: marketingPhotosAllowed, source: "bopoil_website_intake" }));
    await db.batch(statements as [DbBatchItem, ...DbBatchItem[]]);
    const reassigned = await attachSolePetToSquareAppointments(db, organization.id, clientId, petId);
    if (reassigned) await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: organization.id, actorType: "system", action: "integration.square_pet_assigned_from_intake", entityType: "pet", entityId: petId, detailsJson: JSON.stringify({ appointments: reassigned }) });
    return response(origin, { received: true });
  } catch (error) {
    if (error instanceof SyntaxError) return response(origin, { error: "La fiche n'a pas pu être lue." }, 400);
    const handled = storefrontError(error, "La fiche n'a pas pu être enregistrée. Veuillez réessayer ou nous appeler.");
    const body = await handled.json() as Record<string, unknown>;
    return response(origin, body, handled.status);
  }
}
