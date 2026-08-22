import { revokeSalonSession } from "../../../../chatgpt-auth";

function destination(request: Request) {
  const value = new URL(request.url).searchParams.get("return_to") || "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function logout(request: Request) {
  await revokeSalonSession();
  return Response.redirect(new URL(destination(request), request.url), 303);
}

export const GET = logout;
export const POST = logout;
