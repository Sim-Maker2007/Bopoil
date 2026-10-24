import { and, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { externalEntityLinks } from "../db/schema";

// The link table ties a Square id to the Coat & Care record it stands for.
// It is the single place both the booking sync and the data mirror consult, so
// a customer linked while importing bookings is the same client the payments
// import credits, and vice versa.

export type Db = ReturnType<typeof getDb>;
export type EntityType = "appointment" | "client" | "location" | "service" | "staff";

export async function linkedEntity(db: Db, organizationId: string, entityType: EntityType, externalEntityId: string) {
  if (!externalEntityId) return null;
  const [link] = await db.select({
    localEntityId: externalEntityLinks.localEntityId,
    externalVersion: externalEntityLinks.externalVersion,
    lastSyncedAt: externalEntityLinks.lastSyncedAt,
  }).from(externalEntityLinks).where(and(
    eq(externalEntityLinks.organizationId, organizationId),
    eq(externalEntityLinks.provider, "square"),
    eq(externalEntityLinks.entityType, entityType),
    eq(externalEntityLinks.externalEntityId, externalEntityId),
  )).limit(1);
  return link || null;
}

export async function linkedLocalId(db: Db, organizationId: string, entityType: EntityType, externalEntityId: string) {
  return (await linkedEntity(db, organizationId, entityType, externalEntityId))?.localEntityId || "";
}

// Every link of one type for a set of Square ids, as a map external → local.
export async function linkedLocalIds(db: Db, organizationId: string, entityType: EntityType, externalEntityIds: string[]) {
  const ids = [...new Set(externalEntityIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ externalEntityId: externalEntityLinks.externalEntityId, localEntityId: externalEntityLinks.localEntityId })
    .from(externalEntityLinks).where(and(
      eq(externalEntityLinks.organizationId, organizationId),
      eq(externalEntityLinks.provider, "square"),
      eq(externalEntityLinks.entityType, entityType),
      inArray(externalEntityLinks.externalEntityId, ids),
    ));
  return new Map(rows.map((row) => [row.externalEntityId, row.localEntityId]));
}

export type LinkInput = {
  organizationId: string;
  locationId?: string | null;
  entityType: EntityType;
  localEntityId: string;
  externalEntityId: string;
  externalVersion?: string;
  metadata?: Record<string, unknown>;
};

function linkRow(input: LinkInput, now: string) {
  return {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    locationId: input.locationId || null,
    provider: "square" as const,
    entityType: input.entityType,
    localEntityId: input.localEntityId,
    externalEntityId: input.externalEntityId,
    externalVersion: input.externalVersion || "",
    metadataJson: JSON.stringify(input.metadata || {}),
    lastSyncedAt: now,
  };
}

export async function linkEntity(db: Db, input: LinkInput) {
  await linkEntities(db, [input]);
}

// Writes many links in one statement; a repeated external id keeps its last value.
export async function linkEntities(db: Db, inputs: LinkInput[]) {
  if (!inputs.length) return;
  const now = new Date().toISOString();
  const unique = [...new Map(inputs.map((input) => [`${input.entityType}:${input.externalEntityId}`, input])).values()];
  for (let index = 0; index < unique.length; index += 100) {
    await db.insert(externalEntityLinks).values(unique.slice(index, index + 100).map((input) => linkRow(input, now))).onConflictDoUpdate({
      target: [externalEntityLinks.organizationId, externalEntityLinks.provider, externalEntityLinks.entityType, externalEntityLinks.externalEntityId],
      set: {
        localEntityId: sqlExcluded("local_entity_id"),
        locationId: sqlExcluded("location_id"),
        externalVersion: sqlExcluded("external_version"),
        metadataJson: sqlExcluded("metadata_json"),
        lastSyncedAt: now,
      },
    });
  }
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
