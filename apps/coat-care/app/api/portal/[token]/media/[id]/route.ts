import { and, eq } from "drizzle-orm";
import { clientMediaAssets } from "../../../../../../db/schema";
import { resolvePortalSession } from "../../../../../../db/client-portal";
import { mediaStore } from "../../../../../../lib/blob-storage";
import { portalTokenFromRequest } from "../../../../../../lib/portal-request";

function idFrom(request: Request) { return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() || ""); }

export async function GET(request: Request) {
  try {
    const access = await resolvePortalSession(portalTokenFromRequest(request));
    if (!access.client || !access.session) return Response.json({ error: "This private link is invalid or has expired." }, { status: 401, headers: { "cache-control": "private, no-store" } });
    const [asset] = await access.db.select().from(clientMediaAssets).where(and(eq(clientMediaAssets.id, idFrom(request)), eq(clientMediaAssets.organizationId, access.client.organizationId), eq(clientMediaAssets.clientId, access.client.id), eq(clientMediaAssets.clientVisible, true))).limit(1);
    if (!asset) return Response.json({ error: "Photo not found." }, { status: 404, headers: { "cache-control": "private, no-store" } });
    const object = await mediaStore.get(asset.r2Key);
    if (!object) return Response.json({ error: "Photo file not found." }, { status: 404, headers: { "cache-control": "private, no-store" } });
    return new Response(object.body, { headers: { "content-type": asset.mimeType, "content-length": String(asset.sizeBytes), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch { return Response.json({ error: "Photo unavailable." }, { status: 500, headers: { "cache-control": "private, no-store" } }); }
}
