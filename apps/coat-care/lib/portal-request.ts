const portalTokenPattern = /^[A-Za-z0-9_-]{40,60}$/;

function safeDecode(value: string) {
  try { return decodeURIComponent(value); }
  catch { return ""; }
}

export function portalCookieTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) { const [name, ...value] = part.trim().split("="); if (name === "__Host-pet_portal") return safeDecode(value.join("=")); }
  return "";
}

export function portalTokenFromRequest(request: Request) {
  const path = new URL(request.url).pathname.split("/").filter(Boolean);
  const marker = path.indexOf("portal");
  if (marker >= 0) {
    const candidate = safeDecode(path[marker + 1] || "");
    if (portalTokenPattern.test(candidate)) return candidate;
  }
  return portalCookieTokenFromRequest(request);
}

export function requestIsSameOrigin(request: Request) {
  const targetOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try { return new URL(origin).origin === targetOrigin; }
    catch { return false; }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const referrer = request.headers.get("referer");
  if (referrer) {
    try { return new URL(referrer).origin === targetOrigin; }
    catch { return false; }
  }
  return false;
}

export function portalCookieRequestIsSameOrigin(request: Request) {
  return !portalCookieTokenFromRequest(request) || requestIsSameOrigin(request);
}
