import { revokePortalSession } from "../../../db/client-portal";
import { portalCookieRequestIsSameOrigin, portalCookieTokenFromRequest } from "../../../lib/portal-request";

export async function GET(request: Request) {
  return new Response(null, { status: 303, headers: { location: new URL("/portal", request.url).toString(), "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!portalCookieRequestIsSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403, headers: { "cache-control": "no-store" } });
  await revokePortalSession(portalCookieTokenFromRequest(request));
  return new Response(null, { status: 303, headers: { location: new URL("/", request.url).toString(), "set-cookie": "__Host-pet_portal=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0", "cache-control": "no-store" } });
}
