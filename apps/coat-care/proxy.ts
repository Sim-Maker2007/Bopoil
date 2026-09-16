import { NextResponse, type NextRequest } from "next/server";
import {
  BOUTIQUE_PREVIEW_COOKIE,
  BOUTIQUE_PREVIEW_COOKIE_MAX_AGE,
  decideBoutiqueAccess,
} from "./lib/boutique-gate";

// Keeps the boutique invisible until BOUTIQUE_ENABLED=true. See lib/boutique-gate.ts.
export const config = {
  matcher: ["/boutique", "/boutique.html", "/css/boutique.css", "/js/boutique.js", "/api/public/shop/:path*"],
};

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const access = decideBoutiqueAccess({
    pathname,
    search,
    previewCookie: request.cookies.get(BOUTIQUE_PREVIEW_COOKIE)?.value,
  });

  if (access.action === "pass") return NextResponse.next();

  if (access.action === "unlock") {
    // Drop the key from the address bar and remember this browser for a month.
    const response = NextResponse.redirect(new URL(access.redirectTo, request.url), 303);
    response.cookies.set({
      name: BOUTIQUE_PREVIEW_COOKIE,
      value: access.cookie,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: BOUTIQUE_PREVIEW_COOKIE_MAX_AGE,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  // Same page as any unknown address: nothing reveals that the store exists.
  const notFound = NextResponse.rewrite(new URL("/404", request.url));
  notFound.headers.set("cache-control", "no-store");
  return notFound;
}
