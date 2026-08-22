import { and, asc, eq } from "drizzle-orm";
import { getDb } from ".";
import { ensurePilotData, PILOT } from "./pilot";
import { locations, organizations, salonSettings } from "./schema";

export class StorefrontError extends Error {
  constructor(message: string, public status = 404) { super(message); }
}

function cleanSlug(value: unknown) {
  const slug = String(value || "").trim().toLowerCase().slice(0, 64);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

export async function resolveStorefront(input: { organizationSlug?: unknown; locationSlug?: unknown } = {}) {
  await ensurePilotData();
  const db = getDb();
  const requestedOrganization = cleanSlug(input.organizationSlug);
  const requestedLocation = cleanSlug(input.locationSlug);
  const [organization] = requestedOrganization
    ? await db.select().from(organizations).where(and(eq(organizations.slug, requestedOrganization), eq(organizations.onboardingCompleted, true))).limit(1)
    : await db.select().from(organizations).where(eq(organizations.id, PILOT.organizationId)).limit(1);
  if (!organization) throw new StorefrontError("This salon storefront is not available.");

  const locationRows = await db.select().from(locations).where(and(
    eq(locations.organizationId, organization.id), eq(locations.active, true),
  )).orderBy(asc(locations.createdAt), asc(locations.name));
  const location = requestedLocation
    ? locationRows.find((item) => item.slug === requestedLocation)
    : locationRows[0];
  if (!location) throw new StorefrontError("This salon location is not available.");
  const [settings] = await db.select().from(salonSettings).where(and(
    eq(salonSettings.organizationId, organization.id), eq(salonSettings.locationId, location.id),
  )).limit(1);
  if (!settings) throw new StorefrontError("This salon is still finishing setup.", 409);
  return { db, organization, location, settings, locations: locationRows };
}

export function storefrontError(error: unknown, fallback: string) {
  if (error instanceof StorefrontError) return Response.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
