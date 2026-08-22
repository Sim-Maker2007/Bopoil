import { createSalonLoginChallenge } from "../../../../chatgpt-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; returnTo?: string };
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await createSalonLoginChallenge({ email: String(body.email || ""), returnTo: String(body.returnTo || "/salon"), origin: new URL(request.url).origin, source: forwarded });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Salon sign-in request failed", error);
    return Response.json({ error: "The sign-in email could not be sent. Please try again." }, { status: 503 });
  }
}
