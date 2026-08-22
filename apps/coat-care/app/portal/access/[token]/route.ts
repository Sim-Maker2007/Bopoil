import { and, eq, isNull } from "drizzle-orm";
import { issuePortalSession, resolvePortalSession, resolvePortalTokenContext } from "../../../../db/client-portal";
import { clientPortalSessions } from "../../../../db/schema";
import { safePortalReturnTo } from "../../../../lib/portal-links";
import { requestIsSameOrigin } from "../../../../lib/portal-request";

function tokenFrom(request: Request) {
  try { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }
  catch { return ""; }
}

function returnToFrom(request: Request) {
  return safePortalReturnTo(new URL(request.url).searchParams.get("return_to"));
}

async function expiredLocation(request: Request, token = "") {
  const returnTo = returnToFrom(request);
  const destination = new URL("/portal", request.url);
  const bookingUrl = returnTo.startsWith("/book/") ? new URL(returnTo, request.url) : null;
  const bookingParts = bookingUrl?.pathname.split("/").filter(Boolean) || [];
  const context = token ? await resolvePortalTokenContext(token).catch(() => null) : null;
  const organizationSlug = bookingParts[0] === "book" ? bookingParts[1] : context?.organizationSlug;
  const locationSlug = bookingParts[0] === "book" ? bookingParts[2] : "";
  destination.searchParams.set("portal", "expired");
  if (returnTo) destination.searchParams.set("return_to", returnTo);
  if (organizationSlug) destination.searchParams.set("salon", organizationSlug);
  if (locationSlug) destination.searchParams.set("location", locationSlug);
  return destination;
}

export async function GET(request: Request) {
  const token = tokenFrom(request);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return Response.redirect(await expiredLocation(request), 303);
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open your private pet portal</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f8f4ee; color: #292722; }
    body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 24px; box-sizing: border-box; }
    main { width: min(100%, 420px); padding: 32px; border: 1px solid #ded6ca; border-radius: 18px; background: white; box-shadow: 0 18px 50px #332a1b18; }
    h1 { margin: 0 0 12px; font: 500 2rem/1.1 Georgia, serif; }
    p { margin: 0 0 24px; color: #625d54; line-height: 1.6; }
    button { width: 100%; min-height: 48px; border: 0; border-radius: 999px; padding: 12px 18px; background: #a9402d; color: white; font: 700 1rem/1 system-ui, sans-serif; cursor: pointer; }
    button:focus-visible { outline: 3px solid #292722; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Your private pet portal</h1>
    <p>For your security, confirm that you want to open this private session. This extra step keeps email security scanners from using your one-time link.</p>
    <form method="post"><button type="submit">Open my pet portal</button></form>
  </main>
</body>
</html>`, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return Response.json({ error: "Request origin could not be verified." }, {
      status: 403,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }
  const token = tokenFrom(request); const access = await resolvePortalSession(token);
  if (!access.client || !access.session) return Response.redirect(await expiredLocation(request, token), 303);
  const rotated = await issuePortalSession(access.db, access.client.id);
  let claimed;
  try {
    [claimed] = await access.db.update(clientPortalSessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(clientPortalSessions.id, access.session.id), isNull(clientPortalSessions.revokedAt))).returning({ id: clientPortalSessions.id });
  } catch (error) {
    await access.db.update(clientPortalSessions).set({ revokedAt: new Date().toISOString() }).where(eq(clientPortalSessions.id, rotated.id)).catch(() => undefined);
    throw error;
  }
  if (!claimed) {
    await access.db.update(clientPortalSessions).set({ revokedAt: new Date().toISOString() }).where(eq(clientPortalSessions.id, rotated.id)).catch(() => undefined);
    return Response.redirect(await expiredLocation(request, token), 303);
  }
  return new Response(null, { status: 303, headers: { location: new URL(returnToFrom(request) || "/portal", request.url).toString(), "set-cookie": `__Host-pet_portal=${encodeURIComponent(rotated.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
