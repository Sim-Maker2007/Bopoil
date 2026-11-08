import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { requireSalonAccess, requireSchedulingAccess, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";
import { appointments, auditEvents, clientMediaAssets, clients, pets, squareCustomers, squarePayments, vaccinationRecords } from "../../../db/schema";
import { issuePortalEmailSession } from "../../../db/client-portal";
import { portalAccessUrl } from "../../../lib/portal-links";

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess();
    requireWorkspacePermission(membership, "clients");
    const query = new URL(request.url).searchParams.get("query")?.trim().slice(0, 80) ?? "";
    const needle = query.toLowerCase();
    const directClientMatch = query ? or(
      sql`strpos(lower(${clients.fullName}), ${needle}) > 0`,
      sql`strpos(lower(${clients.email}), ${needle}) > 0`,
      sql`strpos(lower(${clients.phone}), ${needle}) > 0`,
      sql`exists (
        select 1 from ${pets}
        where ${pets.clientId} = ${clients.id}
          and ${pets.organizationId} = ${membership.organizationId}
          and (
            strpos(lower(${pets.name}), ${needle}) > 0
            or strpos(lower(${pets.breed}), ${needle}) > 0
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
    const mediaRows = await db.select({ id: clientMediaAssets.id, clientId: clientMediaAssets.clientId, kind: clientMediaAssets.kind, caption: clientMediaAssets.caption, originalFilename: clientMediaAssets.originalFilename, clientVisible: clientMediaAssets.clientVisible, createdAt: clientMediaAssets.createdAt }).from(clientMediaAssets).where(and(
      eq(clientMediaAssets.organizationId, membership.organizationId),
      inArray(clientMediaAssets.clientId, clientIds),
    )).orderBy(asc(clientMediaAssets.createdAt));

    // What Square knows about each client: the linked customer record and
    // the money taken through Square's terminal, point of sale and online store.
    const [squareRows, spendRows] = await Promise.all([
      db.select({ id: squareCustomers.id, clientId: squareCustomers.clientId, note: squareCustomers.note, creationSource: squareCustomers.creationSource, referenceId: squareCustomers.referenceId, birthday: squareCustomers.birthday, emailUnsubscribed: squareCustomers.emailUnsubscribed, squareCreatedAt: squareCustomers.squareCreatedAt, squareUpdatedAt: squareCustomers.squareUpdatedAt })
        .from(squareCustomers).where(and(eq(squareCustomers.organizationId, membership.organizationId), eq(squareCustomers.deleted, false), inArray(squareCustomers.clientId, clientIds))).orderBy(asc(squareCustomers.squareCreatedAt)),
      db.select({ clientId: squarePayments.clientId, paymentCount: sql<number>`count(*)`.mapWith(Number), grossCents: sql<number>`coalesce(sum(${squarePayments.totalCents}), 0)`.mapWith(Number), refundedCents: sql<number>`coalesce(sum(${squarePayments.refundedCents}), 0)`.mapWith(Number), lastPaymentAt: sql<string>`max(${squarePayments.squareCreatedAt})` })
        .from(squarePayments).where(and(eq(squarePayments.organizationId, membership.organizationId), eq(squarePayments.status, "COMPLETED"), inArray(squarePayments.clientId, clientIds))).groupBy(squarePayments.clientId),
    ]);
    const spendByClient = new Map(spendRows.map((row) => [row.clientId, row]));

    const records = clientRows.map((client) => ({
      id: client.id,
      fullName: client.fullName,
      email: client.email,
      phone: client.phone,
      marketingConsent: client.marketingConsent,
      square: (() => {
        const customer = squareRows.find((row) => row.clientId === client.id);
        const spend = spendByClient.get(client.id);
        if (!customer && !spend) return null;
        return {
          customerId: customer?.id || null,
          note: customer?.note || "",
          creationSource: customer?.creationSource || "",
          referenceId: customer?.referenceId || "",
          birthday: customer?.birthday || "",
          emailUnsubscribed: customer?.emailUnsubscribed || false,
          since: customer?.squareCreatedAt || null,
          paymentCount: spend?.paymentCount || 0,
          grossCents: spend?.grossCents || 0,
          refundedCents: spend?.refundedCents || 0,
          lastPaymentAt: spend?.lastPaymentAt || null,
        };
      })(),
      profilePhoto: [...mediaRows].reverse().find((asset) => asset.clientId === client.id && asset.kind === "profile") || null,
      media: mediaRows.filter((asset) => asset.clientId === client.id && asset.kind === "gallery"),
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
