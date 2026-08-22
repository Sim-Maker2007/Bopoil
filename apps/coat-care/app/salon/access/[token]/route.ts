import { consumeSalonLoginChallenge } from "../../../chatgpt-auth";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const ok = await consumeSalonLoginChallenge(token);
  const url = new URL(request.url);
  const requested = url.searchParams.get("return_to") || "/salon";
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/salon";
  return Response.redirect(new URL(ok ? returnTo : "/salon/login?expired=1", request.url), 303);
}
