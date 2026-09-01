import { verifySquareWebhookSignature } from "./square-webhooks";
export { squareWebhookSignature } from "./square-webhooks";

type RuntimeValues = Record<string, string | undefined>;

function runtimeValues() {
  return process.env as RuntimeValues;
}

function trim(value: string | undefined) {
  return value?.trim() || "";
}

export function squareConfig(runtime: RuntimeValues = runtimeValues()) {
  const publicOrigin = trim(runtime.DELIVERY_PUBLIC_URL).replace(/\/$/, "");
  const webhookNotificationUrl = trim(runtime.SQUARE_WEBHOOK_NOTIFICATION_URL)
    || (publicOrigin ? `${publicOrigin}/api/webhooks/square` : "");
  const accessToken = trim(runtime.SQUARE_ACCESS_TOKEN);
  const webhookSignatureKey = trim(runtime.SQUARE_WEBHOOK_SIGNATURE_KEY);
  const allowedOrigins = [publicOrigin, ...trim(runtime.PUBLIC_INTAKE_ALLOWED_ORIGINS)
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean)].filter(Boolean);
  return {
    accessToken,
    webhookSignatureKey,
    webhookNotificationUrl,
    apiVersion: trim(runtime.SQUARE_API_VERSION) || "2026-07-15",
    organizationSlug: trim(runtime.SQUARE_ORGANIZATION_SLUG),
    locationSlug: trim(runtime.SQUARE_LOCATION_SLUG),
    externalLocationId: trim(runtime.SQUARE_LOCATION_ID),
    allowedOrigins,
    syncConfigured: Boolean(accessToken),
    webhookConfigured: Boolean(accessToken && webhookSignatureKey && webhookNotificationUrl),
  };
}

export async function verifySquareWebhook(payload: string, signature: string, config = squareConfig()) {
  return verifySquareWebhookSignature(payload, signature, config.webhookNotificationUrl, config.webhookSignatureKey);
}

export async function squareRequest<T>(path: string, options: { query?: URLSearchParams; fetcher?: typeof fetch } = {}) {
  const config = squareConfig();
  if (!config.accessToken) throw new Error("Square synchronization is not configured.");
  const url = new URL(`https://connect.squareup.com/v2/${path.replace(/^\//, "")}`);
  options.query?.forEach((value, key) => url.searchParams.append(key, value));
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.accessToken}`,
    accept: "application/json",
  };
  if (config.apiVersion) headers["Square-Version"] = config.apiVersion;
  const fetcher = options.fetcher || fetch;
  let response = await fetcher(url, { headers });
  // Square rate-limits bursts with 429 and occasionally answers 5xx; a short
  // back-off keeps an hourly reconciliation from failing on a single blip.
  for (let attempt = 0; attempt < 2 && (response.status === 429 || response.status >= 500); attempt += 1) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt)));
    response = await fetcher(url, { headers });
  }
  const body = await response.json() as T & { errors?: Array<{ detail?: string }> };
  if (!response.ok) throw new Error(body.errors?.[0]?.detail || `Square request failed (${response.status}).`);
  return body;
}

export function intakeOriginAllowed(origin: string | null, config = squareConfig()) {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return config.allowedOrigins.includes(normalized);
}
