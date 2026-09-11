import { getDb } from "../../../../../db";
import { issuePortalSession } from "../../../../../db/client-portal";
import { ensurePilotData, PILOT } from "../../../../../db/pilot";
import { clients, pets } from "../../../../../db/schema";
import { portalCookie } from "../../../../../lib/client-phone-auth";

const DEMO_CLIENT_ID = "client_returning_preview";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1"].includes(hostname)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await ensurePilotData();
    const db = getDb();
    await db.insert(clients).values({
      id: DEMO_CLIENT_ID,
      organizationId: PILOT.organizationId,
      fullName: "Sophie Tremblay",
      email: "sophie.returning@example.test",
      phone: "+18195550123",
      marketingConsent: false,
    }).onConflictDoUpdate({
      target: clients.id,
      set: { fullName: "Sophie Tremblay", email: "sophie.returning@example.test", phone: "+18195550123", updatedAt: new Date().toISOString() },
    });
    await db.insert(pets).values([
      { id: "pet_returning_stella", organizationId: PILOT.organizationId, clientId: DEMO_CLIENT_ID, name: "Stella", breed: "Caniche miniature", sex: "female" },
      { id: "pet_returning_milo", organizationId: PILOT.organizationId, clientId: DEMO_CLIENT_ID, name: "Milo", breed: "Bichon maltais", sex: "male" },
    ]).onConflictDoNothing();
    const session = await issuePortalSession(db, DEMO_CLIENT_ID, 30);
    return Response.json({ ok: true }, { headers: { "set-cookie": portalCookie(session.token) } });
  } catch (error) {
    console.error("Development client preview failed", error);
    return Response.json({ error: "The returning-client preview could not be opened." }, { status: 500 });
  }
}
