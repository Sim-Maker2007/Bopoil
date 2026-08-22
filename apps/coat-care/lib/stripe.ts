type RuntimeValues = Record<string, string | undefined>;
type StripeObject = Record<string, unknown> & { id: string };

function values() { return process.env as RuntimeValues; }

export function stripeConfig(runtime: RuntimeValues = values()) {
  const secretKey = runtime.STRIPE_SECRET_KEY?.trim() || "";
  const webhookSecret = runtime.STRIPE_WEBHOOK_SECRET?.trim() || "";
  return {
    configured: Boolean(secretKey), secretKey, webhookSecret,
    applicationFeeBps: Math.max(0, Math.min(3000, Number(runtime.STRIPE_APPLICATION_FEE_BPS || 0) || 0)),
    prices: {
      starter: runtime.STRIPE_STARTER_PRICE_ID?.trim() || "",
      growth: runtime.STRIPE_GROWTH_PRICE_ID?.trim() || "",
      multi: runtime.STRIPE_MULTI_PRICE_ID?.trim() || "",
    },
  };
}

export function publicStripeConfig(config = stripeConfig()) {
  return { configured: config.configured, webhookConfigured: Boolean(config.webhookSecret), plansConfigured: Object.fromEntries(Object.entries(config.prices).map(([key, price]) => [key, Boolean(price)])) };
}

function append(form: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "boolean") form.append(key, value ? "true" : "false");
  else form.append(key, String(value));
}

export async function stripeRequest<T extends StripeObject>(path: string, params: Record<string, unknown> = {}, options: { account?: string; idempotencyKey?: string; fetcher?: typeof fetch; method?: "GET" | "POST" } = {}) {
  const config = stripeConfig();
  if (!config.configured) throw new Error("Online payments are not configured yet.");
  const form = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => append(form, key, value));
  const headers: Record<string, string> = { authorization: `Bearer ${config.secretKey}`, "content-type": "application/x-www-form-urlencoded" };
  if (options.account) headers["Stripe-Account"] = options.account;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const method = options.method || "POST"; const query = method === "GET" && form.size ? `?${form}` : "";
  const response = await (options.fetcher || fetch)(`https://api.stripe.com/v1/${path.replace(/^\//, "")}${query}`, { method, headers, body: method === "POST" ? form.toString() : undefined });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Stripe request failed (${response.status}).`);
  return result;
}

function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }

export async function verifyStripeSignature(payload: string, signature: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = stripeConfig().webhookSecret;
  if (!secret) return false;
  const parts = signature.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1] || 0);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(nowSeconds - timestamp) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((value) => safeEqual(value, expected));
}

export async function sha256(value: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
