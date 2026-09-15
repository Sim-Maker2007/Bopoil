// Feature gate for the public boutique. The store ships in every deployment but
// is only reachable when BOUTIQUE_ENABLED=true (set per Vercel environment), or
// on a browser that unlocked it with BOUTIQUE_PREVIEW_KEY. Everyone else gets
// the same 404 as any unknown address, so nothing hints that the store exists.

export const BOUTIQUE_ENABLED_VARIABLE = "BOUTIQUE_ENABLED";
export const BOUTIQUE_PREVIEW_KEY_VARIABLE = "BOUTIQUE_PREVIEW_KEY";
export const BOUTIQUE_PREVIEW_COOKIE = "__Host-bopoil_boutique";
export const BOUTIQUE_PREVIEW_PARAM = "apercu";
export const BOUTIQUE_PREVIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Every address the store needs: the page, its assets and the shop API.
export const BOUTIQUE_PATH_PATTERNS = [
  /^\/boutique(\.html)?$/i,
  /^\/css\/boutique\.css$/i,
  /^\/js\/boutique\.js$/i,
  /^\/api\/public\/shop(\/.*)?$/i,
];

type Env = Record<string, string | undefined>;

export function isBoutiquePath(pathname: string): boolean {
  return BOUTIQUE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function boutiqueEnabled(env: Env = process.env): boolean {
  return (env[BOUTIQUE_ENABLED_VARIABLE] || "").trim().toLowerCase() === "true";
}

export function boutiquePreviewKey(env: Env = process.env): string {
  const key = (env[BOUTIQUE_PREVIEW_KEY_VARIABLE] || "").trim();
  return key.length >= 8 ? key : "";
}

// Compares in constant time so the key cannot be guessed character by character.
export function keysMatch(provided: string | null | undefined, expected: string): boolean {
  if (!expected || typeof provided !== "string") return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  }
  return diff === 0;
}

export type BoutiqueAccess =
  | { action: "pass" }
  | { action: "hide" }
  | { action: "unlock"; cookie: string; redirectTo: string };

export function decideBoutiqueAccess(
  input: { pathname: string; search?: string; previewCookie?: string | null },
  env: Env = process.env,
): BoutiqueAccess {
  if (!isBoutiquePath(input.pathname) || boutiqueEnabled(env)) return { action: "pass" };

  const key = boutiquePreviewKey(env);
  if (!key) return { action: "hide" };

  const params = new URLSearchParams(input.search || "");
  const candidate = params.get(BOUTIQUE_PREVIEW_PARAM);
  if (candidate !== null) {
    if (!keysMatch(candidate, key)) return { action: "hide" };
    params.delete(BOUTIQUE_PREVIEW_PARAM);
    const rest = params.toString();
    return { action: "unlock", cookie: key, redirectTo: input.pathname + (rest ? `?${rest}` : "") };
  }

  return keysMatch(input.previewCookie, key) ? { action: "pass" } : { action: "hide" };
}
