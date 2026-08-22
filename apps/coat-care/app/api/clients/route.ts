import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { requireSalonAccess, requireSchedulingAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { appointments, auditEvents, clients, pets, vaccinationRecords } from "../../../db/schema";
import { issuePortalEmailSession } from "../../../db/client-portal";
import { portalAccessUrl } from "../../../lib/portal-links";

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const query = new URL(request.url).searchParams.get("query")?.trim().slice(0, 80) ?? "";
    const needle = query.toLowerCase();
    const directClientMatch = query ? or(
      sql`instr(lower(${clients.fullName}), ${needle}) > 0`,
      sql`instr(lower(${clients.email}), ${needle}) > 0`,
      sql`instr(lower(${clients.phone}), ${needle}) > 0`,
      sql`exists (
        select 1 from ${pets}
        where ${pets.clientId} = ${clients.id}
          and ${pets.organizationId} = ${membership.organizationId}
          and (
            instr(lower(${pets.name}), ${needle}) > 0
            or instr(lower(${pets.breed}), ${needle}) > 0
          )
      )`,
    ) : undefined;
    const clientRows = await db.select().from(clients).where(and(
      eq(clients.organizationId, membership.organizationId),
      directClientMatch,
    )).orderBy(asc(clients.fullName)).limit(100);
    if (!clientRows.length) return Response.json({ clients: [] });
    const clientIds = clientRows.map((client) => client.id);
    const petRows = await db.select({
      id: pets.id,
      clientId: pets.clientId,
      name: pets.name,
      breed: pets.breed,
      species: pets.species,
      safetyLevel: pets.safetyLevel,
      handlingNotes: pets.handlingNotes,
      appointmentId: appointments.id,
      appointmentStatus: appointments.status,
      appointmentStartsAt: appointments.startsAt,
    }).from(pets).leftJoin(appointments, and(eq(appointments.petId, pets.id), eq(appointments.locationId, membership.locationId))).where(and(
      eq(pets.organizationId, membership.organizationId),
      inArray(pets.clientId, clientIds),
    )).orderBy(asc(pets.name));
    const petIds = [...new Set(petRows.map((pet) => pet.id))];
    const vaccineRows = petIds.length ? await db.select().from(vaccinationRecords).where(and(
      eq(vaccinationRecords.organizationId, membership.organizationId),
      inArray(vaccinationRecords.petId, petIds),
    )).orderBy(asc(vaccinationRecords.expiresOn)) : [];

    const records = clientRows.map((client) => ({
      id: client.id,
      fullName: client.fullName,
      email: client.email,
      phone: client.phone,
      marketingConsent: client.marketingConsent,
      pets: petRows.filter((pet) => pet.clientId === client.id).reduce<Array<{
        id: string; name: string; breed: string; species: string; safetyLevel: string; handlingNotes: string; appointments: Array<{ id: string; status: string; startsAt: string }>; vaccinations: typeof vaccineRows;
      }>>((items, row) => {
        let pet = items.find((item) => item.id === row.id);
        if (!pet) {
          pet = { id: row.id, name: row.name, breed: row.breed, species: row.species, safetyLevel: row.safetyLevel, handlingNotes: row.handlingNotes, appointments: [], vaccinations: vaccineRows.filter((vaccine) => vaccine.petId === row.id) };
          items.push(pet);
        }
        if (row.appointmentId && row.appointmentStatus && row.appointmentStartsAt) {
          pet.appointments.push({ id: row.appointmentId, status: row.appointmentStatus, startsAt: row.appointmentStartsAt });
        }
        return items;
      }, []),
    }));
    return Response.json({ clients: records });
  } catch (error) {
    return salonApiError(error, "Client directory unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    requireSchedulingAccess(membership);
    const body = await request.json() as { clientId?: string };
    const clientId = body.clientId?.trim() ?? "";
    if (!clientId) throw new SalonAccessError("Choose a client.", 400);
    const [ownedClient] = await db.select({ id: clients.id }).from(clients).where(and(
      eq(clients.id, clientId),
      eq(clients.organizationId, membership.organizationId),
    )).limit(1);
    if (!ownedClient) throw new SalonAccessError("Client not found.", 404);
    const session = await issuePortalEmailSession(db, ownedClient.id);
    const portalUrl = portalAccessUrl(process.env.DELIVERY_PUBLIC_URL || new URL(request.url).origin, session.token);
    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: membership.organizationId,
      actorType: "staff",
      actorId: membership.id,
      action: "client.portal_link_created_by_staff",
      entityType: "client",
      entityId: ownedClient.id,
      detailsJson: JSON.stringify({ expiresInMinutes: 15 }),
    });
    return Response.json({ portalUrl, expiresInMinutes: 15 }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return salonApiError(error, "Portal link could not be created.");
  }
}
