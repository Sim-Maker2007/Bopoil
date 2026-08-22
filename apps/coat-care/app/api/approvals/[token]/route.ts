import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appointments, approvalRequests, auditEvents, clients, invoices, pets, services } from "../../../../db/schema";
import { ensurePilotData } from "../../../../db/pilot";
import { requestIsSameOrigin } from "../../../../lib/portal-request";

function tokenFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }
const privateHeaders = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: privateHeaders }); }

async function publicApproval(token: string) {
  await ensurePilotData(); const db = getDb();
  const [row] = await db.select({ id: approvalRequests.id, organizationId: approvalRequests.organizationId, clientId: approvalRequests.clientId, title: approvalRequests.title, explanation: approvalRequests.explanation, amountCents: approvalRequests.amountCents, currency: approvalRequests.currency, status: approvalRequests.status, expiresAt: approvalRequests.expiresAt, respondedAt: approvalRequests.respondedAt, responseName: approvalRequests.responseName, appointmentId: approvalRequests.appointmentId, appointmentStatus: appointments.status, appointmentStartsAt: appointments.startsAt, clientFirstName: clients.fullName, petName: pets.name, serviceName: services.name })
    .from(approvalRequests).innerJoin(appointments, eq(approvalRequests.appointmentId, appointments.id)).innerJoin(clients, eq(approvalRequests.clientId, clients.id)).innerJoin(pets, eq(appointments.petId, pets.id)).innerJoin(services, eq(appointments.serviceId, services.id))
    .where(eq(approvalRequests.token, token)).limit(1);
  return { db, row: row ? { ...row, clientFirstName: row.clientFirstName.trim().split(/\s+/)[0] || "Pet parent", status: row.status === "pending" && ["cancelled", "no_show"].includes(row.appointmentStatus) ? "cancelled" : row.status === "pending" && new Date(row.expiresAt).getTime() <= Date.now() ? "expired" : row.status } : null };
}

export async function GET(request: Request) {
  try { const { row } = await publicApproval(tokenFrom(request)); return row ? reply({ approval: row }) : reply({ error: "Approval request not found." }, 404); }
  catch { return reply({ error: "Approval request unavailable." }, 500); }
}

export async function POST(request: Request) {
  try {
    if (!requestIsSameOrigin(request)) return reply({ error: "Request origin could not be verified." }, 403);
    const token = tokenFrom(request); const body = await request.json() as { decision?: string; responseName?: string }; const decision = String(body.decision || ""); const responseName = String(body.responseName || "").trim().slice(0, 100);
    if (!["approved", "declined"].includes(decision) || responseName.length < 2) return reply({ error: "Enter your name and choose approve or decline." }, 400);
    const { db, row } = await publicApproval(token); if (!row) return reply({ error: "Approval request not found." }, 404);
    if (row.status !== "pending") return reply({ error: `This request is already ${row.status}.` }, 409);
    const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.appointmentId, row.appointmentId), eq(invoices.organizationId, row.organizationId))).limit(1);
    if (decision === "approved" && invoice) return reply({ error: "Checkout has already begun. Please call the salon before approving this change." }, 409);
    const respondedAt = new Date().toISOString();
    const approvalUpdate = db.update(approvalRequests).set({ status: decision as "approved" | "declined", responseName, respondedAt }).where(and(eq(approvalRequests.id, row.id), eq(approvalRequests.status, "pending"))).returning();
    const approvalAudit = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      organizationId: sql<string>`(
        select organization_id from approval_requests
        where id = ${row.id}
          and status = ${decision}
          and responded_at = ${respondedAt}
      )`,
      actorType: "client",
      actorId: row.clientId,
      action: `approval.${decision}`,
      entityType: "approval_request",
      entityId: row.id,
      detailsJson: JSON.stringify({ appointmentId: row.appointmentId, amountCents: row.amountCents, responseName, respondedAt }),
    });
    const [updatedRows] = decision === "approved" ? await db.batch([
      approvalUpdate,
      db.update(appointments).set({ priceEstimateCents: sql`${appointments.priceEstimateCents} + ${row.amountCents}`, updatedAt: respondedAt }).where(and(eq(appointments.id, row.appointmentId), eq(appointments.organizationId, row.organizationId), sql`exists (select 1 from ${approvalRequests} where ${approvalRequests.id} = ${row.id} and ${approvalRequests.status} = 'approved' and ${approvalRequests.respondedAt} = ${respondedAt})`)),
      approvalAudit,
    ]) : await db.batch([approvalUpdate, approvalAudit]);
    const [updated] = updatedRows;
    if (!updated) return reply({ error: "This request was already answered." }, 409);
    return reply({ approval: { ...row, status: decision, responseName, respondedAt } });
  } catch { return reply({ error: "Approval response could not be saved." }, 500); }
}
